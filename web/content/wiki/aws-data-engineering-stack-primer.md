---
title: AWS Data Engineering Stack — Architect's Primer
summary: The AWS-native data plane a lakehouse sits on — S3, Glue, Redshift, EMR, Lambda, Step Functions — and when to reach for AWS-native over Databricks.
topic: data-engineering
format: primer
tags: [aws, s3, glue, redshift, emr, athena, lakehouse, iceberg]
updated: 2026-08-07
---

## Frame

A platform badged "Databricks" is usually **AWS-native underneath**: Redshift, S3, Glue, Lambda, Airflow/MWAA, Step Functions, SageMaker, SMUS, Secrets Manager. The interesting question is therefore not "do you know Databricks" — it is **"can you architect the AWS data plane that Databricks sits on, and reason about when to use AWS-native services instead?"**

Three mental models to hold going in:

1. **On AWS the lakehouse is assembled, not bought.** S3 = storage tier; an open table format (Iceberg/Delta/Hudi) = table tier; a catalog (Glue Data Catalog / Lake Formation, increasingly **S3 Tables / SageMaker Lakehouse** managed-Iceberg) = metadata tier; a compute engine (Athena, EMR, Redshift Spectrum, Glue, **or Databricks**) = query tier. Decoupled and swappable. The architect's value is choosing the right engine per workload over **one shared storage + catalog**.

2. **Compute is a spectrum: "fully managed pay-per-query" → "you run the cluster."** Lambda → Athena → Glue → EMR Serverless → EMR on EKS → EMR on EC2 → Databricks. Left = least ops/control, bursty/serverless; right = most control, sustained heavy/specialised. Most "Glue vs EMR vs Databricks" questions reduce to *where on this spectrum does the workload sit, and why*.

3. **Storage + catalog are the gravity well; engines are interchangeable.** Pick table format and catalog first — that's sticky and governs everything. Engine choice stays reversible if data is open-format on S3 with a shared catalog. **The lakehouse thesis is the spine of every answer.**

---

# Section 1 — S3 as the data-lake foundation

S3 is the **durable, decoupled storage tier** for the whole stack (11 nines durability, region-scoped, effectively unlimited). Everything else queries *over* it.

## 1A. Storage classes (cost ↔ access trade-off)

| Class | Use for | Note |
|---|---|---|
| **S3 Standard** | Hot data, active partitions | Default; per-GB + request cost |
| **S3 Intelligent-Tiering** | Unknown / changing access patterns | Auto-moves objects between tiers; **the default for lakes** where you don't want to hand-tune lifecycle |
| **Standard-IA / One Zone-IA** | Warm, infrequently read | Lower storage, higher retrieval cost; min-duration billing |
| **Glacier Instant Retrieval** | Archive, occasional ms-latency reads | |
| **Glacier Flexible / Deep Archive** | Cold compliance archive | Retrieval is minutes-to-hours; cheapest |

**Architect line:** "For a lake I default to Intelligent-Tiering on raw/landing so I'm not managing lifecycle by hand, and reserve explicit Glacier lifecycle rules for compliance retention tiers."

## 1B. Partition layout (the single biggest perf/cost lever over S3)

- **Hive-style partitioning**: `s3://bucket/table/year=2026/month=05/day=25/` — lets Athena/Glue/Spectrum do **partition pruning** so a query scans only relevant prefixes. Engines bill by **bytes scanned** (Athena) or compute-time, so pruning is directly money.
- **Right-size files**: aim for ~**128 MB–1 GB** columnar files. Many tiny files = the *small-files problem*: metadata/listing overhead kills Spark and Athena. Compaction (Glue/EMR compaction jobs, or Iceberg/Delta `OPTIMIZE`) is a standing maintenance task.
- **Columnar formats**: **Parquet / ORC** for analytics (column pruning + predicate pushdown + compression). Avro for row-oriented streaming. Open table formats (**Iceberg, Delta, Hudi**) add ACID, time-travel, schema evolution, and hidden partitioning on top.
- **Avoid over-partitioning**: a partition per minute or per high-cardinality key creates millions of tiny prefixes. Partition on what queries filter on (date, region), not on everything.

## 1C. Lifecycle, encryption, security

- **Lifecycle policies**: transition Standard → IA → Glacier on age; expire temp/`_$folder$`/multipart cruft; expire old object versions.
- **Encryption at rest**: **SSE-S3** (S3-managed keys) baseline; **SSE-KMS** when you need key policies, rotation, CloudTrail audit of key use, and per-team key separation; **SSE-C** rare. Default-encryption on the bucket so nothing lands unencrypted. **In transit**: TLS, enforce with an `aws:SecureTransport` deny policy.
- **Access control layers**: IAM policies (identity-based), **bucket policies** (resource-based), **Block Public Access** (account + bucket level, on by default — keep it on), **VPC gateway endpoints** for S3 so traffic never leaves the AWS network, and **Lake Formation** for fine-grained (table/column/row) governance over the *catalog* surface (see §9).
- **S3 Access Logs / CloudTrail data events** for audit; **Object Lock** (WORM) for compliance immutability.

## 1D. S3 as the lakehouse storage tier

S3 holds the **bronze/silver/gold (medallion)** layers. Databricks **Delta Lake** tables, Iceberg tables, and Glue/Athena read/write the *same* S3 objects. **S3 Tables** (managed Iceberg buckets with auto-compaction) and the **SageMaker Lakehouse** are the 2024–25 managed-Iceberg path letting Redshift, Athena, EMR, Glue, and SageMaker query one set of tables. Takeaway: **keep gold data in an open table format on S3 so engine choice stays reversible** — Databricks today, Athena for ad-hoc, Redshift Spectrum for BI, one copy.

---

# Section 2 — AWS Glue

Glue is **serverless Spark + a managed Hive-compatible catalog + crawlers + a visual job builder**. It's the AWS-native ETL workhorse: Glue jobs, the Glue Data Catalog, and crawler-driven pipelines.

## 2A. Glue Spark jobs — DataFrame vs DynamicFrame

- **DataFrame** — standard Spark/PySpark DataFrame. Use when you control the schema and want full Spark API + Spark SQL. What you'd write in Databricks too.
- **DynamicFrame** — Glue's own abstraction. **Schema-flexible** (handles semi-structured / messy / evolving schemas without an upfront schema), supports **choice types** and **resolveChoice**, and integrates with Glue transforms (`ApplyMapping`, `Relationalize`, `DropNullFields`) and the catalog. You can `.toDF()` / `.fromDF()` to switch.
- **Architect call:** "DynamicFrame for ingestion of dirty/semi-structured sources where schema drifts; convert to DataFrame for the heavy transform logic where I want full Spark + predictable performance."

## 2B. Glue job types

- **Spark jobs** — distributed PySpark/Scala; the main ETL path. Billed per **DPU-hour** (Data Processing Unit). G.1X / G.2X / G.4X / G.8X worker types; **G.025X** Flex/streaming small worker.
- **Python-shell jobs** — single-node plain Python (no Spark). For lightweight tasks: small file moves, API calls, calling Redshift, orchestrating, light pandas. Billed at a fraction of a DPU. **Don't reach for Spark when a Python-shell job will do.**
- **Streaming jobs** — Spark Structured Streaming from Kafka/Kinesis.
- **Ray jobs** — for Python-native distributed (non-Spark) compute.

## 2C. Crawlers + Glue Data Catalog

- **Crawlers** scan S3 (and JDBC sources), **infer schema + partitions**, and populate the **Glue Data Catalog** as databases/tables. Schedule them or trigger on arrival.
- **Glue Data Catalog** = a **Hive-Metastore-compatible** metadata store, **shared across Athena, EMR (Hive/Spark), Redshift Spectrum, and Glue itself** — and readable by Databricks. This shared-catalog property is the lakehouse glue (pun intended): one table definition, many engines. It's the **`hive_metastore` replacement** in serverless AWS.
- **Partition management**: crawlers add partitions; or use **partition projection** (Athena computes partitions from a pattern, no catalog round-trip) for high-partition tables.

## 2D. Job bookmarks, Glue Studio, versions

- **Job bookmarks** — Glue persists state of *what's already been processed* (by file/timestamp/primary key) so reruns process only **new data** — incremental ETL without you tracking watermarks. Toggle: enable / pause / disable.
- **Glue Studio** — visual drag-drop job authoring (and the notebook/script editor); generates the PySpark. **Glue DataBrew** = no-code visual data prep/profiling for analysts.
- **Glue versions** — track the Spark/Python runtime. Glue 3.0 = Spark 3.1, **Glue 4.0 = Spark 3.3**, **Glue 5.0 = Spark 3.5 (Java 17, current)**. Newer = faster, Iceberg/Delta/Hudi support, better perf. Know that **version ≈ Spark version** and pick the latest your code supports.

## 2E. When Glue (the headline trade-off)

Glue's sweet spot: **serverless, event-driven, intermittent or moderate Spark ETL** where you don't want to manage clusters, and you want native catalog + crawler + bookmark integration. It's *more expensive per compute-unit* than tuned EMR for sustained heavy jobs, and gives less control over Spark internals than EMR or Databricks. See §10 matrix.

---

# Section 3 — Amazon EMR

EMR = **managed Hadoop/Spark** (Spark, Hive, Presto/Trino, HBase, Flink, Hudi/Iceberg). Use it when you need **full control over a Spark/Hadoop cluster** and sustained heavy compute. Three deployment models:

| Model | What it is | Use when | Cost lever |
|---|---|---|---|
| **EMR on EC2** | Classic cluster on EC2 you size/tune | Long-running clusters, full control of instance types, bootstrap actions, custom AMIs, broad Hadoop ecosystem | **Spot instances for task nodes** (60–90% off); instance fleets; reserved/savings plans for core nodes |
| **EMR on EKS** | Spark jobs as pods on a shared **EKS** cluster | You already run Kubernetes; want to co-locate Spark with other containerised workloads; fine-grained resource sharing | Bin-pack on existing EKS capacity; spot node groups |
| **EMR Serverless** | No cluster to manage; submit a Spark/Hive app, it auto-provisions/scales | Bursty or unpredictable workloads; teams that want EMR's engine without ops | Pay only for vCPU/mem **while running**; pre-initialized capacity for low-latency starts |

**Spot strategy:** keep **core nodes** (HDFS/shuffle) on-demand for stability, run **task nodes** on spot for the cheap horsepower; checkpoint and design for interruption. This is the classic cost-architecture trade-off.

**EMR vs Glue:** EMR when you need cluster control, a non-Spark Hadoop tool, sustained heavy throughput, or per-unit cost optimisation at scale. Glue when serverless/intermittent and catalog-native. **EMR vs Databricks:** Databricks for the developer experience, Photon engine, Unity Catalog governance, collaborative notebooks, MLflow, and a managed lakehouse; EMR when you want raw OSS Spark/Hadoop control inside the AWS account boundary at lower platform cost.

---

# Section 4 — Amazon Redshift

Redshift = AWS's **columnar, MPP (massively parallel processing) cloud data warehouse**. Redshift tuning is where most AWS warehouse depth is actually tested.

## 4A. Architecture

- **Leader node** — parses SQL, builds the query plan, coordinates; aggregates results. No customer data.
- **Compute nodes** — store data and run query steps in parallel, divided into **slices** (one per CPU core). Data is distributed across slices; parallelism = number of slices.
- **RA3 nodes + Redshift Managed Storage (RMS)** — **decouples compute from storage**: hot data cached on local NVMe SSD, the rest in S3-backed managed storage, billed separately. Scale compute and storage independently. (Older DC2 = local storage only; DS2 legacy.)
- **Redshift Serverless** — no clusters/nodes to manage; capacity in **RPUs** (Redshift Processing Units), auto-scales, pay-per-use. For variable/spiky or dev workloads. Provisioned RA3 for predictable, sustained, cost-optimised production.
- **Concurrency Scaling** — adds transient clusters during query spikes to keep concurrency high; **Data Sharing** shares live data across clusters/accounts without copies.

## 4B. Distribution styles & sort keys (the core tuning knobs)

**Distribution style** — how rows spread across slices (governs data movement in joins):

| Style | Behaviour | Use when |
|---|---|---|
| **KEY** | Rows with same dist-key value land on same slice | Large fact ⇄ dimension joined on that key — **co-located join, no redistribution** |
| **ALL** | Full copy of table on every node | Small dimension tables joined often — eliminates redistribution at storage cost |
| **EVEN** | Round-robin | No clear join key; staging tables |
| **AUTO** | Redshift picks (default; can start ALL→EVEN/KEY as it grows) | Default; let it manage unless you have a known hot join |

**Sort keys** — physical ordering on disk; lets Redshift skip blocks via **zone maps** (min/max per block):
- **Compound** (default) — leftmost-prefix; great when queries filter in that column order.
- **Interleaved** — equal weight to multiple columns; helps varied filter patterns but costlier to maintain. Less used now.
- **Pick sort key on the column you filter/range-scan on** (usually a date). The fact-table design target: **dist on join key, sort on filter date**.

## 4C. Query optimization

- **VACUUM** — reclaims space from deleted rows and re-sorts; **ANALYZE** — refreshes table stats the planner uses. Modern Redshift does **auto-vacuum / auto-analyze**, but know what they do and when to run manually after big loads.
- **WLM (Workload Management)** — query queues with memory/concurrency allocation. **Auto-WLM** (default) lets Redshift manage memory/concurrency dynamically; **manual WLM** for hard isolation of workloads. **Short Query Acceleration (SQA)** fast-lanes small queries. **Query Monitoring Rules (QMR)** kill/log runaway queries.
- **Result cache** — identical query returns cached result instantly (when underlying data unchanged).
- **Materialized views** — precompute expensive joins/aggregations; support **incremental / auto-refresh**. Big win for repeated BI aggregations.
- **Late-binding views** — `WITH NO SCHEMA BINDING`; the view doesn't bind to base tables until query time, so you can drop/recreate base tables (and reference **external Spectrum tables**) without breaking the view. The standard pattern for views over S3.
- **COPY** for bulk load (parallel, from S3, splits across slices); **never** row-by-row inserts. **Compression/encoding** is chosen automatically by COPY (`COMPUPDATE`).
- **Tuning workflow for "this query is slow":** check `EXPLAIN` / `SVL_QUERY_REPORT` → look for **DS_DIST_BOTH / DS_BCAST_INNER** (data redistribution = wrong dist key), large **scan rows** (missing sort-key pruning / stale stats), spilled-to-disk (memory/WLM), and missing compression. Fix dist/sort keys, ANALYZE, consider an MV.

## 4D. Redshift Spectrum

- **Query S3 directly from Redshift** using **external tables** defined in the **Glue Data Catalog** (or external schema). Spectrum compute is a separate serverless fleet billed by **bytes scanned** (like Athena).
- Pattern: keep **hot/recent** data in Redshift managed storage, **cold/historical** in S3, **UNION** them via a view — warehouse speed on hot, cheap lake storage on cold. This is the canonical "warehouse + lake" answer.

## 4E. Redshift vs Athena vs Databricks SQL

Redshift = best for **sustained, low-latency, high-concurrency BI** with a curated dimensional model and heavy joins; Athena = serverless ad-hoc over S3, pay-per-query, no infra; Databricks SQL = lakehouse BI over Delta/Unity Catalog with Photon, best when the org's gravity is already Databricks. See §10.

---

# Section 5 — Amazon Athena

- **Serverless query engine** — managed **Trino/Presto** (Athena engine v3) over data in S3. No infrastructure; **pay per TB scanned** (or provisioned capacity for predictable spend). SQL over the Glue Data Catalog.
- **Cost = bytes scanned**, so the levers are: **partitioning + partition projection**, **columnar formats (Parquet/ORC)**, compression, and `SELECT` only needed columns. Convert raw JSON/CSV to Parquet before querying at scale.
- **CTAS** (`CREATE TABLE AS SELECT`) and **`INSERT INTO`** — transform and write results back to S3 as partitioned Parquet; the serverless ELT pattern. **`UNLOAD`** exports query results.
- **Federated queries** — Athena **data source connectors** (Lambda-based) query *outside* S3: JDBC sources (MySQL, Postgres, SQL Server, Oracle), DynamoDB, Redshift, CloudWatch, etc., and join across them. Useful for one-off cross-source analytics without building a pipeline.
- **Iceberg support** — Athena reads/writes Iceberg tables (ACID, row-level updates, time-travel) — increasingly how teams do serverless lakehouse SQL on AWS.
- **When Athena:** ad-hoc exploration, infrequent queries, log analytics, BI over a lake where you don't want a always-on warehouse. **Not** for high-concurrency low-latency dashboards (use Redshift) or heavy iterative transforms (use Glue/EMR/Databricks).

---

# Section 6 — Lambda for data

- **Event-driven glue, not an ETL engine.** Lambda's data role: **trigger and orchestrate**, light transforms, fan-out.
- **Patterns:** S3 `ObjectCreated` event → Lambda → start a Glue job / Step Functions / EMR step; Kinesis/DynamoDB Streams → Lambda for stream processing; EventBridge schedule → Lambda kicks a pipeline; small record-level transforms / format conversion / API enrichment.
- **Hard limits to respect:** **15-minute max execution**, **10 GB memory** ceiling, **10 GB ephemeral `/tmp`**, **6 MB synchronous payload**, **250 MB unzipped package** (use container images up to 10 GB for big deps). Concurrency limits / throttling under burst.
- **When NOT to use Lambda:** large-dataset transforms, anything over ~15 min, big shuffles/joins, sustained throughput, stateful Spark work. **Lambda triggers the heavy lifting; Glue/EMR/Databricks does it.** Stating this boundary unprompted is a maturity signal.

---

# Section 7 — Step Functions

AWS-native **serverless workflow orchestration** — state machines (Amazon States Language) coordinating AWS services with built-in error handling. Usually considered as an either/or against Airflow for orchestration.

## 7A. Standard vs Express

| | **Standard** | **Express** |
|---|---|---|
| Duration | up to **1 year** | up to **5 minutes** |
| Pricing | per **state transition** | per execution + duration (cheaper at high volume) |
| Execution model | exactly-once, fully durable, visual history | high-volume, at-least-once (sync) / at-most-once (async) |
| Use | long-running ETL/ML orchestration, human/approval waits | high-frequency event processing, streaming ingest fan-out |

## 7B. Patterns & resilience

- **Map state** — iterate over an array (incl. **Distributed Map** for massive S3-object fan-out, thousands of parallel children). **Parallel state** — concurrent branches.
- **Retry / Catch** — per-state retry with backoff (`IntervalSeconds`, `BackoffRate`, `MaxAttempts`) and `Catch` to route errors to a handler/fallback state. Declarative resilience — no boilerplate.
- **Service integrations** — direct **SDK integrations** (call ~200 AWS services), `.sync` (**run-a-job and wait**, e.g. Glue/EMR/SageMaker job to completion), and `.waitForTaskToken` (pause until an external callback — human approval, external system).
- Typical data pipeline: `Lambda (validate) → Glue crawler → Glue job (.sync) → Redshift COPY → SNS notify`, with Catch routing failures to alerting.

## 7C. Step Functions vs Airflow / MWAA

- **Step Functions** — serverless, no infra, pay-per-use, deep AWS-service integration, best for **AWS-centric, event-driven** flows. Weaker at complex DAG authoring, backfills, and a rich scheduler/UI; logic lives in JSON (ASL).
- **Airflow / MWAA (Managed Workflows for Apache Airflow)** — Python-defined DAGs, rich scheduling/backfill/dependency semantics, huge provider ecosystem, strong for **complex multi-step data pipelines and cross-system orchestration**; you pay for the (managed) environment even when idle and carry more ops/version surface.
- **Architect call:** Step Functions for AWS-native, spiky, event-triggered orchestration with low ops; Airflow/MWAA when you need data-engineering-grade DAGs, backfills, dynamic task generation, and portability. They coexist — Airflow as the macro scheduler invoking Step Functions / Glue / EMR as tasks. **(Full treatment in `airflow-mwaa-orchestration-refresher.md`.)**

---

# Section 8 — SageMaker & SageMaker Unified Studio (SMUS)

## 8A. SageMaker (classic)

The ML platform: **SageMaker Studio** (IDE), training jobs, hosted endpoints (real-time / batch / serverless inference), **Feature Store**, **Pipelines** (ML CI/CD DAGs), **Model Registry**, Processing jobs (Spark/sklearn). In a data-engineering context it's the **consumer** of the curated lake/warehouse — features and training data come from S3/Glue/Redshift.

## 8B. SageMaker Unified Studio (SMUS) — what it actually is

SMUS is the **unified studio (GA March 2025)** that consolidates AWS's previously-separate analytics and ML tools into **one governed environment over a lakehouse**. Position it (don't invent UI specifics):

- **The "single pane" thesis:** brings **data engineering, SQL analytics, big-data processing, and ML/GenAI** together in one workspace, so a user doesn't bounce between the Glue console, Athena, EMR Studio, Redshift Query Editor, and SageMaker Studio. It's the evolution/rebrand-and-merge of the old SageMaker Studio + Amazon DataZone lineage.
- **It orchestrates the engines you already know** — **Glue, EMR, Redshift, Athena** — over a shared **SageMaker Lakehouse** (managed Apache Iceberg, unifying S3 data and Redshift data under one catalog).
- **Governance is built in via Amazon DataZone** — a **business catalog** with **business metadata (glossaries), data discovery/subscription, lineage, and governed access**. Projects, domains, and publish/subscribe workflows control who gets what.
- **Bedrock / GenAI** development is included in the unified surface.

## 8C. Why SMUS shows up under governance and metadata

SMUS is usually listed alongside "business catalog / governance implementations for metadata management, data discovery, and governed analytics access" — and that maps directly to the **DataZone-powered business catalog inside SMUS**: glossaries, lineage, discovery, governed subscription-based access. It's the AWS-native answer to the same "business catalog / metadata / lineage / data dictionary" need that Atlan/Collibra solve elsewhere (cross-reference the governance/catalog guide). **Architect framing:** "SMUS is AWS's unified studio + governed catalog story — its DataZone-based business catalog is where I'd anchor metadata, lineage, and governed analytics access on an all-AWS estate; on a Databricks-centric estate that role is Unity Catalog."

---

# Section 9 — Governance & security

The governance surface — data dictionaries, metadata repositories, data lineage — plus Secrets Manager and the AWS security model underneath. (Deeper governance methodology lives in the governance/catalog and DAMA-DMBOK guides.)

## 9A. Lake Formation — fine-grained governance over the lake

- Sits **on top of the Glue Data Catalog** and centralises permissions so you grant access in **database/table/column/row** terms instead of raw S3 IAM paths.
- **Column-level** security (hide/expose columns per principal), **row-level** filters, and **cell-level**.
- **LF-Tags (tag-based access control / TBAC)** — attach tags (e.g. `classification=PII`, `domain=finance`) to catalog resources and grant on the tag, not the object. **Scales governance** the way Immuta's ABAC does on Snowflake — grant once on a tag, applies to everything tagged. This is the AWS analogue of "tag-based access policies."
- Enforced consistently across **Athena, Redshift Spectrum, EMR, Glue, and SMUS**, because they all read the same catalog.

## 9B. IAM least-privilege

- **Roles over long-lived keys**; scope policies to specific resources/actions/conditions; **IAM roles for service-to-service** (Glue/EMR/Lambda assume execution roles). **Permission boundaries** and **SCPs** (org-level guardrails). Tag-based and condition-key scoping. **Never** embed credentials in jobs.

## 9C. Secrets Manager & KMS

- **Secrets Manager** — store DB credentials, API keys, JDBC connection secrets; **automatic rotation** (esp. RDS); fetched at runtime by Glue/Lambda/EMR via IAM. Prefer over hard-coded creds or plaintext SSM. (SSM **Parameter Store** is the cheaper option for non-secret config / simple secrets.)
- **KMS** — central key management for S3 (SSE-KMS), Redshift, EBS, Secrets Manager; key policies + grants; **CloudTrail** logs every key use for audit; automatic key rotation. Customer-managed keys (CMK) when you need control/separation; AWS-managed keys for simplicity.

---

# Section 10 — Decision matrices

## 10A. Glue vs EMR vs Databricks

| Dimension | **Glue** | **EMR** | **Databricks** |
|---|---|---|---|
| Model | Serverless Spark | Managed Hadoop/Spark cluster | Managed lakehouse platform |
| Ops burden | Lowest | Highest (EC2) → low (Serverless) | Low (managed) |
| Control over Spark | Limited | Full | High (+ Photon, tuned runtime) |
| Best for | Event-driven / intermittent ETL, catalog-native | Sustained heavy compute, OSS Hadoop tools, cost-optimised at scale | DevX, collaboration, ML/MLflow, Unity Catalog governance, lakehouse |
| Catalog | Glue Data Catalog native | Glue/Hive metastore | Unity Catalog (+ can read Glue) |
| Cost shape | Per-DPU-hour, no idle | Cheapest per-unit when tuned (spot) | Platform premium for DBX value |
| Pick when | "Just run my Spark ETL, no cluster" | "I need cluster control / spot economics / Hive ecosystem" | "Lakehouse + notebooks + ML + governance as a product" |

## 10B. Redshift vs Athena vs Databricks SQL

| Dimension | **Redshift** | **Athena** | **Databricks SQL** |
|---|---|---|---|
| Engine | MPP columnar warehouse | Serverless Trino over S3 | Photon over Delta/Unity |
| Latency / concurrency | Low latency, high concurrency | Variable, ad-hoc | Low latency (Photon) |
| Cost shape | Provisioned RA3 or Serverless RPU | Pay per TB scanned | DBU + SQL warehouse |
| Data location | Managed storage (+ Spectrum to S3) | S3 (+ federated) | Delta on S3 |
| Best for | Curated BI, dimensional model, dashboards | Ad-hoc, infrequent, log/lake exploration | BI when org gravity is Databricks |
| Pick when | "Always-on enterprise BI warehouse" | "Occasional SQL over the lake, no infra" | "Already all-in on the lakehouse" |

## 10C. Step Functions vs Airflow / MWAA

| Dimension | **Step Functions** | **Airflow / MWAA** |
|---|---|---|
| Definition | ASL (JSON) state machine | Python DAGs |
| Infra | Serverless, pay-per-use | Managed env, pays when idle |
| Strength | Deep AWS-service integration, event-driven, resilient by config | Rich scheduling, backfills, dynamic DAGs, provider ecosystem |
| Weakness | Complex DAG authoring, no backfill semantics | Ops/version surface, idle cost |
| Pick when | AWS-native, spiky, low-ops orchestration | Data-engineering DAGs, backfills, portability |

## 10D. Lake vs Warehouse vs Lakehouse on AWS

| | **Data Lake** | **Data Warehouse** | **Lakehouse** |
|---|---|---|---|
| Storage | S3, open formats | Redshift managed storage | S3 + open table format (Iceberg/Delta) |
| Schema | Schema-on-read | Schema-on-write | Both; ACID tables on the lake |
| Engines | Athena, EMR, Glue, Spectrum | Redshift SQL | Databricks, Athena/Iceberg, Spectrum, SMUS lakehouse |
| Strength | Cheap, flexible, any data | Fast curated BI, governance | One copy, many engines, ACID + BI + ML |
| Weakness | No ACID/quality by default | Cost, less flexible for raw/ML | Operational maturity required |
| AWS shape | S3 + Glue Catalog + Lake Formation | Redshift | S3 Tables / SageMaker Lakehouse + Glue + LF + Databricks |

---

# Check yourself

1. **"Glue or EMR for this workload?"** → Where on the compute spectrum: intermittent/event-driven + catalog-native + low-ops → **Glue**; sustained heavy throughput, spot economics, or non-Spark Hadoop tooling → **EMR** (Serverless if you want EMR's engine without cluster ops).
2. **"How do you optimize a slow Redshift query?"** → `EXPLAIN`/system views → diagnose **redistribution (DS_DIST_BOTH/DS_BCAST)** = wrong **dist key**; **stale stats** → ANALYZE; **no block-skipping** = wrong **sort key**; spill = WLM/memory; consider a **materialized view** and proper **COPY** loading. Lead with dist/sort keys.
3. **"Where does SMUS fit vs Databricks?"** → SMUS is AWS's **unified studio + DataZone business catalog** over a SageMaker (Iceberg) lakehouse, orchestrating Glue/EMR/Redshift/Athena; Databricks is the cross-cloud lakehouse platform with Unity Catalog/Photon/MLflow. All-AWS estate → SMUS for governed unified analytics; Databricks-centric estate → Unity Catalog plays that governance role.
4. **"Why is the Glue Data Catalog important architecturally?"** → It's a **Hive-compatible metastore shared across Athena/EMR/Spectrum/Glue (and readable by Databricks)** — one table definition, many engines — which is what makes engine choice reversible. The lakehouse hinge.
5. **"When would you NOT use Lambda for data processing?"** → 15-min / 10 GB ceilings, heavy shuffles, sustained throughput, stateful Spark. Lambda **triggers**; Glue/EMR/Databricks **processes**.
6. **"Lambda or Step Functions or Airflow to orchestrate this pipeline?"** → Lambda = single event reaction; Step Functions = AWS-native, resilient, event-driven flow with retries/catch; Airflow/MWAA = complex DAGs, backfills, scheduling, cross-system. They nest.
7. **"How do you keep S3 query costs down?"** → Partition + partition projection, columnar Parquet/ORC, compaction of small files, Intelligent-Tiering + lifecycle, scan only needed columns; for Athena/Spectrum it's literally **bytes scanned**.
8. **"How do you do fine-grained access control on the lake?"** → **Lake Formation** column/row/cell + **LF-Tags (TBAC)** enforced across all catalog-reading engines; IAM least-privilege roles; KMS-encrypted S3; Secrets Manager for credentials. (Same shape as Immuta ABAC on Snowflake.)
9. **"RA3 vs Redshift Serverless?"** → RA3 = compute/storage decoupled, predictable sustained production, cost-optimised; Serverless = auto-scaling pay-per-use for variable/spiky/dev.
10. **"Redshift Spectrum vs Athena — same engine?"** → Both serverless-scan over S3 billed by bytes; Spectrum is invoked **from within Redshift** to join S3 external tables to managed tables (hot+cold union pattern); Athena is standalone Trino.
11. **"How do you migrate an on-prem warehouse to AWS?"** → Assess → land raw to S3 (DMS/Glue) → catalog via crawlers → transform with Glue/EMR/Databricks into open-format gold → serve via Redshift/Athena/Databricks SQL → governance via Lake Formation; orchestrate with Airflow/Step Functions; secrets in Secrets Manager; IaC in Terraform.
12. **"DataFrame vs DynamicFrame in Glue?"** → DynamicFrame for messy/evolving schemas + Glue transforms/choice-types; convert to DataFrame for heavy, schema-stable transform logic with full Spark.

---

# Vocabulary

- *"MPP columnar"* / *"slices"* — Redshift architecture register.
- *"Distribution key"* / *"sort key"* / *"zone maps"* — Redshift tuning register.
- *"DS_DIST_BOTH / DS_BCAST_INNER"* — name-drop when discussing redistribution.
- *"RA3 + managed storage / decoupled compute-storage"* — modern Redshift.
- *"DPU-hour"* (Glue) / *"RPU"* (Redshift Serverless) / *"DBU"* (Databricks) — the billing units.
- *"DynamicFrame vs DataFrame"*, *"job bookmarks"* — Glue fluency.
- *"Hive-compatible shared metastore"* — the Glue Data Catalog's role.
- *"Partition pruning / partition projection / predicate pushdown"* — S3/Athena perf.
- *"Small-files problem"* / *"compaction"* / *"OPTIMIZE"* — lake hygiene.
- *"Bytes scanned"* — Athena/Spectrum cost.
- *"Open table format"* (Iceberg/Delta/Hudi), *"medallion / bronze-silver-gold"*, *"schema-on-read vs schema-on-write"*.
- *"LF-Tags / TBAC"*, *"ABAC"*, *"least-privilege execution role"* — governance/security.
- *"Run-a-job-and-wait (.sync)"*, *"Distributed Map"*, *"Catch/Retry with backoff"* — Step Functions.
- *"SageMaker Lakehouse"*, *"DataZone business catalog"*, *"governed subscription access"* — SMUS register.
- *"Spot task nodes, on-demand core nodes"* — EMR cost.

---

# Things to skip

- Memorising exact AWS quotas/pricing numbers — know the *shapes* (15-min Lambda, RA3 decouples storage), not the cents. Don't fabricate quotas.
- Deep Hadoop ecosystem internals (HBase, Oozie, YARN tuning) — name them; don't go deep.
- SMUS UI click-paths and exact 2025 GA feature lists — describe **purpose and positioning** (unified studio + DataZone catalog + lakehouse), not screens.
- Redshift interleaved-sort-key edge cases — mention it exists; compound + AUTO is the live answer.
- DMS replication-instance sizing minutiae — know it's the on-prem→S3/RDS migration tool; defer detail.
- Glue Scala vs Python religious debate — PySpark is the working default; that's the answer.
- Reciting all ~200 Step Functions SDK integrations — the three integration *types* (SDK / `.sync` / `.waitForTaskToken`) is the architect-level point.

---

