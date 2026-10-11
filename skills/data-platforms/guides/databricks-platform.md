---
title: Databricks Platform — Architect's Refresher
summary: The lakehouse on Databricks as an architect owns it — control and compute planes, Delta Lake internals, Unity Catalog, Lakeflow, Photon, CI/CD and cost tuning, with the AWS plumbing underneath.
---

## Frame

The platform decisions an architect owns on Databricks are not about writing a window function. They
are: control plane vs compute, Delta vs Iceberg, Unity Catalog vs Hive metastore, Workflows vs
Airflow, and how to make a job cheaper without making it slower.

Three mental models:

1. **Databricks is a managed Spark + Delta + governance layer on top of your own cloud account.** In
   the classic deployment the compute runs in *your* account against *your* object storage; Databricks
   runs the control plane. This split is the most important architecture fact.
2. **The lakehouse is the thesis, not a feature.** One copy of data in open formats (Delta/Parquet) on
   object storage, serving BI/SQL and ML/streaming, governed once. Photon, Unity Catalog and Lakeflow
   all serve the goal of collapsing the warehouse/lake split.
3. **Product names changed recently; know both.** *Delta Live Tables → Lakeflow Declarative
   Pipelines*; *Workflows → Lakeflow Jobs*.

A "data dictionary, metadata repository and lineage" requirement, on Databricks, *is* Unity Catalog.

---

# Section 1 — Where Databricks sits

## 1a. The lakehouse concept

The lakehouse merges two historically separate stacks:

- **Data warehouse** — schema-on-write, ACID, fast SQL/BI, expensive, closed format (Redshift,
  Snowflake, Teradata).
- **Data lake** — schema-on-read, cheap object storage, open formats, good for ML/streaming, weak on
  ACID, governance and BI performance (S3 + Parquet + Hive metastore).

**Lakehouse = lake economics + warehouse guarantees.** Parquet files on object storage, plus a
transaction layer (Delta Lake) for ACID, schema enforcement, time travel and upserts, plus governance
(Unity Catalog) and a vectorised SQL engine (Photon). One copy serves SQL, ML and streaming — data is
landed once, governed once, and not moved between a lake and a warehouse.

## 1b. Databricks vs the AWS-native alternatives

| Platform | What it is | Picks itself when |
|---|---|---|
| **Databricks** | Managed Spark + Delta + Unity Catalog + Photon SQL; lakehouse for BI **and** ML/streaming | Mixed SQL + ML/streaming, open formats, multi-cloud portability, heavy Spark |
| **Snowflake** | SQL-first cloud warehouse; separates storage/compute; added Iceberg tables, Snowpark, streaming | BI/analytics-dominant, SQL teams, low-ops |
| **EMR** | Managed Hadoop/Spark clusters you run and tune | Cost-tuned bespoke Spark/Hadoop, full cluster control, no platform premium |
| **AWS Glue** | Serverless Spark ETL + Glue Data Catalog | Serverless AWS-native ETL, light orchestration |
| **Redshift** | AWS MPP SQL warehouse (+ Spectrum, Serverless) | AWS-committed BI warehouse |

- **vs Snowflake** — the canonical lakehouse-vs-warehouse debate. Databricks is Spark/ML-native with
  open Delta on your storage; Snowflake is SQL-native and historically a closed managed store (now
  opening via Iceberg). See [Snowflake](./snowflake-platform.md).
- **vs EMR/Glue** — same Spark engine, but Databricks adds Delta, Unity Catalog, Photon and managed
  ops. EMR/Glue is cheaper per core and more controllable, but you own the platform engineering,
  metastore and governance. See [AWS data engineering](./aws-data-engineering-stack.md).
- **vs Redshift** — Redshift is a warehouse, not a compute engine for arbitrary Spark/ML.

## 1c. The medallion architecture (bronze / silver / gold)

The canonical multi-hop layering — the lakehouse equivalent of staging → integration → marts:

- **Bronze** — raw, append-only landing, exactly as ingested (Kafka, files, CDC); full history and
  replayability.
- **Silver** — cleansed, conformed, deduplicated, joined; the trustworthy "single version" layer.
- **Gold** — business-level aggregates and marts serving BI and ML features; often star schemas.

It is a *convention*, not a product: each layer is Delta tables, and data flows bronze → silver →
gold via jobs or pipelines.

---

# Section 2 — Platform architecture

## 2a. Control plane vs compute (data) plane

- **Control plane** — runs in **Databricks' own cloud account**: web UI, notebooks, job scheduler,
  cluster manager, Unity Catalog metadata service, query history. Metadata and orchestration, not data.
- **Compute plane** — in the classic model, runs in **your cloud account**: clusters (EC2) reading and
  writing **your S3** inside **your VPC**. With **serverless**, the VMs run in a Databricks-managed
  account — trading some network-isolation control for zero cluster ops and fast startup.

In the classic model your data never has to leave your account — the argument that carries enterprise
security reviews.

## 2b. Workspaces

A **workspace** is the unit of collaboration and isolation: notebooks, jobs, clusters, repos and
dashboards at one URL, mapped to one cloud deployment. Common patterns: per environment, per business
unit, or per data domain. The **account** (account console) sits above workspaces; Unity Catalog
metastores and identity federation (SCIM/SSO) are administered there.

## 2c. Cluster / compute types

| Type | Use | Notes |
|---|---|---|
| **All-purpose clusters** | Interactive dev, ad-hoc notebooks | Stay up, shared; most expensive per unit of work — not for production jobs |
| **Job clusters** | Triggered by a job; spin up, run, terminate | Cheaper, isolated per run; the default for scheduled pipelines |
| **SQL warehouses** | Databricks SQL — BI, dashboards, ad-hoc SQL | T-shirt sized; Photon on; classic, pro and serverless |
| **Serverless** | Compute managed entirely by Databricks | Sub-minute startup, no cluster config; pay per use |

Rule of thumb: **interactive → all-purpose; scheduled production → job clusters or serverless jobs;
BI/SQL → SQL warehouses.** Cost discipline starts with not leaving all-purpose clusters running.

## 2d. DBFS vs Unity Catalog volumes

- **DBFS** — a legacy abstraction over object storage mounted into the workspace. The old `/mnt`
  **mount points** with embedded credentials are discouraged: workspace-scoped, no fine-grained
  governance, a security smell.
- **Unity Catalog volumes** — the governed way to handle non-tabular files (CSV, images, models, init
  scripts): UC objects (`catalog.schema.volume`) with grants and lineage, backed by an external
  location. New work uses volumes.

## 2e. How it runs on AWS

- **Cross-account IAM role** — lets the control plane launch and terminate EC2 in your account.
- **S3** — the lake (Delta tables, volumes) plus a workspace root bucket; UC **storage credentials**
  (an IAM role) and **external locations** (an S3 path) govern access.
- **VPC** — a customer-managed VPC controls subnets, security groups and egress; PrivateLink for
  private connectivity.
- **Compute** — EC2 + EBS, optionally Graviton instances and spot for cost.

---

# Section 3 — Delta Lake internals

Delta Lake is the open table format behind the lakehouse: **Parquet data files + a transaction log**,
giving ACID over object storage.

## 3a. The transaction log

Each table directory holds Parquet data files plus a `_delta_log/` folder of ordered JSON commit files,
periodically compacted into Parquet **checkpoints**. A reader replays the log to know exactly which
files constitute the table at a given version. This gives:

- **ACID transactions** — commits are atomic; concurrent writers use **optimistic concurrency
  control** (write, check for conflicts at commit, retry on conflict).
- **Snapshot isolation** — readers see a consistent version while writes happen.

## 3b. Time travel

```sql
SELECT * FROM sales VERSION AS OF 42;
SELECT * FROM sales TIMESTAMP AS OF '2026-05-20';
RESTORE TABLE sales TO VERSION AS OF 41;
```

Uses: reproducible ML training sets, audit, rollback, debugging a bad load. Retention is bounded by
what `VACUUM` has removed.

## 3c. MERGE / upsert

```sql
MERGE INTO silver.customer t
USING staging.customer_cdc s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.op = 'D' THEN DELETE
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;
```

The backbone of CDC ingestion and slowly changing dimensions. **Change Data Feed (CDF)** exposes a
table's row-level changes for downstream incremental consumption.

## 3d. Schema enforcement vs schema evolution

- **Enforcement** (default) — a write with a mismatched schema is rejected. Protects silver/gold from
  upstream drift.
- **Evolution** — opt in (`mergeSchema`, or `autoMerge` for MERGE) to let *additive* changes flow
  through. **Enforce by default, evolve deliberately** — evolution is not a licence to ignore contracts.

## 3e. OPTIMIZE, Z-ORDER and liquid clustering

- **OPTIMIZE** — compacts many small files into fewer right-sized files.
- **Z-ORDER** — `OPTIMIZE … ZORDER BY (col)` co-locates related values for better data skipping on
  high-cardinality filter columns; columns chosen up front, OPTIMIZE re-run.
- **Liquid clustering** — the modern replacement for both partitioning and Z-ORDER. `CLUSTER BY (col)`
  lets Databricks manage layout incrementally and change clustering keys without rewriting the table.
  Recommended for all new tables, including streaming tables, materialized views and managed Iceberg
  tables.

## 3f. VACUUM, deletion vectors, small-file problem

- **VACUUM** — removes unreferenced data files older than the retention threshold (default 7 days).
  Reclaims storage but **shrinks the time-travel window**.
- **Deletion vectors** — instead of rewriting a Parquet file to delete or update a few rows, Delta
  records which rows are deleted in a side vector (merge-on-read) and defers the rewrite to OPTIMIZE.
- **Small-file problem** — streaming and frequent micro-batches produce many tiny files; per-file
  overhead kills reads. Fixes: compaction, auto-compaction + optimized writes, liquid clustering, no
  over-partitioning.

## 3g. Delta vs Iceberg vs Hudi, and UniForm

All three give ACID, time travel and schema evolution over Parquet on object storage; they differ in
metadata design and ecosystem:

- **Delta Lake** — originated at Databricks; JSON log + checkpoints; deepest Databricks integration.
- **Apache Iceberg** — hidden partitioning, manifest-based metadata, the broadest multi-engine support
  (Snowflake, Trino, Flink, AWS). The de facto vendor-neutral standard; AWS S3 Tables and Glue lean
  Iceberg.
- **Apache Hudi** — upsert/incremental-first; copy-on-write and merge-on-read modes; popular for
  CDC-heavy ingestion.

**Delta UniForm** — Delta tables that also expose Iceberg (and Hudi) metadata, so external engines
read them as Iceberg without copying data. Paired with Unity Catalog's **Iceberg REST catalog**, it
gives governed cross-engine access.

When *not* to pick Delta: a multi-engine, vendor-neutral estate where Iceberg is the lingua franca.
With UniForm the choice is less binary than it was.

---

# Section 4 — Unity Catalog

Unity Catalog (UC) is Databricks' **account-level governance and metadata layer**.

## 4a. Three-level namespace

`catalog.schema.table` (e.g. `prod.sales.orders`) replaces Hive's two-level `schema.table`:

- **Catalog** — top-level container, often per environment or domain.
- **Schema** — grouping of tables, views, volumes, functions and models.
- **Object** — table, view, volume, function or model.

One metastore per region serves every workspace, so a table has the same name everywhere.

## 4b. Governance and grants

ANSI-style SQL grants with inheritance down the hierarchy:

```sql
GRANT USE CATALOG ON CATALOG prod TO `analysts`;
GRANT SELECT ON TABLE prod.sales.orders TO `analysts`;
```

Plus **row filters and column masks** (functions applied as policies) and tag-based governance.
Identities come from the account (SCIM/SSO), so access is central rather than per workspace.

## 4c. Built-in lineage and discovery

UC captures **table- and column-level lineage** automatically for notebooks, SQL, jobs and pipelines,
and exposes it in the UI, APIs and system tables, with search, tags and comments. The three-level
namespace is the data dictionary, system tables and the UI are the metadata repository, and lineage
is automatic. For a heterogeneous estate, UC lineage is federated out via OpenLineage into a
cross-platform catalog.

## 4d. Storage credentials, external locations, managed vs external tables

- **Storage credential** — a UC object wrapping an IAM role that can access S3.
- **External location** — binds an S3 path to a storage credential, with grants. S3 access is
  governed centrally, not through mounts or instance profiles.
- **Managed vs external tables** — managed tables live in UC-managed storage and UC owns their
  lifecycle (including predictive optimization); external tables point at a path you manage.

## 4e. vs legacy Hive metastore

| | Hive metastore (legacy) | Unity Catalog |
|---|---|---|
| Scope | Per workspace | Account-wide (per-region metastore) |
| Namespace | `schema.table` | `catalog.schema.table` |
| Access control | Coarse, workspace-local | Fine-grained grants, row/column policies, account identities |
| Lineage | None native | Automatic table + column lineage |
| Files | DBFS mounts | Governed volumes + external locations |

Legacy workspaces are upgraded by binding to a metastore and migrating tables into UC catalogs.

---

# Section 5 — Orchestration on Databricks

## 5a. Jobs / Workflows (Lakeflow Jobs)

A **job** is a DAG of **tasks**; each runs a notebook, script, wheel, SQL, dbt or a pipeline.

- **Dependencies** — fan-out/fan-in, conditional (`if/else`) tasks, `for-each` loops, task values.
- **Triggers** — scheduled (cron), file arrival, continuous, table update.
- **Retries, timeouts, notifications** — per task and per job.
- **Compute** — job clusters or serverless; a job cluster can be shared across tasks.

## 5b. Lakeflow Declarative Pipelines (formerly Delta Live Tables)

A **declarative** framework: you declare target tables and their transformations (SQL or Python); the
runtime manages the DAG, incremental processing, checkpoints, retries and infrastructure.

- **Streaming tables and materialized views** are the declarative targets; the engine decides
  incremental vs full refresh.
- **Expectations** — declarative data-quality constraints: warn, drop the row, or fail the update.
- **Auto Loader** (`cloudFiles`) — incremental file ingestion with schema inference and evolution; the
  standard bronze-ingestion tool.

```python
from pyspark import pipelines as dp

@dp.table
@dp.expect_or_drop("valid_amount", "amount > 0")
def silver_orders():
    return spark.readStream.table("bronze_orders").where("status IS NOT NULL")
```

The current Python API lives in `pyspark.pipelines`; the older `import dlt` / `@dlt.table` API still
works unchanged.

## 5c. vs Airflow / MWAA

| | Databricks Workflows / Lakeflow | Airflow / Amazon MWAA |
|---|---|---|
| Scope | Tasks inside the lakehouse | Cross-system, cloud-agnostic |
| Strength | Native task types, serverless compute, native DQ | Orchestrating across Databricks, Glue, Lambda, Redshift, external systems |
| When | Pipelines wholly inside Databricks | Enterprise DAGs spanning many services |

In a mixed estate Airflow is usually the top-level orchestrator, calling Databricks through its
operators; Databricks owns the in-platform work.

---

# Section 6 — Databricks SQL and Photon

- **Databricks SQL (DBSQL)** — SQL editor, dashboards, alerts, query history and BI connectors, on
  **SQL warehouses** (classic, pro, serverless).
- **Photon** — a **vectorised C++ query engine** that transparently accelerates SQL and DataFrame
  workloads with no code change. It does not accelerate arbitrary Python UDFs or RDD code.

Photon is why BI can be served directly off Delta gold tables without exporting to a separate
warehouse.

---

# Section 7 — Dev workflow and CI/CD

- **Notebooks** — interactive and multi-language; production prefers source files over UI-only notebooks.
- **Git folders (Repos)** — native Git integration; notebooks stored as source for clean diffs.
- **Databricks Asset Bundles (DABs)** — infrastructure-as-code packaging for a project: a
  `databricks.yml` describing jobs, pipelines and clusters, deployed per environment with the CLI. The
  recommended CI/CD unit, replacing `dbx` and hand-rolled API scripts.

```yaml
bundle:
  name: orders
targets:
  dev:  { mode: development }
  prod: { mode: production }
resources:
  jobs:
    nightly_orders:
      tasks:
        - task_key: silver
          notebook_task: { notebook_path: ./src/silver.py }
```

- **CLI and REST APIs** — Jobs, Clusters, Unity Catalog, SQL Statement Execution.
- **Terraform provider** — manages workspaces, clusters, jobs, UC catalogs and grants, secrets —
  alongside the cloud provider, so VPC, IAM, storage and Databricks are one IaC codebase.

A typical pipeline: PR runs tests and linting; merge deploys bundles dev → staging → prod via the
CLI; Terraform manages the workspace and grants alongside the cloud infrastructure.

---

# Section 8 — Performance tuning

**Sizing** — right-size; autoscaling for variable load; serverless to remove idle and startup cost.
For SQL warehouses, scale *up* (size) for per-query speed and *out* (multi-cluster) for concurrency.

**Engine** — Photon on for SQL/DataFrame work. **Adaptive Query Execution (AQE)** re-optimises at
runtime — coalescing shuffle partitions, switching join strategies, handling skew — so do not fight it
with manual tuning unless a problem is measured.

**Data layout** — fix small files; prefer liquid clustering; reserve physical partitioning for huge
tables with a stable low-cardinality key; disk cache and result cache for hot data.

**Joins and skew** — **broadcast joins** ship a small dimension to every executor and avoid the
shuffle (AQE does it automatically below a threshold); **salting** a hot key is the last resort for
pathological skew.

**Cost** — spot for fault-tolerant job clusters, Graviton, autoscaling + auto-termination, serverless,
and **predictive optimization** (UC runs OPTIMIZE and VACUUM on managed tables automatically).

Making a job cheaper without making it slower: move it off an all-purpose cluster onto a right-sized
job cluster or serverless; turn on Photon and let AQE work; fix file layout so less is scanned; use
spot, autoscaling and auto-termination. The cheapest query is the one that scans the least data.

---

# Section 9 — Security and governance

- **Unity Catalog + IAM** — UC grants on top of IAM; S3 access brokered through storage credentials
  and external locations, not broad bucket policies or instance profiles.
- **Secrets** — secret scopes (workspace-backed or Secrets Manager-backed), read with
  `dbutils.secrets.get(...)`, never hard-coded.
- **Network isolation** — customer-managed VPC, private subnets, no public egress; **front-end
  PrivateLink** (user → workspace) and **back-end PrivateLink** (compute → control plane); IP access
  lists. Serverless network controls work differently — a trade-off to call out.
- **Identity** — SSO + SCIM at the account level; groups drive UC grants.
- **Compliance** — audit logs and system tables; encryption at rest (SSE/KMS) and in transit.

---

# Section 10 — Recent developments (2025–2026)

- **Catalog commits** — Unity Catalog becomes the coordinator of commits for UC-managed Delta tables,
  brokering state across engines and enabling multi-statement, multi-table transactions.
- **Attribute-based access control (ABAC)** — governed tags dynamically enforce row filters and
  column masks across tables, materialized views and streaming tables; the scalable successor to
  per-table policies.
- **Lakebase + Lakehouse Sync** — a managed Postgres OLTP layer next to the lakehouse, with continuous
  CDC replication into UC-managed Delta: operational and analytical data under one governance.
- **Liquid clustering everywhere** — recommended for all new tables.
- **The Lakeflow family** — Lakeflow Connect (managed ingestion), Lakeflow Declarative Pipelines
  (ETL, formerly DLT), Lakeflow Jobs (orchestration, formerly Workflows).

---

# Review questions

1. **Control plane vs compute plane?** Control plane in Databricks' account (UI, scheduler, UC
   metadata); compute in your account/VPC reading your storage; serverless moves the VMs into a
   Databricks-managed account.
2. **When would you not pick Delta?** A multi-engine, vendor-neutral estate where Iceberg is the
   standard — softened by UniForm and the UC Iceberg REST catalog.
3. **Partitioning vs Z-order vs liquid clustering?** Liquid clustering by default; Z-order is the older
   static approach; physical partitioning only for huge tables with stable low-cardinality keys.
4. **Workflows or Airflow?** Workflows/Lakeflow for in-platform pipelines; Airflow as the cross-system
   orchestrator calling Databricks.
5. **DBFS mounts vs UC volumes?** Mounts are legacy, workspace-scoped, ungoverned, with embedded
   credentials; volumes and external locations are governed UC objects with grants and lineage.
6. **What does Photon not accelerate?** Arbitrary Python UDFs and RDD code.
7. **How do you secure S3 access?** Storage credentials + external locations with grants, secret
   scopes, customer-managed VPC + PrivateLink, least privilege.
8. **A source-system → lakehouse migration?** CDC/batch extract → bronze (Auto Loader) → MERGE into
   silver → gold marts; UC for governance and lineage; phased by domain with backfill + delta.
