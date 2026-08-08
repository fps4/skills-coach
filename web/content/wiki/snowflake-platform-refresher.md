---
title: Snowflake Platform — Architect Refresher
summary: What changed above the basics — Dynamic Tables, Iceberg, Snowpark, Horizon governance — for someone whose hands-on work is a few years old.
topic: data-engineering
format: refresher
tags: [snowflake, warehouse, dynamic-tables, iceberg, snowpark, rbac, cost]
updated: 2026-08-07
---

## Frame

This is a refresh, not an introduction. It assumes you have built a production
pipeline landing data into Snowflake — object storage → `COPY INTO` → layered
schemas → roles and warehouses — and want to know what has moved since. Most of
what changed sits *above* that layer: declarative transformation (Dynamic
Tables), open table formats (Iceberg), Python in-engine (Snowpark), governance
consolidated under one name (Horizon), and the SAP partnership.

Three mental models to hold:

1. **Storage, compute and cloud services are separate and billed separately.**
   Almost every Snowflake cost or performance question resolves to "which of the
   three is doing the work, and for how long".
2. **A warehouse is not a database.** It is a rented compute cluster with a
   T-shirt size. Sizing, suspend behaviour and concurrency are the levers.
3. **Micro-partitions are automatic; pruning is not free.** Query performance is
   mostly "how much did we manage to skip", and that is decided by data layout
   and predicates, not by indexes.

---

## 1. Architecture in one page

| Layer | What it does | You pay for |
|---|---|---|
| **Storage** | Columnar, compressed, immutable **micro-partitions** in cloud object storage | Per TB per month, compressed |
| **Compute (virtual warehouses)** | Query execution, loading, DML | Per second, per credit, only while running |
| **Cloud services** | Metadata, optimizer, security, result cache, transactions | Free up to ~10% of daily compute, then billed |

Consequences an architect states out loud:

- Storage is cheap; compute is the bill. Optimize compute time first.
- Compute is fully isolated per warehouse — the finance ETL warehouse cannot
  slow down the BI warehouse. This is the standard answer to "noisy neighbour".
- Metadata operations (e.g. `COUNT(*)` on a table, `SHOW`, many `INFORMATION_SCHEMA`
  lookups) can be answered by cloud services without a running warehouse.

### Micro-partitions and clustering

- Data is stored automatically in micro-partitions of roughly 16 MB compressed
  (about 50–500 MB uncompressed), columnar within the partition.
- Snowflake keeps min/max and distinct-count metadata per partition per column.
  Query pruning uses that metadata; this replaces indexes.
- Natural clustering comes from load order. For very large tables where the
  query filter does not match the load order, define a **clustering key** and let
  automatic clustering re-organize in the background (it costs credits — justify it).
- Alternative for point-lookup patterns on large tables: **Search Optimization
  Service** (a maintained access path, also billed).

### Caching (three of them — know the difference)

1. **Result cache** — identical query, unchanged data, ~24 hours, no warehouse needed.
2. **Warehouse (local disk) cache** — data read by a running warehouse; lost on suspend.
3. **Metadata cache** — min/max statistics used for pruning.

Suspending a warehouse aggressively saves credits but throws away cache 2. The
common default (auto-suspend 60 s) is right for bursty BI and wrong for a job
that runs every two minutes.

---

## 2. Warehouses: sizing, concurrency, cost

- Sizes XS, S, M, L, XL, 2XL … Each step up **doubles both the compute and the
  credit burn per hour**. Therefore, for a query that scales linearly, twice the
  size at half the time costs the same. That is the whole sizing argument:
  **go bigger for speed only when the query actually parallelizes.**
- If a query is slow because of **spilling to local/remote storage** (visible in
  the Query Profile), a bigger warehouse genuinely helps — more memory.
- If a query is slow because of a bad join or missing pruning, a bigger warehouse
  burns more credits for the same wall-clock. Fix the query.
- **Concurrency** is a different problem from size: use a **multi-cluster
  warehouse** (min/max clusters, auto-scale) for many small concurrent queries,
  not a bigger single cluster.
- **Auto-suspend / auto-resume**: default posture is auto-suspend on, resume on
  demand. Tune per workload, not globally.
- **Resource monitors**: credit quotas per warehouse or account with notify /
  suspend actions. On any client engagement, this is the first governance object
  to put in place, and it makes a good architect answer to "how do you control cost".

**Query Profile** is the tool to know by name: partitions scanned versus total,
spilling, exploding joins, most expensive node.

---

## 3. Loading and open formats

| Pattern | Use when |
|---|---|
| `COPY INTO` from an **external stage** (S3/ADLS/GCS) | Bulk batch loads, backfills; the classic pattern |
| **Snowpipe** | Continuous file-arrival ingestion, serverless, near-real-time |
| **Snowpipe Streaming** | Row-level streaming ingestion (e.g. from Kafka) without staging files |
| **Kafka connector** | Kafka topics into tables; sits on Snowpipe / Snowpipe Streaming |
| **External tables** | Query data in place in object storage; no copy, slower |
| **Iceberg tables** | Open table format managed by or read by Snowflake — the current answer to "we do not want data locked in one engine" |
| **Secure Data Sharing** | No copy, no pipeline: grant another account read access to live data |

Iceberg and Sharing are the two that changed the architecture conversation most.
"Do we ingest or do we share?" is now a real design decision, not a formality.

Loading practicalities that still matter: file sizes around 100–250 MB
compressed for parallel `COPY`, one warehouse per load lane, `VALIDATION_MODE`
for dry runs, `ON_ERROR` policy chosen deliberately, and a landing schema whose
grain matches the file, not the report.

---

## 4. Transformation inside Snowflake

- **Streams** — change tracking on a table (a CDC offset, not a copy). Standard,
  append-only, and insert-only variants. A stream is consumed inside a
  transaction; reading it in a DML advances the offset.
- **Tasks** — scheduled or triggered SQL, arranged into DAGs (a task can have
  predecessors). Serverless tasks size themselves.
- **Streams + Tasks** was the classic incremental pattern.
- **Dynamic Tables** are the newer, declarative replacement: define the target
  query and a `TARGET_LAG`, and Snowflake decides how to refresh incrementally.
  For most new incremental pipelines this is now the default choice; keep
  Streams+Tasks for logic that does not fit a single declarative query.
- **Snowpark** — DataFrame API in Python/Java/Scala executing inside Snowflake,
  plus UDFs, UDTFs and stored procedures. This is the "you do not have to move
  data to Spark" answer. Snowpark Container Services runs containerized
  workloads next to the data.
- **dbt** remains the common orchestration/modeling layer on top of all of this
  in most retail estates — see `dbt-primer.md`.

---

## 5. Security and governance (Horizon)

RBAC is the backbone. Know the system roles and their intent:

`ORGADMIN` · `ACCOUNTADMIN` · `SECURITYADMIN` · `USERADMIN` · `SYSADMIN` · `PUBLIC`

Standard practice to state in an interview:

- Nobody works as `ACCOUNTADMIN`. Grant it to two people, use it for billing and
  account-level settings only.
- Build **functional roles** (analyst, engineer, loader) granted to **access
  roles** (read/write per schema), which own the object grants. Two-layer model.
- Objects are owned by a role, not a person. Ownership follows the role hierarchy.
- Use `MANAGED ACCESS` schemas where grant sprawl is a risk.

Governance features to name:

- **Object tagging** and tag-based policies — the mechanism for "classify once,
  protect everywhere".
- **Dynamic Data Masking** (column-level, role-aware) and **Row Access Policies**
  (row-level filtering) — the standard answer for PII in a consumer/loyalty estate.
- **Data classification** for automatic PII detection.
- **Access History** and **Object Dependencies** views — lineage and audit.
- **Data Metric Functions** — data-quality checks scheduled on tables.
- **Network policies**, private connectivity (PrivateLink), SSO/SCIM, key-pair
  auth for service accounts.

Time Travel and Fail-safe belong in the same conversation: Time Travel is
configurable retention (1 day standard edition, up to 90 days on Enterprise) for
`AT`/`BEFORE` queries, `UNDROP`, and **zero-copy cloning**; Fail-safe is a
non-configurable 7-day Snowflake-side recovery window and is not a backup
strategy you can operate.

**Zero-copy cloning** deserves its own sentence in any architecture: dev and test
environments cloned from production in seconds, paying only for changed data.

---

## 6. SAP and Snowflake

Relevant because "SAP + Snowflake" is now an explicit market ask.

Ways SAP data reaches Snowflake, from most SAP-native to most generic:

1. **SAP Business Data Cloud ↔ Snowflake** — the partnership route: semantically
   rich SAP data shared into Snowflake with zero-copy sharing rather than a
   copied pipeline. Newest option, strongest on semantics and governance,
   dependent on the customer's SAP licensing and roadmap.
2. **SAP Datasphere** as the modeling and federation layer, exporting or sharing
   outward.
3. **Extractor-based ETL** — ODP / CDS view extraction (or SLT for real-time
   table replication) into a landing zone, then `COPY INTO`. This is where most
   existing estates actually are.
4. **Third-party connectors** — Fivetran, SNP Glue, Qlik, Theobald and similar.
   Fast to stand up; licence cost and SAP-side load are the trade-offs.
5. **Database-level CDC** — read the underlying tables directly. Cheapest,
   worst on semantics, and a licensing question with SAP. Mention it as an
   option and its risks, do not recommend it lightly.

Architect points to make regardless of route: extraction must not hurt the
source system (delta strategy, batch windows), the semantic layer has to survive
the trip (company codes, ledgers, currencies, fiscal periods), and Finance data
needs **reconciliation** back to the source ledger or nobody will trust it.

See `sap-s4hana-finance-and-migration.md` for the data model and
`sap-datasphere-bdc-btp-primer.md` for the SAP-side products.

---

## 7. Snowflake versus Databricks — the question you will get

Do not fight the premise; give the honest architecture answer.

- Both have converged: Snowflake added Python, containers and Iceberg;
  Databricks added SQL warehouses and governance.
- Snowflake still wins on: SQL-first workloads, near-zero platform operations,
  concurrency handling, sharing, and predictable governance.
- Databricks still wins on: ML and data-science workflows, heavy custom Spark,
  streaming-first architectures, and lakehouse-native open storage.
- The real selection driver is usually the team, not the engine: who maintains
  it, what the analysts write, and where the existing estate already is.

---

## 8. Refresh checklist

- [ ] Explain the three-layer architecture and where the money goes.
- [ ] Size a warehouse and defend it (spilling versus pruning).
- [ ] Describe an incremental pipeline two ways: Streams + Tasks, and Dynamic Tables.
- [ ] Draw the two-layer RBAC model on a whiteboard.
- [ ] Name the PII controls: masking policy, row access policy, tags, classification.
- [ ] Say what Time Travel, Fail-safe and cloning each are, and are not.
- [ ] Give the four routes for SAP data into Snowflake and pick one with reasons.
- [ ] Have one cost-control story ready (resource monitors, auto-suspend, right-sizing).

Feature surface moves fast — check the current Snowflake docs before stating
anything here as a hard limit.
