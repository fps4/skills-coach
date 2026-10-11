---
title: Snowflake Platform — Architect's Refresher
summary: Snowflake's three-layer architecture, warehouse sizing and caching, loading and open formats, in-engine transformation, RBAC and governance, and how SAP data reaches it.
---

## Frame

A refresher for someone who has built on Snowflake before — staging, `COPY INTO`, layered schemas,
roles and warehouses. What changed since is mostly *above* that layer: declarative transformation
(Dynamic Tables), open table formats (Iceberg), Python in-engine (Snowpark), governance under one name
(Horizon), and the SAP partnership.

Three mental models:

1. **Storage, compute and cloud services are separate and billed separately.** Almost every cost or
   performance question resolves to "which of the three is doing the work, and for how long".
2. **A warehouse is not a database.** It is a rented compute cluster with a T-shirt size. Sizing,
   suspend behaviour and concurrency are the levers.
3. **Micro-partitions are automatic; pruning is not free.** Query performance is mostly "how much did
   we manage to skip", decided by data layout and predicates, not by indexes.

---

## 1. Architecture in one page

| Layer | What it does | You pay for |
|---|---|---|
| **Storage** | Columnar, compressed, immutable **micro-partitions** in cloud object storage | Per TB per month, compressed |
| **Compute (virtual warehouses)** | Query execution, loading, DML | Per second, per credit, only while running |
| **Cloud services** | Metadata, optimizer, security, result cache, transactions | Free up to ~10% of daily compute, then billed |

- Storage is cheap; compute is the bill. Optimise compute time first.
- Compute is isolated per warehouse — the ETL warehouse cannot slow the BI warehouse. The standard
  answer to "noisy neighbour".
- Metadata operations (`COUNT(*)`, `SHOW`, many `INFORMATION_SCHEMA` lookups) are answered by cloud
  services without a running warehouse.

### Micro-partitions and clustering

- Data is stored automatically in micro-partitions of about 16 MB compressed (50–500 MB uncompressed),
  columnar within the partition.
- Min/max and distinct-count metadata per partition per column drive **pruning**; this replaces indexes.
- Natural clustering comes from load order. For very large tables whose filters do not match load
  order, define a **clustering key** and let automatic clustering reorganise in the background (it
  costs credits — justify it).

```sql
ALTER TABLE sales CLUSTER BY (sale_date, store_id);
```

- For point lookups on large tables: **Search Optimization Service** — a maintained, billed access path.

### Caching (three of them)

1. **Result cache** — identical query, unchanged data, ~24 hours, no warehouse needed.
2. **Warehouse (local disk) cache** — data read by a running warehouse; lost on suspend.
3. **Metadata cache** — min/max statistics used for pruning.

Aggressive suspend saves credits but discards cache 2. Auto-suspend at 60 s suits bursty BI and is
wrong for a job that runs every two minutes.

---

## 2. Warehouses: sizing, concurrency, cost

- Sizes XS, S, M, L, XL … Each step **doubles compute and credit burn per hour**. For a query that
  scales linearly, twice the size at half the time costs the same. **Go bigger for speed only when the
  query actually parallelises.**
- **Spilling** to local or remote storage (visible in the Query Profile) means the query lacks memory;
  a bigger warehouse genuinely helps.
- A bad join or missing pruning just burns more credits at a bigger size. Fix the query.
- **Concurrency** is a different problem from size: a **multi-cluster warehouse** (min/max clusters,
  auto-scale) handles many small concurrent queries.
- **Auto-suspend / auto-resume** — tune per workload, not globally.
- **Resource monitors** — credit quotas per warehouse or account with notify/suspend actions; the
  first governance object to put in place.

```sql
CREATE RESOURCE MONITOR bi_monthly WITH CREDIT_QUOTA = 500
  TRIGGERS ON 80 PERCENT DO NOTIFY
           ON 100 PERCENT DO SUSPEND;
ALTER WAREHOUSE bi_wh SET RESOURCE_MONITOR = bi_monthly;
```

The **Query Profile** shows partitions scanned versus total, spilling, exploding joins and the most
expensive node.

---

## 3. Loading and open formats

| Pattern | Use when |
|---|---|
| `COPY INTO` from an **external stage** | Bulk batch loads, backfills |
| **Snowpipe** | Continuous file-arrival ingestion, serverless, near real time |
| **Snowpipe Streaming** | Row-level streaming (e.g. from Kafka) without staging files |
| **Kafka connector** | Kafka topics into tables, on Snowpipe / Snowpipe Streaming |
| **External tables** | Query files in place; no copy, slower |
| **Iceberg tables** | Open table format managed or read by Snowflake — no lock-in to one engine |
| **Secure Data Sharing** | No copy, no pipeline: another account reads live data |

Iceberg and Sharing changed the architecture conversation most: "do we ingest or do we share?" is now
a real design decision.

Loading practicalities: files around 100–250 MB compressed for parallel `COPY`, one warehouse per
load lane, `VALIDATION_MODE` for dry runs, a deliberate `ON_ERROR` policy, and a landing schema whose
grain matches the file.

```sql
COPY INTO landing.gl_lines
  FROM @s3_finance/gl/2026/
  FILE_FORMAT = (TYPE = PARQUET)
  MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE
  ON_ERROR = ABORT_STATEMENT;
```

---

## 4. Transformation inside Snowflake

- **Streams** — change tracking on a table (a CDC offset, not a copy); standard, append-only and
  insert-only. Reading a stream in a DML transaction advances the offset.
- **Tasks** — scheduled or triggered SQL, chained into DAGs; serverless tasks size themselves.
- **Dynamic Tables** — the declarative replacement for Streams + Tasks: a target query plus a
  `TARGET_LAG`, and Snowflake decides how to refresh incrementally. The default for new incremental
  pipelines; keep Streams + Tasks for logic that does not fit one query.

```sql
CREATE DYNAMIC TABLE daily_sales
  TARGET_LAG = '15 minutes'
  WAREHOUSE = transform_wh
AS SELECT store_id, sale_date, SUM(amount) AS revenue
   FROM raw.sales GROUP BY 1, 2;
```

- **Snowpark** — DataFrame API in Python/Java/Scala executing inside Snowflake, plus UDFs, UDTFs and
  stored procedures. **Snowpark Container Services** runs containers next to the data.
- **dbt** remains the common modelling layer on top.

---

## 5. Security and governance (Horizon)

System roles: `ORGADMIN` · `ACCOUNTADMIN` · `SECURITYADMIN` · `USERADMIN` · `SYSADMIN` · `PUBLIC`.

- Nobody works as `ACCOUNTADMIN`; grant it to two people for billing and account-level settings.
- **Functional roles** (analyst, engineer, loader) are granted **access roles** (read/write per
  schema), which hold the object grants — a two-layer model.
- Objects are owned by a role, not a person.
- **Managed access schemas** centralise who may grant, where grant sprawl is a risk.

Governance features:

- **Object tagging** and tag-based policies — classify once, protect everywhere.
- **Dynamic Data Masking** (column-level, role-aware) and **Row Access Policies** (row filtering) — the
  standard PII answer.

```sql
CREATE MASKING POLICY email_mask AS (v STRING) RETURNS STRING ->
  CASE WHEN CURRENT_ROLE() IN ('PII_READER') THEN v
       ELSE '***MASKED***' END;
ALTER TABLE customers MODIFY COLUMN email SET MASKING POLICY email_mask;
```

- **Data classification** — automatic PII detection.
- **Access History** and **Object Dependencies** — lineage and audit.
- **Data Metric Functions** — scheduled data-quality checks.
- Network policies, PrivateLink, SSO/SCIM, key-pair auth for service accounts.

**Time Travel** is configurable retention (1 day on Standard, up to 90 on Enterprise) for
`AT`/`BEFORE` queries, `UNDROP` and cloning; **Fail-safe** is a fixed 7-day Snowflake-side recovery
window — not a backup strategy you can operate.

**Zero-copy cloning** creates dev and test environments from production in seconds, paying only for
changed data:

```sql
CREATE DATABASE analytics_dev CLONE analytics_prod;
```

---

## 6. SAP and Snowflake

Routes for SAP data into Snowflake, from most SAP-native to most generic:

1. **SAP Business Data Cloud ↔ Snowflake** — semantically rich SAP data shared into Snowflake with
   zero-copy sharing. Newest, strongest on semantics, dependent on SAP licensing and roadmap.
2. **SAP Datasphere** as the modelling and federation layer, exporting or sharing outward.
3. **Extractor-based ETL** — ODP / CDS view extraction (or SLT for real-time table replication) into a
   landing zone, then `COPY INTO`. Where most existing estates are.
4. **Third-party connectors** — fast to stand up; licence cost and SAP-side load are the trade-offs.
5. **Database-level CDC** — cheapest, worst on semantics, and a licensing question with SAP.

Whatever the route: extraction must not hurt the source system, the semantics must survive the trip
(company codes, ledgers, currencies, fiscal periods), and finance data needs **reconciliation** back
to the source ledger. See [SAP Datasphere, BDC and BTP](./sap-datasphere-bdc-btp.md).

---

## 7. Snowflake versus Databricks

- Both have converged: Snowflake added Python, containers and Iceberg; Databricks added SQL warehouses
  and governance.
- Snowflake still wins on SQL-first workloads, near-zero platform operations, concurrency, sharing and
  predictable governance.
- Databricks still wins on ML and data science, heavy custom Spark, streaming-first architectures and
  lakehouse-native open storage.
- The real selection driver is usually the team: who maintains it, what the analysts write, and where
  the existing estate already is. See [Databricks](./databricks-platform.md).

---

## 8. Self-check

- Explain the three-layer architecture and where the money goes.
- Size a warehouse and defend it (spilling versus pruning).
- Describe an incremental pipeline two ways: Streams + Tasks, and Dynamic Tables.
- Draw the two-layer RBAC model.
- Name the PII controls: masking policy, row access policy, tags, classification.
- Say what Time Travel, Fail-safe and cloning each are, and are not.
- Give the routes for SAP data into Snowflake and pick one with reasons.
- Explain cost control: resource monitors, auto-suspend, right-sizing.
