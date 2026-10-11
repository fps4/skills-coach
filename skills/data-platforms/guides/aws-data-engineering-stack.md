---
title: AWS Data Engineering Stack — Architect's Primer
summary: The AWS-native data plane — S3, Glue, EMR, Redshift, Athena, Lambda, Step Functions, SageMaker Unified Studio and Lake Formation — and when to use each instead of, or under, Databricks.
---

## Frame

On AWS the data platform is assembled from services, and Databricks — when present — sits on top of
that same plane. The architect's job is to reason about the AWS data plane and about when to use
AWS-native services versus Databricks.

Three mental models:

1. **On AWS the lakehouse is assembled, not bought.** S3 = storage tier; an open table format
   (Iceberg/Delta/Hudi) = table tier; a catalog (Glue Data Catalog / Lake Formation, increasingly
   **S3 Tables / SageMaker Lakehouse** managed Iceberg) = metadata tier; a compute engine (Athena, EMR,
   Redshift Spectrum, Glue, or Databricks) = query tier. Decoupled and swappable.
2. **Compute is a spectrum from fully managed pay-per-query to run-your-own-cluster.** Lambda → Athena
   → Glue → EMR Serverless → EMR on EKS → EMR on EC2 → Databricks. Left = least ops and control,
   bursty; right = most control, sustained heavy work. Most "Glue vs EMR vs Databricks" questions are
   "where on this spectrum does the workload sit, and why".
3. **Storage and catalog are the gravity well; engines are interchangeable.** Pick table format and
   catalog first — they are sticky. Engine choice stays reversible if data is open-format on S3 with a
   shared catalog.

---

# Section 1 — S3 as the data-lake foundation

## 1A. Storage classes

| Class | Use for | Note |
|---|---|---|
| **S3 Standard** | Hot data | Per-GB + request cost |
| **S3 Intelligent-Tiering** | Unknown or changing access patterns | Moves objects between tiers automatically; the default for lake landing zones |
| **Standard-IA / One Zone-IA** | Warm, rarely read | Cheaper storage, dearer retrieval, minimum-duration billing |
| **Glacier Instant Retrieval** | Archive with occasional ms reads | |
| **Glacier Flexible / Deep Archive** | Cold compliance archive | Retrieval minutes to hours; cheapest |

## 1B. Partition layout

- **Hive-style partitioning** — `s3://bucket/table/year=2026/month=05/day=25/` lets Athena, Glue and
  Spectrum **prune partitions**. Engines bill by bytes scanned or compute time, so pruning is money.
- **Right-size files** — about 128 MB–1 GB columnar files. Many tiny files = the **small-files
  problem**; compaction (or Iceberg/Delta `OPTIMIZE`) is standing maintenance.
- **Columnar formats** — Parquet / ORC for analytics (column pruning, predicate pushdown,
  compression); Avro for row-oriented streaming. Open table formats add ACID, time travel, schema
  evolution and hidden partitioning.
- **Avoid over-partitioning** — partition on what queries filter on (date, region), not on
  high-cardinality keys.

## 1C. Lifecycle, encryption, security

- **Lifecycle policies** — transition Standard → IA → Glacier by age; expire temp files and old versions.
- **Encryption** — **SSE-S3** baseline; **SSE-KMS** for key policies, rotation, CloudTrail audit of key
  use and per-team key separation. Default bucket encryption on; TLS enforced with an
  `aws:SecureTransport` deny policy.
- **Access layers** — IAM policies (identity), bucket policies (resource), **Block Public Access**
  (keep it on), **VPC gateway endpoints**, and **Lake Formation** for table/column/row governance.
- **Audit and immutability** — access logs, CloudTrail data events, **Object Lock** (WORM).

## 1D. S3 as the lakehouse storage tier

S3 holds the bronze/silver/gold layers; Delta, Iceberg, Glue and Athena read and write the same
objects. **S3 Tables** (managed Iceberg buckets with auto-compaction) and the **SageMaker Lakehouse**
are the managed-Iceberg path that lets Redshift, Athena, EMR, Glue and SageMaker query one set of
tables. Keep gold data in an open table format on S3 so engine choice stays reversible.

---

# Section 2 — AWS Glue

Glue is **serverless Spark + a managed Hive-compatible catalog + crawlers + a visual job builder**.

## 2A. DataFrame vs DynamicFrame

- **DataFrame** — standard Spark; full API and Spark SQL when you control the schema.
- **DynamicFrame** — Glue's schema-flexible abstraction for messy or drifting sources, with **choice
  types**, `resolveChoice`, Glue transforms and catalog integration.

```python
dyf = glueContext.create_dynamic_frame.from_catalog(database="raw", table_name="orders")
dyf = dyf.resolveChoice(specs=[("amount", "cast:double")])
df = dyf.toDF()   # full Spark API from here
```

DynamicFrame for dirty ingestion; convert to DataFrame for heavy, schema-stable logic.

## 2B. Job types

- **Spark jobs** — the main ETL path, billed per **DPU-hour** (worker types G.1X … G.8X, G.025X).
- **Python-shell jobs** — single-node Python at a fraction of a DPU, for small tasks. Do not reach for
  Spark when this will do.
- **Streaming jobs** — Structured Streaming from Kafka or Kinesis.
- **Ray jobs** — Python-native distributed compute.

## 2C. Crawlers and the Glue Data Catalog

- **Crawlers** scan S3 or JDBC sources, infer schema and partitions, and register tables.
- **Glue Data Catalog** — a **Hive-metastore-compatible** store **shared by Athena, EMR, Redshift
  Spectrum and Glue**, and readable by Databricks. One table definition, many engines — what keeps
  engine choice reversible.
- **Partition projection** — Athena computes partitions from a pattern instead of looking them up, for
  tables with very many partitions.

## 2D. Job bookmarks and versions

- **Job bookmarks** persist what has been processed (by file, timestamp or key) so reruns handle only
  new data — incremental ETL without hand-tracked watermarks.
- **Glue Studio** — visual authoring that generates PySpark; **DataBrew** — no-code data prep.
- **Glue versions** pin the Spark runtime (4.0 = Spark 3.3, 5.0 = Spark 3.5).

## 2E. When Glue

Serverless, event-driven, intermittent or moderate Spark ETL with native catalog and bookmark
integration. More expensive per unit than tuned EMR for sustained heavy jobs, with less control.

---

# Section 3 — Amazon EMR

Managed Hadoop/Spark (Spark, Hive, Trino, HBase, Flink, Hudi/Iceberg) for full control and sustained
heavy compute.

| Model | What it is | Use when | Cost lever |
|---|---|---|---|
| **EMR on EC2** | Classic cluster you size and tune | Long-running clusters, full control, broad Hadoop ecosystem | Spot task nodes; savings plans for core nodes |
| **EMR on EKS** | Spark jobs as pods on shared Kubernetes | Already on Kubernetes; bin-pack Spark with other workloads | Existing EKS capacity; spot node groups |
| **EMR Serverless** | Submit an app; it provisions and scales | Bursty or unpredictable work without cluster ops | Pay only while running; pre-initialised capacity |

**Spot strategy:** core nodes (HDFS, shuffle) on-demand for stability; task nodes on spot for cheap
compute; design for interruption.

**EMR vs Databricks:** Databricks buys developer experience, Photon, Unity Catalog, notebooks and
MLflow as a managed product; EMR buys raw open-source Spark/Hadoop control inside the AWS account at
lower platform cost. See [Databricks](./databricks-platform.md).

---

# Section 4 — Amazon Redshift

AWS's **columnar MPP cloud data warehouse**.

## 4A. Architecture

- **Leader node** — parses SQL, plans, coordinates, aggregates results; holds no customer data.
- **Compute nodes** — store data and run steps in parallel, divided into **slices** (one per core).
- **RA3 + Redshift Managed Storage** — **decouples compute from storage**: hot data cached on local
  NVMe, the rest in S3-backed managed storage billed separately.
- **Redshift Serverless** — capacity in **RPUs**, auto-scaling, pay per use, for spiky or dev work;
  provisioned RA3 for predictable sustained production.
- **Concurrency Scaling** adds transient clusters for query spikes; **Data Sharing** exposes live data
  across clusters and accounts without copies.

## 4B. Distribution styles and sort keys

| Style | Behaviour | Use when |
|---|---|---|
| **KEY** | Same key value → same slice | Large fact joined to a dimension on that key — co-located join |
| **ALL** | Full copy on every node | Small, often-joined dimensions |
| **EVEN** | Round-robin | No clear join key; staging |
| **AUTO** | Redshift chooses and adapts (default) | Unless you know a hot join |

**Sort keys** order data on disk; **zone maps** (min/max per block) let Redshift skip blocks.
**Compound** (default) works on a leftmost prefix; **interleaved** weights several columns equally
but costs more to maintain and is rarely used now. Fact-table target: **distribute on the join key,
sort on the filter date**.

## 4C. Query optimisation

- **VACUUM** reclaims space and re-sorts; **ANALYZE** refreshes planner statistics. Both run
  automatically, but run them after big loads.
- **WLM** queues allocate memory and concurrency (auto by default; manual for hard isolation); **Short
  Query Acceleration** fast-lanes small queries; **Query Monitoring Rules** log or kill runaways.
- **Result cache** and **materialised views** (incremental / auto-refresh) for repeated aggregations.
- **Late-binding views** (`WITH NO SCHEMA BINDING`) resolve base tables at query time, so tables can be
  recreated and Spectrum tables referenced without breaking the view.
- **COPY** bulk-loads from S3 in parallel and picks encodings; never load row by row.
- **Slow query workflow:** `EXPLAIN` / system views → **DS_DIST_BOTH / DS_BCAST_INNER** (redistribution
  = wrong distribution key), large scanned rows (sort key, stale stats), disk spills (WLM memory),
  missing compression.

## 4D. Redshift Spectrum

Queries S3 directly from Redshift through **external tables** in the Glue Data Catalog, on a separate
serverless fleet billed by **bytes scanned**. The **hot/cold union**: recent data in managed storage,
history in S3, joined by a late-binding view.

```sql
CREATE VIEW sales_all AS
SELECT * FROM sales_hot
UNION ALL
SELECT * FROM spectrum.sales_cold
WITH NO SCHEMA BINDING;
```

---

# Section 5 — Amazon Athena

- **Serverless managed Trino** over S3 and the Glue Data Catalog; **pay per TB scanned**.
- **Cost = bytes scanned**: partition (with projection), columnar Parquet/ORC, compression, select only
  needed columns, convert raw JSON/CSV before querying at scale.
- **CTAS** and `INSERT INTO` write results back to S3 as partitioned Parquet — serverless ELT.

```sql
CREATE TABLE gold.orders_daily
WITH (format = 'PARQUET', partitioned_by = ARRAY['order_date']) AS
SELECT customer_id, SUM(amount) AS total, order_date
FROM raw.orders GROUP BY customer_id, order_date;
```

- **Federated queries** — Lambda-based connectors query JDBC databases, DynamoDB, Redshift and more.
- **Iceberg support** — reads and writes Iceberg tables with row-level updates and time travel.
- **When Athena:** ad-hoc exploration, infrequent queries, log analytics. Not for high-concurrency
  dashboards (Redshift) or heavy iterative transforms (Glue/EMR/Databricks).

---

# Section 6 — Lambda for data

- **Event-driven glue, not an ETL engine** — triggers and orchestrates, light transforms, fan-out.
- **Patterns:** S3 `ObjectCreated` → Lambda → start a Glue job or Step Functions; stream consumers;
  scheduled kick-offs; record-level enrichment.
- **Limits:** 15-minute maximum run, 10 GB memory, 10 GB `/tmp`, 6 MB synchronous payload, 250 MB
  unzipped package (10 GB as a container image), concurrency throttling.
- **Not for** large-dataset transforms, long jobs, big shuffles, sustained throughput, stateful Spark.
  Lambda triggers the heavy lifting; Glue, EMR or Databricks does it.

---

# Section 7 — Step Functions

Serverless workflow orchestration — state machines in Amazon States Language.

## 7A. Standard vs Express

| | **Standard** | **Express** |
|---|---|---|
| Duration | up to 1 year | up to 5 minutes |
| Pricing | per state transition | per execution + duration |
| Semantics | exactly-once, durable, visual history | at-least-once (sync) / at-most-once (async) |
| Use | long ETL/ML orchestration, approval waits | high-volume event processing |

## 7B. Patterns and resilience

- **Map** (incl. **Distributed Map** for massive S3 fan-out) and **Parallel** states.
- **Retry / Catch** — declarative retries with backoff, and error routing to a handler.

```json
"Retry": [{ "ErrorEquals": ["States.ALL"], "IntervalSeconds": 5, "BackoffRate": 2, "MaxAttempts": 3 }],
"Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "NotifyFailure" }]
```

- **Integration types** — plain SDK calls; `.sync` (run a job and wait for it); `.waitForTaskToken`
  (pause until an external callback, e.g. a human approval).

## 7C. Step Functions vs Airflow / MWAA

- **Step Functions** — serverless, pay per use, deep AWS integration, for event-driven flows; weak at
  complex DAG authoring and backfills.
- **Airflow / MWAA** — Python DAGs, rich scheduling, backfills and providers, cross-system; you pay for
  the environment when idle.
- They nest: Airflow as the macro scheduler invoking Step Functions, Glue or EMR as tasks.

---

# Section 8 — SageMaker and SageMaker Unified Studio

- **SageMaker** — the ML platform (Studio, training, endpoints, Feature Store, Pipelines, Model
  Registry). In a data stack it is the consumer of the curated lake and warehouse.
- **SageMaker Unified Studio (SMUS)** — a unified studio (GA 2025) bringing data engineering, SQL,
  big-data processing and ML/GenAI into one governed workspace, orchestrating Glue, EMR, Redshift and
  Athena over the **SageMaker Lakehouse** (managed Iceberg across S3 and Redshift data).
- **Governance via Amazon DataZone** — a **business catalog** with glossaries, discovery, lineage and
  publish/subscribe access organised by domains and projects. On an all-AWS estate this is where
  metadata, lineage and governed access are anchored; on a Databricks-centric estate that role is
  Unity Catalog.

---

# Section 9 — Governance and security

## 9A. Lake Formation

- Sits **on the Glue Data Catalog** and grants access in database/table/column/row/cell terms instead
  of raw S3 paths.
- **LF-Tags (tag-based access control)** — tag resources (e.g. `classification=PII`) and grant on the
  tag, so one grant covers everything tagged.
- Enforced across Athena, Spectrum, EMR, Glue and SMUS, because they share the catalog.

## 9B. IAM least privilege

Execution roles over long-lived keys; policies scoped to resources and conditions; **permission
boundaries** cap what a role can ever be granted; **SCPs** cap what an account in the organisation can
do. Never embed credentials in jobs.

## 9C. Secrets Manager and KMS

- **Secrets Manager** — credentials with **automatic rotation**, fetched at runtime via IAM. **SSM
  Parameter Store** is cheaper for config and simple secrets.
- **KMS** — key management for S3, Redshift, EBS and Secrets Manager; key policies and grants;
  CloudTrail logs every key use. Customer-managed keys for control and separation.

---

# Section 10 — Decision matrices

## 10A. Glue vs EMR vs Databricks

| | **Glue** | **EMR** | **Databricks** |
|---|---|---|---|
| Model | Serverless Spark | Managed Hadoop/Spark cluster | Managed lakehouse platform |
| Ops burden | Lowest | Highest (EC2) → low (Serverless) | Low |
| Control over Spark | Limited | Full | High (+ Photon) |
| Catalog | Glue Data Catalog | Glue / Hive metastore | Unity Catalog (+ can read Glue) |
| Cost shape | Per DPU-hour, no idle | Cheapest per unit when tuned | Platform premium |
| Pick when | "Run my Spark ETL, no cluster" | Cluster control, spot economics, Hadoop tools | Lakehouse, notebooks, ML, governance as a product |

## 10B. Redshift vs Athena vs Databricks SQL

| | **Redshift** | **Athena** | **Databricks SQL** |
|---|---|---|---|
| Engine | MPP columnar warehouse | Serverless Trino over S3 | Photon over Delta / Unity Catalog |
| Latency / concurrency | Low latency, high concurrency | Variable, ad-hoc | Low latency |
| Cost shape | RA3 or Serverless RPU | Per TB scanned | DBU + SQL warehouse |
| Pick when | Always-on enterprise BI | Occasional SQL over the lake | Organisation already on the lakehouse |

## 10C. Lake vs warehouse vs lakehouse on AWS

| | **Data lake** | **Data warehouse** | **Lakehouse** |
|---|---|---|---|
| Storage | S3, open formats | Redshift managed storage | S3 + open table format |
| Schema | Schema-on-read | Schema-on-write | Both; ACID tables on the lake |
| Strength | Cheap, flexible | Fast curated BI, governance | One copy, many engines, ACID + BI + ML |
| Weakness | No ACID or quality by default | Cost, less flexible for raw/ML | Operational maturity required |

---

# Review questions

1. **Glue or EMR?** Intermittent, catalog-native, low-ops → Glue; sustained heavy throughput, spot
   economics, non-Spark Hadoop tools → EMR (Serverless for EMR's engine without cluster ops).
2. **A slow Redshift query?** Look for redistribution steps (wrong distribution key), stale stats
   (ANALYZE), no block skipping (sort key), spills (WLM); consider a materialised view.
3. **Why does the Glue Data Catalog matter?** One shared Hive-compatible metastore for many engines —
   what makes engine choice reversible.
4. **When not to use Lambda?** Anything past its ceilings, heavy shuffles, sustained throughput.
5. **Keeping S3 query costs down?** Partitioning and projection, columnar formats, compaction,
   selecting only needed columns.
6. **Fine-grained access on the lake?** Lake Formation with LF-Tags, least-privilege roles, KMS,
   Secrets Manager.
7. **Spectrum vs Athena?** Both scan S3 billed by bytes; Spectrum runs from inside Redshift and joins
   external tables to managed ones.
8. **Migrating an on-prem warehouse to AWS?** Assess → land raw in S3 (DMS or Glue) → catalogue →
   transform into open-format gold → serve via Redshift, Athena or Databricks SQL → govern with Lake
   Formation → orchestrate with Airflow or Step Functions; secrets in Secrets Manager; IaC throughout.
