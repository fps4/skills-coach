---
title: Databricks Platform — Architect's Refresher
summary: Control plane vs compute, Delta vs Iceberg, Unity Catalog, Lakeflow, and how to make a job cheaper without making it slower.
topic: data-engineering
format: refresher
tags: [databricks, delta-lake, unity-catalog, spark, lakehouse, photon, aws]
updated: 2026-08-07
---

## Frame

This refresher assumes Spark, PySpark, Delta-style merge patterns, object-storage lakehouses, Kafka and cloud data services are already familiar. It is not about writing a window function — it is about **owning the platform decisions**: control plane vs compute, Delta vs Iceberg, Unity Catalog vs Hive metastore, Workflows vs Airflow, and how to make a job cheaper without making it slower.

Three mental models to hold going in:

1. **Databricks is a *managed Spark + Delta + governance* layer on top of your own cloud account.** The compute runs in *your* AWS account against *your* S3; Databricks runs the brains (the control plane). This split is the single most-probed architecture fact. Get it wrong and you sound like you've only used the notebook UI.
2. **The lakehouse is the thesis, not a feature.** "One copy of data in open formats (Delta/Parquet) on object storage, serving both BI/SQL and ML/streaming, governed once." Everything else — Photon, Unity Catalog, Lakeflow — is in service of collapsing the warehouse/lake split.
3. **Product names changed recently; say both names.** *Delta Live Tables → Lakeflow Declarative Pipelines*. Saying the old name alone signals you stopped paying attention in 2023. Saying both signals you're current.

One mapping is worth flagging up front, because it is the one people miss: the governance vocabulary — **data dictionaries, metadata repositories, data lineage** — on Databricks *is* Unity Catalog. Almost every governance requirement resolves to a UC feature, and knowing that saves inventing an architecture for a problem the platform already solves.

---

# Section 1 — Where Databricks sits

## 1a. The lakehouse concept

The lakehouse merges two historically separate stacks:

- **Data warehouse** — schema-on-write, ACID, fast SQL/BI, expensive, closed format (Redshift, Snowflake, Teradata).
- **Data lake** — schema-on-read, cheap object storage, open formats, great for ML/streaming, weak on ACID/governance/BI performance (S3 + Parquet + Hive metastore).

**Lakehouse = lake economics + warehouse guarantees.** Parquet files on S3, plus a transaction layer (Delta Lake) for ACID/schema enforcement/time travel/upserts, plus governance (Unity Catalog) and a vectorized SQL engine (Photon). One copy serves SQL, ML, and streaming.

Architect framing: *"I don't move data between a lake and a warehouse any more — I land it once in Delta on S3, govern it once in Unity Catalog, serve BI through Photon and ML through the same tables."*

## 1b. Databricks vs the AWS-native alternatives

| Platform | What it is | Picks itself when |
|---|---|---|
| **Databricks** | Managed Spark + Delta + Unity Catalog + Photon SQL; lakehouse for BI **and** ML/streaming in one | Mixed SQL + ML/streaming, open formats, multi-cloud portability, heavy Spark/PySpark |
| **Snowflake** | SQL-first cloud warehouse; separates storage/compute; recently added Iceberg tables, Snowpark, streaming | BI/analytics-dominant, SQL teams, low-ops; ML is bolt-on |
| **EMR** | Managed Hadoop/Spark clusters you run and tune yourself | Cost-tuned bespoke Spark/Hadoop, full cluster control, no platform premium |
| **AWS Glue** | Serverless Spark ETL + Glue Data Catalog | Serverless AWS-native ETL, light orchestration, Catalog-as-Hive-metastore |
| **Redshift** | AWS MPP SQL warehouse (+ Spectrum for S3, Redshift Serverless) | AWS-committed BI warehouse, tight QuickSight/RDS integration |

The honest distinctions to voice:
- **vs Snowflake** — the canonical "lakehouse vs warehouse" debate. Databricks is Spark/ML-native with open Delta on your storage; Snowflake is SQL-native and historically a closed managed store (now opening via Iceberg). Heavy Spark/streaming/ML → Databricks; pure SQL BI with a low-ops team → Snowflake is often simpler.
- **vs EMR/Glue** — same Spark engine, but Databricks adds Delta, UC governance, Photon, and managed ops. EMR/Glue is cheaper-per-core and more controllable, but you own the platform engineering, metastore, and governance.
- **vs Redshift** — Redshift is a warehouse, not a compute engine for arbitrary Spark/ML.

## 1c. The medallion architecture (bronze / silver / gold)

Databricks' canonical multi-hop layering — the lakehouse equivalent of staging → integration → marts:

- **Bronze** — raw, append-only landing. Exactly as ingested (Kafka, files, CDC), minimal transformation, full history/replayability.
- **Silver** — cleansed, conformed, deduplicated, joined. Validated and enriched; the trustworthy "single version" layer.
- **Gold** — business-level aggregates / marts, serving BI and ML features. Often star-schema or wide aggregate tables.

It's a *convention*, not a product. Each layer is just Delta tables; data flows bronze→silver→gold via jobs or Lakeflow pipelines. It is the same shape as any classical warehouse staging pattern: raw landing → conformed → analytics marts.

---

# Section 2 — Platform architecture

## 2a. Control plane vs compute (data) plane — the single most-probed fact

- **Control plane** — runs in **Databricks' own cloud account**: web UI, notebooks, job scheduler, cluster manager, Unity Catalog metadata service, query history. Holds *metadata and orchestration*, not your data.
- **Compute plane** (a.k.a. data plane) — runs in **your AWS account**: the clusters (EC2) reading/writing **your S3** inside **your VPC**. This is the "classic" deployment. With **serverless**, the cluster VMs run in a Databricks-managed account — trading some network-isolation control for zero cluster ops and fast startup.

Why an architect cares: **in the classic model your data never has to leave your account.** Credentials, network isolation, and S3 stay yours; Databricks orchestrates. The line that wins enterprise security reviews.

## 2b. Workspaces

A **workspace** is the unit of collaboration and isolation: a URL/environment containing notebooks, jobs, clusters, repos, and dashboards, mapped to one cloud deployment. Common patterns: per-environment workspaces (dev/test/prod), per-business-unit, or per-data-domain. An **account** (account console) sits above workspaces and is where Unity Catalog, identity federation (SCIM/SSO), and metastores are administered account-wide.

## 2c. Cluster / compute types

| Type | Use | Notes |
|---|---|---|
| **All-purpose clusters** | Interactive dev, ad-hoc notebooks, collaboration | Stay up, multiple users attach; most expensive per unit of work — don't run production jobs on them |
| **Job clusters** | Triggered by a Workflow job; spin up, run, terminate | Cheaper and isolated per run; the right default for scheduled pipelines |
| **SQL warehouses** | Databricks SQL — BI/dashboards/ad-hoc SQL | Sizes T-shirted (2X-Small…); **Photon** on; come in classic, pro, and **serverless** flavors |
| **Serverless** | Compute managed entirely by Databricks (jobs, SQL, notebooks) | Sub-minute startup, no cluster config/ops; runs in Databricks-managed account; pay-per-use |

Architect rule of thumb: **interactive → all-purpose; scheduled production → job clusters (or serverless jobs); BI/SQL → SQL warehouses.** Cost discipline starts with not leaving all-purpose clusters running.

## 2d. DBFS vs Unity Catalog volumes

- **DBFS (Databricks File System)** — a legacy abstraction over object storage mounted into the workspace (`/dbfs`, `dbfs:/`). The old `/mnt` **mount points** with embedded credentials are now discouraged — workspace-scoped, no fine-grained governance, a security smell.
- **Unity Catalog volumes** — the modern, *governed* way to handle non-tabular files (CSV, images, models, init scripts). Volumes are UC objects (`catalog.schema.volume`) with grants and lineage, backed by an external location. **For new work, volumes, not DBFS mounts.**

## 2e. How it runs on AWS

A Databricks-on-AWS deployment ties together:
- **Cross-account IAM role** — lets the Databricks control plane launch/terminate EC2 in your account.
- **S3** — your data lake storage (Delta tables, volumes) plus a workspace root bucket; UC **storage credentials** (an IAM role) + **external locations** (an S3 path) govern access.
- **VPC** — clusters launch into your VPC; "customer-managed VPC" lets you control subnets, security groups, and egress (PrivateLink for private connectivity, no public egress).
- **Compute plane EC2 + EBS**, optionally **Graviton** instances and **spot** for cost.

You can speak to all of this from real AWS experience — IAM cross-account roles, VPC/subnet/SG design, S3 bucket policies, PrivateLink. That's a strength, not a gap.

---

# Section 3 — Delta Lake internals

Delta Lake is the open table format that makes the lakehouse work: **Parquet data files + a transaction log**, giving ACID over object storage.

## 3a. The transaction log (`_delta_log`)

Each Delta table directory contains data Parquet files plus a `_delta_log/` folder of ordered JSON commit files (`000…0.json`, `000…1.json`, …), periodically compacted into Parquet **checkpoints**. The log is the source of truth: a reader replays the log to know exactly which files constitute the table at a given version. This is what gives:

- **ACID transactions** — commits are atomic; concurrent writers use **optimistic concurrency control** (write, then check for conflicts at commit; retry on conflict).
- **Snapshot isolation** — readers see a consistent table version even while writes happen.

## 3b. Time travel

Because the log is versioned, you can query historical state:

```sql
SELECT * FROM sales VERSION AS OF 42;
SELECT * FROM sales TIMESTAMP AS OF '2026-05-20';
```

Use cases: reproducible ML training sets, audit, rollback (`RESTORE TABLE`), debugging a bad load. Retention is bounded by what `VACUUM` has cleaned up.

## 3c. MERGE / upsert

The pattern you already know from Snowflake/Spark — first-class in Delta:

```sql
MERGE INTO silver.customer t
USING staging.customer_cdc s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.op = 'D' THEN DELETE
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;
```

This is the backbone of CDC ingestion and SCD handling — directly maps to your SAP→Snowflake "Delta-style merge patterns" and Kafka CDC experience. Also: `CDF` (Change Data Feed) exposes row-level changes for downstream incremental consumption.

## 3d. Schema enforcement vs schema evolution

- **Enforcement** (default) — a write with a mismatched schema is *rejected*. Protects silver/gold from upstream drift.
- **Evolution** — opt in (`mergeSchema`, or `autoMerge` for MERGE) to let *additive* changes (new columns) flow through automatically. The architect's line: **enforce by default, evolve deliberately** — evolution is for additive change, not a license to ignore contracts.

## 3e. OPTIMIZE + Z-ORDER, and liquid clustering (the modern replacement)

- **OPTIMIZE** — compacts many small files into fewer right-sized files (the small-file fix).
- **Z-ORDER** — `OPTIMIZE … ZORDER BY (col)` co-locates related values across files for better data skipping on high-cardinality filter columns. Classic, but you must choose columns up front and re-run OPTIMIZE.
- **Liquid clustering** — the **modern replacement for both partitioning and Z-ORDER**. `CLUSTER BY (col)` lets Databricks manage layout incrementally and adapt clustering keys without rewriting/repartitioning the whole table. The current best-practice recommendation for new tables: prefer liquid clustering over static `PARTITIONED BY` + Z-ORDER for most cases.

Say it this way: *"For new Delta tables I default to liquid clustering rather than physical partitioning plus Z-order — it avoids the over-partitioning small-file trap and lets clustering keys evolve."*

## 3f. VACUUM, deletion vectors, small-file problem

- **VACUUM** — physically removes data files no longer referenced and older than the retention threshold (default 7 days). Reclaims storage but **shrinks the time-travel window** — don't VACUUM aggressively if you need history.
- **Deletion vectors** — instead of rewriting a whole Parquet file to delete/update a few rows ("merge-on-read"), Delta records *which rows are deleted* in a side vector, deferring the rewrite. Big win for MERGE/UPDATE/DELETE on large tables; rewrite happens later at OPTIMIZE.
- **Small-file problem** — streaming and frequent micro-batches produce many tiny files, killing read performance (per-file overhead). Fixes: OPTIMIZE/compaction, liquid clustering, **auto-compaction + optimized writes**, and avoiding over-partitioning. This is a frequent tuning probe.

## 3g. Delta vs Apache Iceberg vs Hudi, and Delta UniForm

The three open lakehouse table formats — all give ACID + time travel + schema evolution over Parquet on object storage; they differ in metadata design and ecosystem:

- **Delta Lake** — originated at Databricks; native to the platform; JSON log + checkpoints. Deepest Databricks integration.
- **Apache Iceberg** — hidden partitioning, snapshot isolation, manifest-based metadata; strong multi-engine support (Snowflake, Trino, Flink, AWS). The de-facto open standard many vendors rally around; AWS S3 Tables and Glue lean Iceberg.
- **Apache Hudi** — upsert/incremental-first; copy-on-write vs merge-on-read modes; popular for CDC-heavy streaming ingestion.

**Delta UniForm (Universal Format)** — Delta tables that also expose **Iceberg (and Hudi) metadata** so external engines can read them *as if* they were Iceberg, without copying data. This is the interoperability answer: write Delta on Databricks, let an Iceberg-only consumer read it. Pair with **Unity Catalog's Iceberg REST catalog** support for cross-engine governed access.

When you would *not* pick Delta: a multi-engine, vendor-neutral estate where Iceberg is the lingua franca (heavy Trino/Flink/Snowflake/Athena reads and no Databricks lock-in appetite). The nuance that scores points: *"with UniForm the Delta-vs-Iceberg choice is less binary than it was — I can write Delta and still serve Iceberg readers."*

---

# Section 4 — Unity Catalog

Unity Catalog (UC) is Databricks' **account-level governance and metadata layer** — and the single most important part of the platform to be fluent in, because it is how Databricks delivers **data dictionaries, metadata repositories, and data lineage documentation** without a separate stack.

## 4a. Three-level namespace

UC replaces the flat Hive `schema.table` with a **three-level** name `catalog.schema.table` (e.g. `prod.sales.orders`):

- **Catalog** — top-level container (often per environment or domain).
- **Schema (database)** — grouping of tables/views/volumes/functions/models.
- **Object** — table, view, volume, function, or model.

One metastore per region serves all workspaces in the account, so a table is named the same everywhere — no more per-workspace Hive metastore islands.

## 4b. Governance / grants

ANSI-style SQL grants on UC objects, with inheritance down the hierarchy (`GRANT SELECT ON TABLE prod.sales.orders TO \`analysts\``). Plus **row filters and column masks** (functions applied as policies) and **attribute/tag-based** governance. Identities come from the account (SCIM/SSO), so access is centralized rather than per-workspace.

## 4c. Built-in lineage & discovery

UC automatically captures **table- and column-level lineage** for operations run through it (notebooks, SQL, jobs, pipelines) and surfaces it in the UI and via API/system tables. It also provides **discovery/search**, tags, comments, and an AI-assisted documentation layer. This is the "metadata repository + lineage" requirement satisfied *natively* — no separate OpenLineage backbone strictly required inside Databricks (though OpenLineage/Atlan/Collibra integrate for cross-platform estates).

Stated as one sentence: *"On Databricks, the data dictionary, metadata repository, and lineage requirement is Unity Catalog — three-level namespace for the dictionary, system tables + UI for the metadata repository, and automatic column-level lineage. For a heterogeneous estate I'd federate UC lineage out via OpenLineage into a cross-platform catalog like Atlan or Collibra."*

## 4d. Volumes, external locations & storage credentials

- **Storage credential** — a UC object wrapping an IAM role that can access S3.
- **External location** — a UC object binding an S3 path to a storage credential, with grants. All external tables/volumes reference external locations, so **S3 access is governed centrally**, not via scattered mount points or instance profiles.
- **Managed vs external tables** — managed tables live in UC-managed storage and UC owns their lifecycle (incl. predictive optimization); external tables point at a path you manage.
- **Volumes** — governed non-tabular file storage (see §2d).

## 4e. vs legacy Hive metastore

| | Hive metastore (legacy) | Unity Catalog |
|---|---|---|
| Scope | Per-workspace | Account-wide (per-region metastore) |
| Namespace | 2-level `schema.table` | 3-level `catalog.schema.table` |
| Access control | Coarse, workspace-local | Fine-grained grants, row/column policies, account identities |
| Lineage | None native | Automatic table + column lineage |
| Files | DBFS mounts | Governed volumes + external locations |

The migration story you can speak to: legacy Hive-metastore workspaces are upgraded by binding to a metastore and migrating tables into UC catalogs — a real piece of any "modernize an existing Databricks estate" roadmap.

---

# Section 5 — Orchestration on Databricks

## 5a. Jobs / Workflows

**Databricks Workflows** (the Jobs feature) is the native orchestrator. A **job** is a DAG of **tasks**; each task runs a notebook, JAR, Python script/wheel, SQL, dbt, or a Lakeflow pipeline. The capabilities that matter in practice:

- **Task dependencies** — DAG with fan-out/fan-in, conditional (`if/else`) tasks, `for-each` loops, task values passed between tasks.
- **Triggers** — scheduled (cron), file-arrival, continuous, or table-update triggers.
- **Retries** — per-task retry policy with delay; timeouts.
- **Alerts / notifications** — email/Slack/webhook on start/success/failure; job-level and task-level.
- **Compute** — runs on cheap job clusters or serverless; can share a job cluster across tasks.

## 5b. Lakeflow Declarative Pipelines (formerly Delta Live Tables / DLT)

**Say both names.** *Lakeflow Declarative Pipelines* is the rebrand/evolution of **Delta Live Tables (DLT)**, now part of the broader **Lakeflow** family (which also includes Lakeflow Connect for ingestion and Lakeflow Jobs). It is a **declarative** framework: you declare the target tables and their transformations (SQL or Python); the runtime manages the DAG, dependencies, incremental processing, checkpoints, retries, and infrastructure.

Key features:
- **Streaming tables & materialized views** as first-class declarative targets; the engine decides incremental vs full refresh.
- **Expectations** — declarative **data-quality** constraints with actions: `EXPECT` (warn), `EXPECT … ON VIOLATION DROP ROW`, or `… FAIL UPDATE`. This is the in-pipeline DQ layer (analogous to dbt tests / Great Expectations, but native and runtime-enforced).
- **Auto Loader** (`cloudFiles`) for incremental file ingestion from S3 with schema inference/evolution — the standard bronze-ingestion tool.

```python
import dlt
@dlt.table
@dlt.expect_or_drop("valid_amount", "amount > 0")
def silver_orders():
    return dlt.read_stream("bronze_orders").where("status IS NOT NULL")
```

**Syntax note (current as of 2026):** the official name is now **Lakeflow Spark Declarative Pipelines (SDP)**, and the modern Python API moved off the `dlt` module — `from pyspark import pipelines as dp`, then `@dp.table` / `@dp.materialized_view` and `@dp.expect_or_drop(...)`. The old `import dlt` / `@dlt.table` shown above still works (fully backward-compatible, no migration required), so either reads as fine — but knowing the API moved into `pyspark.pipelines` signals you're current. Say "Lakeflow Declarative Pipelines, formerly Delta Live Tables" and you're covered.

## 5c. vs Airflow / MWAA

| | Databricks Workflows / Lakeflow | Airflow / Amazon MWAA |
|---|---|---|
| Scope | Databricks-native; tasks inside the lakehouse | Cross-system, cloud-agnostic general orchestrator |
| Strength | Zero-friction Databricks task types, serverless compute, native DQ (Lakeflow) | Orchestrating *across* Databricks + Glue + Lambda + Redshift + external systems |
| When to use | Pipelines that live entirely in Databricks | Enterprise-wide DAGs spanning many services; existing Airflow estate |

The architect's reconciliation: *"For pipelines wholly inside Databricks I'd use Workflows, and Lakeflow Declarative Pipelines where I want declarative DQ. But in a real AWS enterprise estate the top-level orchestrator is usually Airflow/MWAA, calling Databricks via the `DatabricksSubmitRun`/`DatabricksRunNow` operators — Airflow owns the cross-system DAG, Databricks owns the in-platform work."* (See the companion Airflow/MWAA orchestration refresher for DAG optimization, dependency management, retries, and operationalization detail.)

---

# Section 6 — Databricks SQL & Photon

- **Databricks SQL (DBSQL)** — the BI/warehouse experience on the lakehouse: SQL editor, dashboards, alerts, query history, and a BI connector surface (Power BI, Tableau). Runs on **SQL warehouses**.
- **SQL warehouses** — dedicated SQL compute, T-shirt sized, with **classic / pro / serverless** tiers. Serverless gives near-instant startup and is the low-ops default for interactive BI.
- **Photon** — Databricks' **vectorized, C++ query engine** that transparently accelerates SQL and DataFrame workloads (no code change). It's on by default for SQL warehouses and available for clusters. It speeds up scans, joins, and aggregations and improves price/performance — but it accelerates SQL/DataFrame operations, not arbitrary Python UDFs/RDD code.

Architect framing: *"Photon is why I can serve BI directly off Delta gold tables without exporting to a separate warehouse — vectorized execution closes most of the warehouse performance gap."* Don't overclaim specific benchmark multiples — say "materially faster, no code change."

---

# Section 7 — Dev workflow & CI/CD

How Databricks work gets version-controlled, packaged and promoted between environments.

- **Notebooks** — the interactive unit; multi-language (Python/SQL/Scala/R) cells, but for production prefer source files (`.py`) over UI-only notebooks.
- **Repos / Git folders** — native Git integration (GitHub, GitLab, Bitbucket, **AWS CodeCommit**, Azure DevOps); branch, pull, commit from the workspace. Notebooks stored as source for clean diffs.
- **Databricks Asset Bundles (DABs)** — the modern **infrastructure-as-code packaging for Databricks projects**: a `databricks.yml` describing jobs, pipelines, clusters, and notebooks, deployed per-environment (dev/staging/prod) via the CLI. This is the recommended CI/CD deployment unit — replaces hand-rolled `dbx`/API scripting.
- **Databricks CLI** — scriptable control of workspaces, jobs, clusters, bundles; what the CI runner invokes.
- **REST APIs** — Jobs API, Clusters API, Unity Catalog API, SQL Statement Execution API, etc. — for automation and external integration.
- **Terraform provider** — the **`databricks` Terraform provider** manages workspaces, clusters, jobs, UC catalogs/grants, secrets — pairs with the AWS provider so the whole stack (VPC, IAM, S3, Databricks) is one IaC codebase.

A clean CI/CD story to tell (maps to your GitHub Actions + Terraform experience): *"Code in GitHub/CodeCommit; PR runs unit tests + linting; merge triggers a GitHub Actions pipeline that uses Databricks Asset Bundles via the CLI to deploy jobs/pipelines to dev→staging→prod, with the Databricks Terraform provider managing the workspace, clusters, and Unity Catalog grants alongside the AWS infra."*

---

# Section 8 — Performance tuning (architect lens)

What you'd actually probe and tune, framed as decisions not knobs:

**Sizing**
- Right-size cluster/warehouse to the workload; **autoscaling** for variable load; **serverless** to eliminate idle and startup cost.
- For SQL/BI, scale the SQL warehouse T-shirt size up for *per-query* speed, scale *out* (multi-cluster) for *concurrency*.

**Engine**
- **Photon** on for SQL/DataFrame workloads — biggest free win.
- **Adaptive Query Execution (AQE)** — runtime re-optimization (coalescing shuffle partitions, switching join strategies, handling skew) — on by default in modern runtimes; don't fight it with manual shuffle-partition tuning unless you've measured a problem.

**Data layout**
- **File sizing** — fix the small-file problem: OPTIMIZE/compaction, optimized writes + auto-compaction; target reasonably large files.
- **Partitioning vs Z-order vs liquid clustering** — don't over-partition (causes small files); prefer **liquid clustering** for new tables; reserve physical partitioning for genuinely huge tables with a stable low-cardinality partition key.
- **Caching** — Delta/disk cache on workers for hot data; result caching on SQL warehouses.

**Joins & skew**
- **Broadcast joins** for small dimension tables (broadcast the small side, avoid the shuffle) — AQE auto-broadcasts within a threshold.
- **Skew** — AQE skew handling; salting as a last resort for pathological key skew.

**Cost**
- **Spot instances** for fault-tolerant job clusters (with on-demand driver/fallback); **Graviton** for price/performance; **autoscaling + auto-termination** to kill idle; serverless to pay only for use; **predictive optimization** to let UC auto-OPTIMIZE/VACUUM managed tables.

The signature interview answer: *"You make a Databricks job cheaper without making it slower by (1) moving it off an all-purpose cluster onto a right-sized job cluster or serverless, (2) turning on Photon and letting AQE do its job, (3) fixing file layout so you scan less — liquid clustering + compaction so data skipping actually works, and (4) spot + autoscaling + auto-termination. The cheapest query is the one that scans the least data."*

---

# Section 9 — Security & governance brief

- **Unity Catalog + IAM** — UC fine-grained grants (catalog/schema/table/row/column) sit on top of AWS IAM. S3 access is brokered through UC **storage credentials** (IAM roles) and **external locations**, not broad bucket policies or instance profiles — least privilege, centrally governed.
- **Secrets** — Databricks **secret scopes** (workspace-backed or AWS Secrets Manager-backed) hold credentials; referenced in code as `dbutils.secrets.get(...)`, never hardcoded.
- **Network isolation** — customer-managed **VPC**, private subnets, security groups, no public egress; **PrivateLink** for front-end (user→workspace) and back-end (compute→control plane) private connectivity; IP access lists. For serverless, network controls are managed/limited differently — call that out as a trade-off.
- **Identity** — SSO/SAML + SCIM provisioning at the account level; groups drive UC grants.
- **Compliance posture** — audit logs (incl. UC audit + system tables) for SOX-style change/access evidence; encryption at rest (S3 SSE/KMS) and in transit.

---

# Section 10 — Recent (2025–2026): name these if asked "what's new"

The fundamentals above are stable; these are the freshest items that signal you're current. Name them at headline level — don't over-claim hands-on.

- **Catalog commits (GA, 2026)** — Unity Catalog becomes the table's **system of coordination** for UC-managed Delta tables, brokering state across engines and unlocking **multi-statement, multi-table transactions**. The deepening of "governance + transactions in one layer." Supported across streaming tables, Delta Sharing, Lakeflow, MLflow, etc.
- **Attribute-Based Access Control (ABAC) — now GA** — governed **tags** on data assets dynamically enforce row filters and column masks across tables, MVs, and streaming tables. This is the scalable evolution of the per-object grants in §4b — *"I'd drive masking/row-filtering off governed tags via ABAC rather than hand-maintaining per-table policies."*
- **Lakebase + Lakehouse Sync** — **Lakebase** is Databricks' managed **Postgres/OLTP** layer (operational data next to the lakehouse, from the Neon lineage); **Lakehouse Sync** (Public Preview) does continuous CDC replication of Lakebase Postgres into UC-managed Delta. The "OLTP and analytics under one governance umbrella" story — relevant when a client wants operational + analytical on one platform.
- **Liquid clustering as the universal default** — Databricks now recommends it for **all** new tables, including streaming tables, materialized views, and **managed Iceberg** tables (reinforces §3e — there's no "partition vs cluster" debate for new tables anymore; cluster).
- **Lakeflow family naming** — *Lakeflow Connect* (managed ingestion), *Lakeflow Declarative Pipelines / Spark Declarative Pipelines* (ETL, formerly DLT), *Lakeflow Jobs* (orchestration, formerly Workflows). If you say "Lakeflow" as the umbrella for ingest→transform→orchestrate, you sound 2026-current.

If asked something you genuinely haven't tracked: *"That's newer than my hands-on — here's the problem it solves and how I'd evaluate it,"* beats bluffing.

---

# Check yourself

1. **"Walk me through the Databricks control plane vs compute plane on AWS."**
   → Control plane in Databricks' account (UI, scheduler, UC metadata); compute in *your* account/VPC reading *your* S3; serverless moves the VMs to a Databricks-managed account. Data stays in your account in the classic model.
2. **"Delta vs Iceberg — when would you *not* pick Delta?"**
   → Multi-engine, vendor-neutral estate (heavy Trino/Flink/Snowflake/Athena) where Iceberg is the standard. Then add: UniForm + UC Iceberg REST catalog soften the choice — write Delta, serve Iceberg readers.
3. **"How do you make a Databricks job cheaper without making it slower?"**
   → Job cluster/serverless not all-purpose; Photon + AQE; fix file layout (liquid clustering + compaction) so you scan less; spot + autoscaling + auto-termination. (§8)
4. **"How does Unity Catalog satisfy a data dictionary / metadata / lineage requirement?"**
   → 3-level namespace = dictionary; system tables + UI = metadata repository; automatic column-level lineage; federate out via OpenLineage to Atlan/Collibra for heterogeneous estates. (§4c)
5. **"Partitioning vs Z-order vs liquid clustering — what do you reach for?"**
   → Liquid clustering as the modern default; Z-order is the older static approach; physical partitioning only for huge tables with stable low-cardinality keys. Don't over-partition (small files).
6. **"When Workflows, when Airflow/MWAA?"**
   → Workflows/Lakeflow for in-Databricks pipelines; Airflow/MWAA as the top-level cross-system orchestrator calling Databricks via operators. (§5c)
7. **"What's the small-file problem and how do you fix it?"**
   → Micro-batches/streaming create tiny files killing read perf; fix with OPTIMIZE/compaction, optimized writes + auto-compaction, liquid clustering, and not over-partitioning. (§3f)
8. **"DBFS mounts vs Unity Catalog volumes / external locations?"**
   → Mounts are legacy, workspace-scoped, ungoverned, credentials embedded; volumes + external locations + storage credentials are governed UC objects with grants and lineage. New work uses UC.
9. **"What's Lakeflow / DLT and how do you do data quality in it?"**
   → Lakeflow Declarative Pipelines (formerly Delta Live Tables) = declarative streaming tables/materialized views; **expectations** enforce DQ at runtime (warn / drop row / fail update). (§5b)
10. **"How would you design a SAP-on-prem → Databricks lakehouse migration?"**
    → CDC/batch extract → S3 bronze (Auto Loader) → MERGE into silver → gold marts (medallion); UC for governance/lineage; Workflows or Airflow orchestrating; phased by domain with backfill + delta — exactly the SAP→Snowflake pattern, retargeted.
11. **"What does Photon actually do, and what doesn't it accelerate?"**
    → Vectorized C++ engine, transparent speedup for SQL/DataFrame ops; doesn't accelerate arbitrary Python UDFs/RDD code. No code change required.
12. **"How do you secure S3 access from Databricks?"**
    → UC storage credentials (IAM role) + external locations with grants; secret scopes (optionally Secrets Manager-backed); customer-managed VPC + PrivateLink; least privilege over broad bucket policies.

---

# Vocabulary

- *"Control plane / compute (data) plane"* — the deployment-model signal.
- *"Lakehouse — one governed copy in open formats."*
- *"Medallion: bronze / silver / gold."*
- *"`_delta_log`, optimistic concurrency, snapshot isolation."*
- *"Deletion vectors / merge-on-read."*
- *"Liquid clustering"* — say it instead of "partition by," shows you're current.
- *"UniForm"* + *"Iceberg REST catalog"* — the interop signal.
- *"Three-level namespace: catalog.schema.table."*
- *"Storage credentials and external locations"* — the governed-S3 signal.
- *"Lakeflow Declarative Pipelines, formerly Delta Live Tables"* — always both names.
- *"Expectations"* — for in-pipeline DQ.
- *"Auto Loader / cloudFiles"* — incremental S3 ingestion.
- *"Databricks Asset Bundles (DABs)"* — the CI/CD packaging signal.
- *"Photon + AQE."*
- *"Predictive optimization"* — UC auto-maintenance.
- *"Serverless vs classic compute"* — the cost/ops trade-off.

---

# Things to skip

- **Memorizing benchmark numbers / TPC-DS multiples.** "Materially faster, no code change" is enough; invented numbers get caught.
- **Scala/JVM internals and RDD-level APIs.** PySpark + SQL is what the role uses; don't go down the Catalyst/Tungsten rabbit hole unless asked.
- **Exhaustive cluster config flags.** Know the *decisions* (all-purpose vs job vs serverless, autoscaling, spot), not every Spark conf.
- **Deep MLflow / model-serving / Mosaic AI / Genie internals.** Name them as part of the platform; this is a *data engineering / migration* architect role, not an ML platform role.
- **Azure/GCP deployment specifics.** This is an AWS partner role — keep the cloud story on AWS.
- **Delta protocol version numbers and reader/writer feature flags.** Know the *concepts* (deletion vectors, column mapping, UniForm); don't quote protocol versions.
- **Hand-rolled `dbx` / legacy deployment tooling.** Asset Bundles superseded it — mention DABs, skip the archaeology.

---

## What transfers from open-source Spark, and what doesn't

Most Databricks knowledge is Spark knowledge wearing product names, but the mapping is uneven — and the places it breaks down are worth knowing before you rely on them:

| Open-source / cloud-native experience | Databricks-product framing | How well it transfers |
|---|---|---|
| PySpark on EMR/Glue, Spark 3, Hive LLAP | Same Spark engine; Databricks adds Delta + Photon + UC over it | **Cleanly** — engine fluency is engine fluency |
| A lakehouse on object storage (EMR/Glue/S3/Terraform) | Medallion bronze/silver/gold; lakehouse architecture; S3 + IAM + VPC plumbing | **Cleanly** — re-target to Delta on S3 |
| Merge-style upserts / CDC ingestion | Delta `MERGE`, Change Data Feed, deletion vectors; Auto Loader for landing | **Cleanly** — same patterns, native syntax |
| Kafka / MSK / Confluent / structured streaming | Structured Streaming into Delta; streaming tables in Lakeflow | **Cleanly** |
| Data dictionaries, lineage, schema evolution/validation | Unity Catalog: namespace, lineage, schema enforcement/evolution | **Concepts yes; UC as an operated product is its own learning curve** |
| Airflow/MWAA, Step Functions, Glue orchestration | Databricks Workflows + Lakeflow; Airflow Databricks operators | **Concepts yes; the declarative + expectations model needs practice** |
| Terraform, GitHub Actions, CI/CD | Databricks Terraform provider + Asset Bundles + CLI | **Discipline yes; DABs specifics are new** |

**The rows that break down are the product layers, not the concepts.** Three in particular reward hands-on time rather than reading:

- **Unity Catalog as an operated product** — metastore setup, storage credentials and external locations, the grant hierarchy, predictive optimization. Knowing what a catalog *is* does not tell you how UC's grant inheritance actually resolves.
- **Workflows + Lakeflow Declarative Pipelines (DLT)** — if your orchestration background is Airflow/Glue/Step Functions, the declarative + expectations model is a genuine translation, not a rename.
- **Databricks Asset Bundles** — newer than the `dbx`/script era, and the current best practice to standardise on.

The useful distinction throughout: Spark, Delta patterns, lakehouse architecture and cloud plumbing transfer wholesale. The Databricks-native governance and pipeline *products* are where concept knowledge outruns product muscle memory — and being precise about which of the two you have is more useful than treating the whole platform as one skill.

---

