---
title: Apache Airflow & Amazon MWAA — Orchestration Refresher
summary: Running a fleet of pipelines reliably — DAG optimization, dependency management, retries, monitoring, and why the scheduler is slow.
topic: data-engineering
format: refresher
tags: [airflow, mwaa, aws, orchestration, dags, scheduling]
updated: 2026-08-07
---

## Frame

The interesting question about Airflow is not "can you write a DAG." It is **can you run a fleet of pipelines reliably at scale and reason about why the scheduler is slow.** This refresher is operational rather than syntactic: designing and optimizing orchestration frameworks on Airflow / Amazon MWAA, covering DAG optimization, dependency management, retries, monitoring, and operationalization.

Three mental models to hold:

1. **Airflow is an orchestrator, not a processor.** It schedules and coordinates work; the heavy lifting happens in Spark/Glue/Redshift/Databricks. The anti-pattern is treating Airflow as a compute engine (pulling data into the worker, looping over rows). The architect's instinct: **Airflow triggers and waits; the data platform does the work.**
2. **A DAG file is parsed constantly, not just at run time.** The scheduler re-parses every DAG file on a loop (default every ~30s) to build the schedule. So expensive code at the top level of a DAG file (API calls, DB queries, big imports) runs on *every parse*, not per-run. This single fact explains most "scheduler is slow" incidents.
3. **Idempotency is the load-bearing property.** Every task must be safely re-runnable for the same logical date and produce the same result. Retries, backfills, and catchup all depend on it. A non-idempotent task is a latent production incident.

**Version baseline:** Airflow 2.x is the assumption throughout. Airflow 3.0 (GA early 2025) is noted where it changed things materially — most importantly **assets** (the rename/generalisation of datasets), a **task-execution API / API-server split** decoupling workers from the metadata DB, **DAG versioning**, and removal of the SubDagOperator and SLA-as-built-in. MWAA now supports Airflow 3.x (**3.0 since Oct 2025, 3.2 since Apr 2026**), so 3.x is a real deployment option on MWAA — not just "the direction" — even though many estates still run 2.x. Safe move: speak 2.x fluently *and* treat 3.x (assets, DAG versioning, deadline alerts, the API-server split) as current and available on MWAA, not hypothetical.

---

# 1. Core concepts

**DAG (Directed Acyclic Graph)** — the pipeline definition: a set of tasks plus their dependency edges, with no cycles. A DAG is a *template*; each scheduled execution is a **DAG run** tied to a **logical date** (data interval).

**Task** — a single unit of work, a node in the DAG. At runtime a task becomes a **task instance** (task + DAG run + try number).

**Operator** — the template for *what a task does*. Categories:
- *Action operators* — do something: `PythonOperator`, `BashOperator`, `@task`, `GlueJobOperator`, `DatabricksSubmitRunOperator`.
- *Transfer operators* — move data between systems: `S3ToRedshiftOperator`.
- *Sensors* — wait for a condition (see below).

**Sensor** — a special operator that *waits* for something (a file in S3, a partition, another DAG's task, a time). Two modes:
- `poke` — holds a worker slot and checks on an interval (cheap to reason about, expensive on slots).
- `reschedule` — releases the slot between checks (better for long waits).
- The modern answer is usually a **deferrable** equivalent (§5/§6).

**Hook** — the reusable client/interface to an external system (`S3Hook`, `PostgresHook`, `DatabricksHook`). Operators use hooks under the hood; hooks read credentials from **connections**.

**XCom (cross-communication)** — the mechanism for passing *small* values between tasks (an S3 key, a run id, a count). Stored in the metadata DB by default → **not for large payloads**. For big data, pass a pointer (S3 path), not the data. Custom XCom backends can offload to S3 if needed.

**Connection** — stored credentials/endpoint for an external system (conn id + type + host/login/password/extra). Referenced by hooks/operators via `conn_id`. In MWAA these typically resolve from Secrets Manager.

**Variable** — a key/value config store (Airflow-managed, in the metadata DB). Useful for environment config. **Caveat:** `Variable.get()` at the top level of a DAG file hits the DB on every parse — fetch inside tasks or use Jinja templating instead.

**Pool** — a concurrency-limiting bucket. Tasks assigned to a pool can't exceed the pool's slot count → protects a fragile downstream (e.g. a database with limited connections) from being hammered by parallel tasks.

**Architecture** — the components and what each does:

| Component | Role |
|---|---|
| **Scheduler** | The brain. Parses DAG files, evaluates schedules, decides which task instances are runnable, and queues them. Can run multiple (HA) since 2.0. |
| **Executor** | The *how* of running queued tasks. Local, Celery, or Kubernetes (§6). Lives inside/alongside the scheduler; dispatches to workers. |
| **Workers** | Where tasks actually execute (Celery/K8s executors). LocalExecutor runs them as subprocesses of the scheduler. |
| **Webserver / API server** | The UI and REST API. In Airflow 3 the API server is a first-class component and workers talk to it (not the DB) via the task-execution API. |
| **Metadata database** | Postgres/MySQL. The source of truth for DAG runs, task states, connections, variables, XCom. Everything coordinates through it. |
| **Triggerer** | Async process (asyncio) that runs the waits for **deferrable** operators so they don't occupy worker slots (§5). |
| **DAG processor** | Parses DAG files into the DB. Can run standalone (and is decoupled in Airflow 3). |

---

# 2. Authoring DAGs the modern way

**TaskFlow API** (Airflow 2.0+) is the modern idiom. `@dag` and `@task` decorators turn plain Python functions into tasks; return values become XComs *automatically*; passing a return value as an argument creates the dependency edge implicitly.

```python
from airflow.decorators import dag, task
from datetime import datetime

@dag(
    schedule="@daily",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args={"retries": 2},
    tags=["etl", "demo"],
)
def sales_pipeline():

    @task
    def extract() -> str:
        # return a POINTER, not the data
        return "s3://bucket/raw/2026-05-25.parquet"

    @task
    def transform(s3_key: str) -> int:
        # ... kick off Spark/Glue here; return a small result
        return 42

    @task
    def load(row_count: int):
        ...

    # dependency edges are inferred from data flow
    load(transform(extract()))

sales_pipeline()
```

**`@task` vs classic operators** — `@task` is sugar over `PythonOperator` with automatic XCom wiring and cleaner code. Use classic operators when you need a purpose-built integration (`GlueJobOperator`, `DatabricksSubmitRunOperator`); use `@task` for Python glue logic. They mix freely in one DAG.

**Task groups** — `TaskGroup` (or `@task_group`) visually and logically clusters related tasks in the UI without the deprecated `SubDagOperator` (removed in Airflow 3). Use for "the staging block" vs "the marts block."

```python
from airflow.decorators import task_group

@task_group
def staging():
    stage_a() >> stage_b()
```

**Dynamic task mapping (`.expand`)** — generate a variable number of parallel task instances at runtime from a list (whose length isn't known at parse time). The modern replacement for hand-looping operators.

```python
@task
def process(file: str): ...

@task
def list_files() -> list[str]: ...

process.expand(file=list_files())   # one mapped instance per file
```

`.partial(...)` pins constant args; `.expand(...)` provides the varying ones. Map over multiple args with `expand_kwargs`.

---

# 3. Scheduling

**`schedule` (Airflow 2.4+)** is the unified parameter — accepts a cron string (`"0 6 * * *"`), a preset (`"@daily"`), a `timedelta`, a **timetable** object, or a list of **datasets/assets**. It supersedes the older `schedule_interval`. (Don't set both.)

**Data interval & logical date** — the single most misunderstood concept. A daily DAG run *for* 2026-05-24 typically fires *at the end* of that interval (early on 2026-05-25). The run represents the **data interval** `[2026-05-24, 2026-05-25)`. The old name `execution_date` was renamed to `logical_date` precisely because people kept thinking it meant "now." Use `data_interval_start` / `data_interval_end` to slice the data — **never `datetime.now()`** (that breaks idempotency and backfill).

**`catchup`** — if a DAG's `start_date` is in the past and `catchup=True` (the historical default), Airflow schedules a run for *every* missed interval. This can stampede on first deploy.
> **`catchup=False` is the right default** for most pipelines: only run the most recent interval, don't replay history. Turn catchup on deliberately when you genuinely want to fill history.

**Backfill** — deliberately running a DAG over a past date range (`airflow dags backfill`, or in Airflow 3 a first-class backfill API/UI). Backfill only works correctly if tasks are idempotent and use the data interval, not wall-clock time.

**Cron vs timetables** — cron handles regular calendars. **Timetables** (custom `Timetable` classes) handle what cron can't: "skip weekends/holidays," "run only on the last business day," irregular intervals. Reach for a timetable when the schedule has business-calendar logic.

**Dataset / asset-driven ("data-aware") scheduling** — instead of a clock, a DAG runs when an upstream DAG *produces* a dataset it consumes. A producer task declares `outlets=[Dataset("s3://...")]`; a consumer DAG sets `schedule=[Dataset("s3://...")]` and fires when the dataset updates. This replaces brittle cross-DAG sensors with **event/lineage-driven** orchestration.
> Airflow 3 generalises Datasets into **Assets** (`@asset`, asset-centric scheduling) — same idea, broader model. In 2.x say "datasets"; note "assets" as the 3.x evolution.

---

# 4. Dependency management

**Within a DAG:**
- `a >> b` (a then b) and `a << b` (b then a) — the bitshift operators. `a >> [b, c]` fans out.
- `a.set_downstream(b)` / `b.set_upstream(a)` — the explicit method form.
- `chain(a, b, c)` and `cross_downstream(...)` from `airflow.models.baseoperator` for readable linear/cross wiring.
- With TaskFlow, passing one task's output into another *implies* the edge.

**Trigger rules** — control *when* a task fires based on upstream states. Default is `all_success`. Key others:

| Rule | Fires when |
|---|---|
| `all_success` (default) | all upstreams succeeded |
| `all_done` | all upstreams finished (any state) — for cleanup tasks |
| `one_success` / `one_failed` | at least one upstream succeeded / failed |
| `none_failed` | no upstream failed (skipped is OK) |
| `none_failed_min_one_success` | the correct rule for a join after branching |
| `all_failed` | all upstreams failed |

**Branching (`@task.branch` / `BranchPythonOperator`)** — a branch task returns the `task_id`(s) to follow; the others are **skipped**. Classic gotcha: the join task downstream of a branch must use `none_failed_min_one_success` (not the default `all_success`), or it gets skip-poisoned.

```python
@task.branch
def choose(run_type: str) -> str:
    return "full_load" if run_type == "full" else "incremental_load"
```

**Cross-DAG dependencies** — three tools, in increasing order of decoupling:
1. **`TriggerDagRunOperator`** — DAG A *actively triggers* DAG B (push). Optionally waits for completion. Tight coupling; A knows about B.
2. **`ExternalTaskSensor`** — DAG B *waits for* a specific task/DAG in A to succeed for the same logical date (pull). Watch the `execution_delta`/`execution_date_fn` alignment — mismatched intervals are the classic footgun. Prefer the deferrable variant to avoid burning a slot while waiting.
3. **Datasets/Assets** — the **preferred modern pattern**: A declares it produces a dataset, B subscribes. No DAG knows about the other; the *data* is the contract. This is the architect's answer to "coordinate many pipelines."

---

# 5. Reliability

**Retries** — set per task (or via `default_args`): `retries=3`, `retry_delay=timedelta(minutes=5)`. Enable **exponential backoff** with `retry_exponential_backoff=True` and cap it with `max_retry_delay`. Backoff is the right default for anything hitting a rate-limited or flaky external system.

```python
default_args = {
    "retries": 3,
    "retry_delay": timedelta(minutes=2),
    "retry_exponential_backoff": True,
    "max_retry_delay": timedelta(minutes=30),
}
```

**Timeouts** — `execution_timeout` per task kills a task that runs too long (prevents a hung sensor/job from holding a slot forever). `dagrun_timeout` bounds the whole run. Always set `execution_timeout` on sensors and external-job waits.

**SLAs** — historically `sla=timedelta(...)` fired an `sla_miss_callback` when a task missed its expected completion relative to the DAG run. **Note:** the legacy SLA feature was *removed in Airflow 3.0* in favour of "deadline alerts" / external monitoring. In a 2.x shop SLAs still work; in 3.x speak to deadline-based alerting or monitoring-driven SLAs instead. Be careful not to over-claim 3.x SLA mechanics.

**Idempotency — the core discipline.** A task must produce the same result whether it runs once or five times for a given logical date. Patterns:
- **Delete-then-insert / overwrite a partition** keyed on `data_interval_start`, rather than blind append.
- **`MERGE` / upsert** on a natural key instead of `INSERT`.
- **Write to a deterministic path** (`.../dt=2026-05-24/`) so a re-run overwrites the same target.
- **Never** key logic on `datetime.now()`, random ids, or "the next available" sequence.
- Make external calls safe to repeat (idempotency keys, conditional writes).

**Sensors vs deferrable operators (the triggerer)** — a classic `poke`-mode sensor holds a **worker slot** the entire time it waits. A hundred DAGs all sensing for files = worker starvation, even though they're doing nothing. **Deferrable operators** solve this: the task hands its wait to the **triggerer** (an async asyncio process), *frees the worker slot*, and resumes only when the trigger fires. Use `mode="reschedule"` as a lighter fix, or deferrable operators (e.g. `S3KeySensorAsync`, `*Deferrable` operators, or `deferrable=True` on supported operators) as the proper one. This is the headline answer to "how do you wait at scale without burning workers."

---

# 6. DAG optimization

The section that matters most in practice. Frame it as **two distinct problems: parsing performance and execution throughput.**

**A. Parsing performance (scheduler health).** The scheduler re-parses every DAG file on a loop. Rules:
- **No expensive top-level code.** No API calls, DB queries, `Variable.get()`, file reads, or heavy imports at module scope — they run on *every parse*, multiplying cost and slowing the scheduler. Put that work *inside tasks*.
- **Keep DAG files lean and the import fast.** Lazy-import heavy libraries inside functions. Watch `dag_file_processor_timeout`.
- **Tune `min_file_process_interval`** (how often a file is re-parsed) and `dag_dir_list_interval` (how often the folder is scanned). Raising them reduces scheduler load when you have many DAGs.
- **`max_active_tasks_per_dag` / `max_active_runs_per_dag`** bound a single DAG's footprint.
- The diagnostic signal: **`dag_processing.total_parse_time`** metric and the "DAG import errors" banner. If parse time creeps up, hunt top-level code.

**B. Execution throughput (concurrency knobs), from broad to narrow:**

| Knob | Scope | Controls |
|---|---|---|
| `parallelism` | whole cluster | max task instances running across the deployment |
| `max_active_runs_per_dag` | per DAG | how many DAG runs run concurrently (key for backfills) |
| `max_active_tasks_per_dag` (was `concurrency`) | per DAG | max running tasks in one DAG |
| **Pools** | per resource | cap parallel access to a fragile downstream (DB, API) |
| `priority_weight` | per task | ordering when slots are scarce |
| `task_concurrency` / `max_active_tis_per_dag` | per task | cap instances of one task across runs |

**C. Deferrable operators** — covered in §5; they're an *optimization* lever too because they reclaim worker slots from waiting tasks. Name them here as well.

**D. Executor choice — the right-sizing decision:**

| Executor | When | Trade-off |
|---|---|---|
| **LocalExecutor** | small/single-node; dev | simple; no horizontal scale; tasks are scheduler subprocesses |
| **CeleryExecutor** | steady, many tasks; worker pool always warm | persistent workers (cost when idle), needs a broker (Redis/RabbitMQ); good for high task volume |
| **KubernetesExecutor** | bursty/heterogeneous; per-task isolation | one pod per task → clean isolation + scale-to-zero, but pod startup latency per task |
| **CeleryKubernetesExecutor** | mixed workloads | route small/fast to Celery, heavy/isolated to K8s |

MWAA uses Celery under the hood with managed auto-scaling workers (§8).

**E. Right-sizing instinct:** don't pull data into Airflow. Push compute to Glue/EMR/Databricks and have Airflow *submit and monitor*. The lightest, most scalable DAG is mostly submit-and-sense.

---

# 7. Monitoring & operationalization

**Logging** — each task instance writes logs (per try). Configure a remote log backend (S3 in AWS) so logs survive worker recycling; MWAA ships these to CloudWatch automatically.

**Callbacks** — hook lifecycle events:
- `on_failure_callback` / `on_success_callback` / `on_retry_callback` (per task or `default_args`) — fire alerts to Slack/PagerDuty/SNS.
- `on_execute_callback`, `sla_miss_callback` (2.x).
- DAG-level `on_failure_callback`.

```python
def alert_on_fail(context):
    ti = context["task_instance"]
    notify_slack(f"{ti.dag_id}.{ti.task_id} failed at {context['logical_date']}")

default_args = {"on_failure_callback": alert_on_fail}
```

**Metrics** — Airflow emits **StatsD** metrics (counters/timers) that are commonly bridged to **Prometheus** (statsd-exporter) and visualised in Grafana. Watch: scheduler heartbeat, `dag_processing.total_parse_time`, executor open/queued slots, task duration, SLA misses, pool usage. MWAA publishes a curated subset to **CloudWatch** out of the box.

**Alerting** — wire failure callbacks → SNS/Slack/PagerDuty; alert on *scheduler health* and *parse time*, not just task failures. A silent scheduler is the scariest failure.

**Airflow UI** — the operational surface:
- **Grid view** (the modern default; replaced Tree view) — runs × tasks status matrix; the first place you look during an incident.
- **Graph view** — DAG topology and per-run state.
- **Gantt** — task duration/overlap, for finding the long pole.
- **Code / Logs / XCom** tabs per task.

**DAG-as-code, CI/CD & testing** — this is what "operationalization" means in practice:
- DAGs live in **Git**; CI lints, runs `python dag.py` to catch import errors, and **DAG integrity tests** (load all DAGs, assert no cycles/import errors, check tags/owners).
- Unit-test task callables as plain Python functions.
- Deploy by syncing the DAGs folder (for MWAA: sync to the **S3 DAGs bucket**, ideally via pipeline; MWAA picks up changes).
- Pin `requirements.txt`; test dependency changes in a lower environment before prod.
- Airflow 3's **DAG versioning** makes "which code ran this run" auditable — useful for SOX-style change evidence.

---

# 8. Amazon MWAA specifics

**What MWAA manages** — the control plane: scheduler, web server, workers, metadata DB (Aurora PostgreSQL, managed), auto-scaling, patching, log shipping to CloudWatch. **What you still own** — your DAGs, your `requirements.txt`, your `plugins.zip`, networking (VPC), IAM, and the *content* of pipelines. It is "managed Airflow," **not serverless** — you size and pay for an environment continuously.

**Environment class & auto-scaling workers** — you pick an environment **class** (mw1.small → mw1.large, and newer larger sizes) that fixes scheduler/webserver capacity. **Workers auto-scale** between a configured **min and max worker count** based on queued tasks; they scale back down when idle. (Don't quote specific vCPU/RAM or worker-count numbers from memory — say "you set min/max workers and pick a class," and look up exact specs.)

**DAGs bucket (S3)** — DAGs, `requirements.txt`, and `plugins.zip` live in a designated **S3 bucket**; MWAA syncs from it. Deploys = update the S3 objects (wire this into CI/CD). Versioned bucket recommended.

**`requirements.txt` & plugins** — extra PyPI packages via `requirements.txt`; custom operators/hooks via `plugins.zip`. **Pin versions** and validate against the environment's Airflow/Python version — a bad requirements file can wedge the environment. MWAA provides a local-runner Docker image to test the exact environment before deploy.

**VPC / networking & private web server** — MWAA runs inside **your VPC** across two private subnets; it needs egress (NAT or VPC endpoints) for AWS APIs and PyPI. Web server access mode is **public-network** or **private-network** (private = reachable only inside the VPC, the right choice for regulated estates; you then reach the UI via VPN/PrivateLink/bastion).

**Secrets via Secrets Manager backend** — configure MWAA's **Secrets Manager backend** so Airflow **connections and variables** resolve from AWS Secrets Manager instead of the metadata DB. The framing: *"connections and variables resolved through the Secrets Manager backend, not stored in the Airflow DB; lookups are prefixed (`airflow/connections/...`, `airflow/variables/...`)."*

**Logging to CloudWatch** — per-component log groups (DAG processing, scheduler, worker, web server, task). You choose log levels; task logs land in CloudWatch Logs and the curated metrics in CloudWatch Metrics.

**MWAA vs self-managed-on-EKS — the trade-off:**

| | MWAA | Self-managed (EKS + Helm chart) |
|---|---|---|
| Ops burden | Low — AWS patches/scales | High — you run the cluster |
| Flexibility | Constrained (fixed exec, AWS-approved versions, sizing classes) | Full (any executor, version, plugin, sidecar) |
| Version freshness | Lags upstream | Bleeding edge if you want |
| Cost shape | Pay-per-environment, scales workers | You optimise; can be cheaper at scale, costs you engineers |
| Networking/secrets | Integrated (VPC, Secrets Manager, IAM) | You wire it all |

**The architect's call:** *"MWAA when you want orchestration without running Airflow — most teams, faster time-to-value, AWS-integrated security. Self-managed on EKS when you need a version/executor/plugin MWAA doesn't support, very high scale where you can amortise a platform team, or KubernetesExecutor with bespoke pod configs. Default to MWAA; justify the EKS path with a concrete constraint."* Astronomer is the third option (managed, multi-cloud, fresher versions) — name it if asked.

---

# 9. Airflow as data orchestrator

The realistic 2026 role of Airflow on this stack: **the conductor that submits work to AWS data services and Databricks and waits for completion** — not the thing doing the transform.

**Common operators for this stack** (from `apache-airflow-providers-amazon` / `-databricks`):
- **Glue:** `GlueJobOperator` (run a Glue job), `GlueCrawlerOperator`, `GlueJobSensor`, `GlueDataQualityOperator`.
- **EMR:** `EmrCreateJobFlowOperator`, `EmrAddStepsOperator`, `EmrStepSensor`, plus EMR-on-EKS / EMR Serverless operators.
- **Redshift:** `RedshiftDataOperator` (run SQL via the Data API — no persistent connection), `S3ToRedshiftOperator` (COPY), cluster pause/resume operators.
- **S3:** `S3KeySensor` (wait for an object/prefix — prefer the deferrable form), `S3ToRedshiftOperator`, list/copy operators.
- **Lambda:** `LambdaInvokeFunctionOperator`.
- **Athena:** `AthenaOperator`.

**Triggering Databricks** — the integration the title cares about:
- `DatabricksSubmitRunOperator` — submit a one-off run (notebook/JAR/Python/Spark task) to a new or existing cluster.
- `DatabricksRunNowOperator` — trigger an *existing* Databricks **Job** by id (the pattern when the job is owned/defined in Databricks).
- `DatabricksSqlOperator` / `DatabricksCopyIntoOperator` — run SQL / `COPY INTO` against SQL warehouses.
- `DatabricksNotebookOperator`, repair-run support, and (newer) operators that surface Databricks task state back to Airflow.
- Connection via a Databricks **connection** (host + PAT or OAuth/service principal, ideally from Secrets Manager).

**Triggering dbt** — run dbt as a Databricks/Glue/ECS task, via the `BashOperator`/`KubernetesPodOperator`, or with **Cosmos** (astronomer-cosmos), which renders a dbt project as native Airflow task groups so each dbt model is an observable Airflow task with proper dependencies.

**Airflow vs Step Functions vs Databricks Workflows — when to pick which:**

| | Pick when |
|---|---|
| **Airflow / MWAA** | Cross-service, cross-platform DAGs; rich scheduling (backfill, datasets, catchup); a team that lives in Python; you want one pane of glass over Glue + Redshift + Databricks + dbt. The general-purpose orchestrator. |
| **AWS Step Functions** | Event-driven, serverless, AWS-only workflows; pay-per-transition (no idle cluster); tight Lambda/SQS/ECS integration; lower ops than even MWAA. Weaker at data-pipeline ergonomics (backfill, data intervals, lineage). |
| **Databricks Workflows / Jobs** | Orchestration that lives *entirely inside* Databricks (notebooks, DLT pipelines, Spark) — best Spark integration, no external orchestrator to run. Weaker once you must coordinate non-Databricks AWS services. |

**The architect's framing:** *"Use the orchestrator closest to the work when the work is homogeneous — Databricks Workflows for pure-Databricks, Step Functions for event-driven AWS-native. Reach for Airflow/MWAA as the meta-orchestrator when a pipeline spans Glue, Redshift, Databricks, and dbt and needs proper data-interval scheduling, backfills, and a single lineage/observability surface. A common real pattern: Airflow owns the cross-platform DAG and *triggers* Databricks Workflows for the Spark-heavy segments."*

---

# Check yourself

1. **"Your DAG takes too long to parse / the scheduler is slow — what do you check?"** → Top-level expensive code (API/DB calls, `Variable.get()`, heavy imports at module scope) running on every parse; `dag_processing.total_parse_time`; `min_file_process_interval`; number of DAG files; import errors. Move expensive work into tasks.
2. **"How do you coordinate dependencies across many pipelines?"** → Three tiers: `TriggerDagRunOperator` (push, coupled), `ExternalTaskSensor` (pull, watch interval alignment, prefer deferrable), and **Datasets/Assets** (data-as-contract, the preferred decoupled pattern).
3. **"How do you make a task idempotent, and why does it matter?"** → Overwrite-by-partition / MERGE-on-key / deterministic output paths keyed on `data_interval_start`; never `now()` or random ids. Matters because retries, catchup, and backfill all re-run tasks.
4. **"A hundred DAGs all wait on S3 files and your workers are starved — fix it."** → Deferrable operators + the triggerer (frees worker slots while waiting); or `mode="reschedule"`; not poke-mode sensors at scale.
5. **"Walk me through retries and backoff for a flaky API."** → `retries`, `retry_delay`, `retry_exponential_backoff=True`, `max_retry_delay`, `execution_timeout` so a hung try doesn't hold a slot; idempotency so a retry is safe.
6. **"MWAA or self-managed on EKS?"** → Default MWAA (low ops, AWS-integrated, Secrets Manager backend, VPC, CloudWatch). EKS only for a concrete constraint: unsupported version/executor/plugin, KubernetesExecutor with bespoke pods, or very high scale with a platform team to amortise.
7. **"Explain logical date / data interval and why people get it wrong."** → A run *for* an interval fires at its end; slice data by `data_interval_start/end`, never wall-clock. `execution_date` → `logical_date` rename exists because of this confusion.
8. **"catchup=True vs False — what's safe?"** → `catchup=False` by default to avoid a stampede of historical runs on deploy; enable catchup deliberately when you want to fill history (and only if tasks are idempotent).
9. **"How do you secure credentials in MWAA?"** → Secrets Manager backend resolving connections/variables (prefixed lookups), IAM execution role with least privilege, private-network web server, VPC with controlled egress; nothing in the DAG files.
10. **"How does branching interact with downstream joins?"** → `@task.branch` skips the not-chosen paths; the join must use `none_failed_min_one_success`, or skips poison it under the default `all_success`.
11. **"You need to process an unknown number of files in parallel — how?"** → Dynamic task mapping (`.expand` / `.partial`), not hand-looped operators; bound it with pools / `max_active_tasks_per_dag`.
12. **"Airflow vs Step Functions vs Databricks Workflows for this platform?"** → §9 framing: closest-to-the-work for homogeneous, Airflow as meta-orchestrator across Glue/Redshift/Databricks/dbt; Airflow often *triggers* Databricks Workflows.

---

# Vocabulary

- *"Logical date / data interval"* — never "execution date means now."
- *"Data-aware scheduling" / "datasets" (2.x) / "assets" (3.x)* — the decoupled cross-DAG pattern.
- *"Deferrable operators / the triggerer"* — the worker-starvation answer.
- *"Idempotent / re-runnable for a logical date"* — the reliability core.
- *"Top-level code"* — what *not* to put in a DAG file.
- *"Parse time / scheduler heartbeat"* — the health signals.
- *"Pools / parallelism / max_active_runs"* — the concurrency knobs.
- *"Trigger rules / none_failed_min_one_success"* — the branching-join fix.
- *"Secrets Manager backend"* — the MWAA credential pattern.
- *"Submit-and-sense"* — Airflow's role: orchestrate, don't process.
- *"DAG-as-code / DAG integrity tests"* — the CI/CD operationalization.
- *"TaskFlow API / dynamic task mapping"* — the modern authoring idiom.
- *"Meta-orchestrator"* — Airflow over Step Functions / Databricks Workflows.

---

# Things to skip

- Memorising exact MWAA vCPU/RAM/worker-count numbers per environment class — say "you pick a class and set min/max workers," look up specifics if pressed. Don't fabricate quotas.
- Airflow 1.x idioms (`SubDagOperator`, `default_view='tree'`, `provide_context=True`) — dead; 2.x/3.x baseline only.
- Deep Celery broker tuning (Redis vs RabbitMQ internals) — know it exists; MWAA manages it.
- Over-claiming Airflow 3.0 mechanics you're unsure of (exact asset API surface, deadline-alert config, DAG-versioning internals) — flag the *direction* (assets, API-server split, DAG versioning, SLA removed) without inventing detail.
- Writing transforms in PythonOperator that pull data into the worker — the anti-pattern; push compute to Glue/EMR/Databricks.
- Plugin/provider package version archaeology — know the provider names (`apache-airflow-providers-amazon`, `-databricks`), not every operator's release history.

---

