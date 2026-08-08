---
title: Cloud Database & Data Migration to AWS — Architect's Refresher
summary: Roadmaps, the 7 R's, DMS/SCT, SQL and NoSQL targets, and landing migrated data in a lakehouse — with reconciliation as the load-bearing part.
topic: data-engineering
format: refresher
tags: [aws, migration, dms, sct, cdc, reconciliation, dynamodb, lakehouse]
updated: 2026-08-07
---

## Frame

Migration is usually stated as one competency — "migrate the databases to AWS" — and is really four: portfolio discovery, roadmap sequencing, the mechanics of moving bytes, and proving the result is correct. This refresher covers all four, and treats everything downstream (Databricks, Glue, Airflow) as the destination you are migrating *into*.

Three mental models to anchor everything below:

1. **Migration is a portfolio problem before it's a database problem.** Nobody migrates one database; they migrate an estate of 20–200 with tangled dependencies. The architect's first value-add is *discovery, dependency mapping, wave sequencing* — not DMS settings. Lead with the roadmap.
2. **The hard part is proving it's correct, not moving the bytes.** DMS moves the data; the project's credibility rides on reconciliation, cutover discipline, and rollback. Reconciliation and lineage are first-class architecture, not paperwork — they are what produces the data dictionaries, metadata repositories and lineage documentation an estate needs afterwards.
3. **"Lift-and-shift" and "modernize" are a spectrum, not a binary.** The 7 R's let you place each workload deliberately and defend why you chose differently for different apps in the same wave.

One caution worth holding throughout: fluency in DMS and SCT as *patterns* is not the same as having tuned them in anger. The two are easy to conflate, and the distinction matters most exactly when a migration starts going wrong.

---

# Section 1 — Migration strategy: the 7 R's

AWS's migration-strategy taxonomy (originally Gartner's "6 R's", AWS added Relocate). For each workload in the estate you pick one. Know the one-liner *and* the "pick this when".

| Strategy | What it is | Pick this when |
|---|---|---|
| **Rehost** ("lift and shift") | Move as-is to EC2 / same engine, no code change | Speed/deadline-driven; datacenter exit; you'll optimize *after* landing. Lowest risk, lowest reward. |
| **Replatform** ("lift, tinker, shift") | Move with targeted optimization — e.g. self-managed Oracle → RDS/Aurora, same engine, managed service | You want managed-service wins (backups, HA, patching) without rewriting the app. The pragmatic default for databases. |
| **Repurchase** ("drop and shop") | Replace with a different product, often SaaS | Legacy app with a viable SaaS equivalent; e.g. on-prem CRM → Salesforce, self-hosted analytics → Redshift/Snowflake. |
| **Refactor / Re-architect** | Rewrite substantially to be cloud-native | Strong business case for scale/agility; e.g. monolith RDBMS → DynamoDB single-table + microservices, or batch ETL → lakehouse. Highest cost/risk, highest payoff. |
| **Relocate** | Move infra wholesale without buying/changing — VMware Cloud on AWS, or container/VM re-pointing | You have VMware estate and want to move hypervisor-to-hypervisor with no OS/app change. Rare for pure DB work. |
| **Retire** | Decommission — it's unused | Discovery reveals nobody reads it (often 10–20% of an estate). Free wins; surface them early. |
| **Retain** ("revisit") | Leave on-prem for now | Regulatory/latency/dependency reasons, or not worth it this wave. Be explicit it's a *decision*, not an oversight. |

**Framing:** *"I pick per workload during assessment, not one R for the program. Databases are usually Replatform (Oracle → Aurora PostgreSQL) or Refactor (relational → DynamoDB / lakehouse). Rehost is my fallback for hard-deadline datacenter exits where I optimize in a fast-follow wave."*

---

# Section 2 — Building the roadmap

Creating roadmaps and architecture to execute migration workloads is the part that most needs a repeatable method. Here is one.

**a. Discovery & assessment.** Inventory every database — version, engine, size, I/O profile, uptime SLA, and *who consumes it*. Tooling: **Application Discovery Service** (infra), **Migration Evaluator** (DB sizing + license/cost projection) — note **AWS DMS Fleet Advisor reached end of support on 2026-05-20**, and AWS now directs assessment to Migration Evaluator, so cite *Migration Evaluator*, not Fleet Advisor — and **SCT assessment reports** (conversion complexity). Output: a workload catalog with a first-pass R each.

**b. Portfolio & dependency analysis.** Map application↔database↔downstream dependencies — the killer is a "small" DB that 14 reports silently depend on. Classify by **migration complexity** (homo/heterogeneous, PL/SQL volume, integration surface) × **business criticality**. Produces the **dependency graph** that constrains wave order.

**c. Wave planning.** Group workloads into **waves** respecting dependencies and tolerable blast radius. Early waves: low-risk, low-dependency (build the muscle, prove the factory). Late waves: crown jewels. Each wave is a repeatable **migration factory** run — same runbook, tooling, reconciliation gates.

**d. AWS MAP framing (say this phrase).** **Migration Acceleration Program (MAP)** = AWS's three-phase methodology: **Assess → Mobilize → Migrate & Modernize**, with funding/credits and a toolkit (Migration Hub, MGN, DMS, Application Discovery Service). Assess = readiness + business case + directional TCO; Mobilize = landing zone, capability gaps, pilot; Migrate & Modernize = execute waves. Naming MAP signals you've run a program, not a single-DB move.

**e. Business case / TCO.** Current run cost (license, hardware, DC, ops) vs target (managed service + storage + egress) — Aurora/RDS removing Oracle/SQL Server licensing is usually the headline saving. Include migration *cost* (effort, tooling, dual-run) and risk-weighted timeline, not just steady-state savings.

**f. Sequencing.** Dependency order + risk appetite + value: **Retire** first (free), low-risk Replatform next, heterogeneous Refactor mid-program, crown jewels last.

**g. Success / exit criteria (define up front).** Per workload: reconciliation passed (counts + checksums within tolerance), performance ≥ baseline, cutover window met, rollback tested, owners signed off, lineage/dictionary updated. No wave is "done" until its exit gate is green.

**Framing:** *"My roadmap is discovery → dependency-mapped portfolio → wave plan with explicit exit criteria, wrapped in MAP's Assess/Mobilize/Migrate phases. Each wave is a repeatable factory run, so risk goes down wave over wave."*

---

# Section 3 — AWS DMS (Database Migration Service)

The workhorse for moving the *data*. (Schema/code is SCT's job — §4.)

**a. The two phases.** **Full load** bulk-copies existing rows source→target. **CDC / ongoing replication** reads the source transaction log (Oracle redo/LogMiner or Binary Reader, SQL Server transaction log, Postgres logical replication/WAL, MySQL binlog) and applies ongoing changes. **Full load + CDC** is the near-zero-downtime pattern: bulk-load history, CDC keeps target synced until cutover.

**b. Homogeneous vs heterogeneous.** *Homogeneous* (Oracle→Oracle, MySQL→Aurora MySQL): schema compatible, DMS alone often suffices. *Heterogeneous* (Oracle→Aurora PostgreSQL, SQL Server→MySQL): schema/code differ — **SCT first** to convert schema + procedural code, then **DMS** for data. The **SCT + DMS combo** (§4d).

**c. Components.** **Replication instance** = the EC2-backed compute running tasks (sizing matters). **Source & target endpoints** = connection defs (creds via Secrets Manager); DMS supports RDBMS, S3, Redshift, DynamoDB, Kinesis, Kafka, OpenSearch, DocumentDB, Neptune. **Tasks** = full-load / CDC / both, with table mappings and transformation rules.

**d. DMS Serverless.** Auto-scales replication capacity (DCUs) instead of you sizing a fixed instance — good for variable load / no capacity planning. Trade-off: less control, and not every source/target/feature is supported — check the matrix before promising it.

**e. Gotchas.**
- **LOBs** — *Full LOB mode* safe but slow; *Limited LOB mode* fast but truncates over the set size; *Inline LOB* the hybrid. Wrong mode silently corrupts data — call it out.
- **No primary key** — CDC needs to identify rows; no-PK tables break ongoing replication. Add a key or full-load-only them.
- **Throughput / instance sizing** — undersized instance = the bottleneck. Watch source + target CDC latency and `CDCIncomingChanges`; multi-AZ for production CDC.
- **DMS does data, not perfect schema** — it creates only a basic target schema (PKs, not always secondary indexes, FKs, triggers, sequences). Use SCT or hand DDL; **build indexes/constraints after full load**, before CDC catch-up.
- **Validation** — DMS built-in **data validation** (row-by-row compare). Turn it on; it's your first reconciliation layer (§10).
- **Large tables** — parallel load / table-segmentation (range or partition-based) to speed huge full loads.

---

# Section 4 — AWS SCT (Schema Conversion Tool)

Converts the *schema and procedural code* for **heterogeneous** migrations. (Homogeneous moves usually don't need it.)

**a. What it does.** Converts source DDL (tables, views, indexes) and **procedural code** (PL/SQL packages, T-SQL procs, triggers, functions) to the target dialect (Aurora PostgreSQL/MySQL, Redshift). Produces an **Assessment Report**: % converted automatically vs manual, with effort estimates — **use this in the roadmap (§2)** to size heterogeneous workloads.

**b. Auto vs manual.** *Auto*: most table DDL, standard data types, straightforward views, simple stored logic. *Manual*: proprietary PL/SQL constructs, packages, autonomous transactions, Oracle-specific functions, complex T-SQL, hierarchical/`CONNECT BY` queries, sequence semantics, data-type edge cases — flagged with action items. Honest framing: *"SCT gets you maybe 70–90% on a typical OLTP schema; the long tail of stored procedures is the real conversion effort."* (Directional — don't quote it as guaranteed.)

**c. Targets.** Oracle / SQL Server → **Aurora PostgreSQL or MySQL** (OLTP modernization, license escape). Oracle / SQL Server / Teradata / Netezza → **Redshift** (DW migration). SCT has **data extraction agents** for large DW migrations (e.g. Teradata→Redshift) that extract, compress, and stage to S3 for load.

**d. The DMS + SCT combo (the canonical heterogeneous pattern).**
1. **SCT**: assess → convert schema + code → apply converted schema to target (manually fix the flagged objects).
2. **DMS**: full-load the data into the SCT-built schema, then CDC to keep in sync.
3. Cut over when CDC latency ≈ 0 and reconciliation passes.

**One-liner:** *"SCT converts the schema and code; DMS moves and syncs the data. Heterogeneous = both; homogeneous = usually just DMS."*

**Currency note (2026):** the standalone **SCT desktop app** still exists, but AWS now offers **DMS Schema Conversion (DMS SC)** — a managed, in-console web version of SCT — so you can assess, convert, and migrate from the DMS console without installing anything. DMS SC supports fewer source/target platforms than the desktop SCT, so the heavy heterogeneous long-tail conversions still favour the desktop tool. Say: *"DMS Schema Conversion for the common path in-console; SCT desktop for the deep heterogeneous conversions."*

---

# Section 5 — SQL database migrations

Engine-by-engine target selection.

| Source | Common target | Why / notes |
|---|---|---|
| **Oracle** (self-managed) | **Aurora PostgreSQL** | License escape + Postgres is the closest mature OSS-compatible dialect to Oracle. SCT + Babelfish-style effort on PL/SQL. Heterogeneous → SCT+DMS. |
| **Oracle** (minimize change) | **RDS for Oracle** | Replatform with least code change; you still pay Oracle license (BYOL). Pick when PL/SQL volume makes conversion uneconomic. |
| **SQL Server** | **Aurora PostgreSQL/MySQL**, or **Babelfish for Aurora PostgreSQL** | Babelfish gives T-SQL/TDS compatibility on Aurora PostgreSQL — reduces app rewrite. Or RDS for SQL Server to replatform with least change. |
| **MySQL / MariaDB** | **Aurora MySQL** or **RDS MySQL** | Homogeneous; DMS alone. Aurora for scale/throughput, RDS for simplicity. |
| **PostgreSQL** | **Aurora PostgreSQL** or **RDS PostgreSQL** | Homogeneous; near-lift. Logical replication makes near-zero-downtime easy. |
| **Any OLTP → analytics** | **Redshift** (warehouse) or **lakehouse** (S3 + Glue/Databricks) | Don't put OLTP onto Redshift; Redshift is a columnar MPP *warehouse*, not a transactional store. |

**Engine-choice reasoning to voice.** *Aurora vs RDS*: Aurora = AWS's cloud-native engine (separated storage, 6-way replication, faster failover, read scaling) — pick for performance/scale. RDS = managed vanilla engine — pick for max compatibility/least surprise. *PL-SQL conversion reality*: schema converts more easily than *behavior* — sequences, implicit type coercion, `ROWNUM`/`CONNECT BY`, packages, date handling differ Oracle↔Postgres (the manual long tail). Plan for app-side SQL changes and regression testing, not just DB-side conversion.

---

# Section 6 — NoSQL migrations

### 6a. Targets
| Source / shape | AWS target | Notes |
|---|---|---|
| Key-value / high-scale OLTP | **DynamoDB** | Serverless, single-digit-ms, virtually unlimited scale. **Access-pattern-first design** (below). |
| **MongoDB** | **DocumentDB** | MongoDB-API-compatible managed document DB. DMS supports Mongo→DocumentDB; or `mongodump`/native tools + AWS DMS for CDC. |
| **Cassandra** | **Keyspaces** (for Apache Cassandra) | Serverless, CQL-compatible. Good for existing Cassandra workloads wanting managed. |

**b. DynamoDB single-table design.** *Model access patterns first, schema second* — the cardinal NoSQL rule, opposite of relational design. Enumerate every query the app makes, *then* design the partition key (PK) and sort key (SK) to serve them. **Single-table design** = multiple entity types in one table with composite/overloaded keys and **GSIs (Global Secondary Indexes)** for secondary access patterns; minimizes round-trips. No joins, no 3NF, no ad-hoc flexibility — you trade query flexibility for predictable scale and latency.

**c. When relational→NoSQL is *wrong*.** Ad-hoc/unpredictable query patterns (can't model what you can't predict); strong multi-entity transactions, complex joins, heavy aggregation/reporting (keep relational, or land in a warehouse/lakehouse). The classic anti-pattern is *"moving to DynamoDB to be modern"* with no access-pattern analysis — call it out: *"Lifting a relational OLTP schema into DynamoDB without redesigning around access patterns produces a slow, expensive, scan-heavy disaster. If the workload needs flexible querying, the target is Aurora or a lakehouse, not Dynamo."*

---

# Section 7 — Migration patterns (cutover mechanics)

**a. Big-bang vs trickle/phased.** *Big-bang*: freeze source, migrate in one window, switch over — simple but high-risk, needs a long enough downtime window. Pick for small/non-critical systems. *Trickle/phased*: migrate incrementally (by table group, tenant, wave) while both run — lower risk, longer timeline, two systems live. Pick for large/critical estates.

**b. Dual-run (parallel run) with reconciliation.** Run old and new **in parallel**, feeding both, continuously **reconciling** outputs on real traffic. The gold-standard de-risking pattern for crown-jewel data. Cost: operating two systems for the dual-run window.

**c. Historical backfill + CDC delta (your home turf).** **Backfill** full history once (full-load), then **CDC delta** keeps the target current; "caught up" when CDC latency ≈ 0. The near-zero-downtime spine of most modern migrations — *exactly* the pattern in your SAP→Snowflake story (multi-TB backfill + daily delta).

**d. Cutover & rollback.** *Cutover*: redirect apps via DNS/connection-string flip, feature flag, or write-redirect — when reconciliation is green and CDC caught up. *Rollback*: keep source authoritative until sign-off; consider **reverse CDC** (target→source) during bedding-in so you can fall back without data loss. Never cut over without a rehearsed rollback.

**e. Zero/low-downtime.** **Full-load + CDC** (DMS) is the canonical path. Cutover window = brief write-freeze → CDC drains remaining changes → flip → validate, often minutes not hours. **RDS/Aurora Blue/Green Deployments** are the managed variant for homogeneous engine-version moves.

---

# Section 8 — Landing into a lake / lakehouse

This is where migration meets its destination — S3, Glue, Redshift, Databricks/Delta.

### 8a. The medallion landing pattern
```
On-prem source (SQL + NoSQL)
        │  DMS / batch extract / file drop
        ▼
   S3 — RAW / Bronze            (immutable landed data, partitioned, schema-on-read)
        │  Glue (PySpark) / EMR / Databricks transform
        ▼
   Curated / Silver             (cleaned, conformed, deduped, typed)
        │  business modeling, aggregation
        ▼
   Gold                         (analytics-ready: Delta tables, or loaded to Redshift)
```
- **Bronze**: raw, append-only, partitioned by source + ingest date. Never mutate; it's your replay source.
- **Silver**: cleansed, conformed, **CDC merged** (Delta `MERGE` / Glue upserts) so the lake reflects current state.
- **Gold**: business-level marts; serve via Redshift (Spectrum or loaded) or Delta/Unity Catalog for Databricks.

**b. CDC into the lake.** *DMS → S3 target*: DMS writes full-load + CDC directly to S3 (Parquet) with operation flags (I/U/D); a Glue/Spark/Databricks job merges them into Silver Delta. *Debezium + Kafka (MSK)*: log-based CDC → Kafka topics → sink to S3/Delta — pick when you have a streaming backbone or the change stream has *multiple* consumers. Either way, Silver applies the change log via **merge/upsert** keyed on the business key, turning an append-only stream into current-state tables.

**Framing:** *"DMS-to-S3 is the simplest CDC-into-the-lake path; Debezium-on-Kafka is right when the change stream has more than one consumer. Both land as ordered change records I merge into Delta/Silver with the operation flag."*

---

# Section 9 — Bulk transfer & connectivity

How the bytes physically get to AWS. **Choose by data volume ÷ available bandwidth ÷ acceptable time.** Do the napkin math explicitly (e.g. 100 TB over a 1 Gbps link saturated ≈ ~10+ days; over the wire that's a non-starter → physical transfer).

| Service | What it is | Choose when |
|---|---|---|
| **AWS DataSync** | Managed agent for online file/object transfer (NFS/SMB/HDFS/S3) | Online transfer over network; recurring or one-time file/object movement; can sync incrementally. |
| **Snowball Edge** | Physical appliance shipped to you; load locally, ship back | Large volumes (tens of TB up) where network transfer is too slow/expensive; poor connectivity sites. (Snowmobile, the truck, is retired — don't cite it.) |
| **Storage Gateway** | Hybrid on-prem appliance presenting AWS storage (File/Volume/Tape Gateway) | Ongoing hybrid access / gradual migration with cached local access; tape replacement (VTL). |
| **AWS Direct Connect** | Dedicated private network link to AWS | Sustained high-throughput, predictable-latency, secure private connectivity; ongoing migration + steady-state. |
| **S3 Transfer Acceleration** | Routes uploads via CloudFront edge to S3 | Geographically distant, internet-based uploads needing a speed boost; not for LAN-local. |
| **DMS** | (For *database* moves, not files) | When the source is a live DB and you want full-load + CDC, not a file copy. |

**Rule of thumb:** files → DataSync (online) or Snowball (offline, big); live databases → DMS; sustained pipe → Direct Connect underneath it all.

---

# Section 10 — Validation & governance during migration

Data dictionaries, metadata repositories and lineage documentation all get built — or lost — here. Migration is the *best* time to build governance — you're touching every dataset anyway.

**a. Reconciliation (prove correctness)** — a ladder: **row counts** per table (cheapest) → **checksums/hashes** of key columns or per-partition (catch silent corruption counts miss) → **reconciliation queries**, business aggregates that *must* tie out (finance: trial-balance totals, GL control sums per company code/period — what auditors and owners actually trust). **DMS data validation** is the automated row-level baseline beneath all of it. Define **tolerance** (often zero for finance) and an exception log for explained deltas (e.g. in-flight transactions during CDC).

**b. DQ gates as cutover criteria.** Reconciliation isn't a report you file — it's a **gate**. No cutover until counts + checksums + business reconciliation pass within tolerance and owners sign off. Wire it into the wave's exit criteria (§2g).

**c. Build the data dictionary & lineage *as you migrate*.** For every migrated object capture source→target mapping, transformation logic, owner, classification, SLA into the **metadata repository / catalog** (Glue Data Catalog, Unity Catalog, or enterprise catalog). **Lineage**: source → S3 bronze → Silver → Gold/consumer, emitted via **OpenLineage** from Glue/Spark/Airflow so it survives tool changes; column-level for regulated (finance/SOX) data. Dual-purpose — the migration's audit trail *and* the steady-state governance artefact. Selling it as one effort, two payoffs is an architect-level move.

**d. Cutover sign-off.** Documented gate: reconciliation green, performance ≥ baseline, rollback rehearsed, lineage/dictionary updated, data owner + consuming-team sign-off. Then flip.

---

# Section 11 — A reference migration architecture (end-to-end, in prose)

**Scenario:** heterogeneous on-prem estate — Oracle + SQL Server OLTP, a MySQL app DB, and a MongoDB document store — migrating to an AWS lakehouse with an Aurora OLTP tier, feeding Databricks/Redshift analytics. This is the diagram to be able to sketch from memory.

**Transport / connectivity.** **Direct Connect** = the sustained private pipe. Bulk historical files too big for the wire go via **Snowball Edge**; ongoing file/object sync via **DataSync**. Credentials via **Secrets Manager**.

**OLTP relational hop (Oracle / SQL Server → Aurora PostgreSQL).** **SCT** converts schema + PL/SQL/T-SQL, produces the assessment report (drives wave sizing), applies the schema; manual long-tail procs hand-fixed. **DMS** runs **full-load + CDC** from redo/transaction logs into Aurora; indexes/constraints built after full load; **DMS data validation** runs continuously.

**MySQL hop (homogeneous).** **DMS** alone, full-load + CDC, MySQL → **Aurora MySQL**. No SCT.

**NoSQL hop.** MongoDB → **DocumentDB** via DMS (or native tools + DMS CDC). If a workload is *re-architected* for scale, access patterns are modeled and it lands in **DynamoDB single-table** instead — a deliberate Refactor, not a default.

**Analytics / lakehouse hop (the destination).** In parallel, **DMS writes full-load + CDC to S3 as Parquet**, OR **Debezium → MSK → S3** for multi-consumer streams. S3 is **Bronze** (immutable, partitioned). **Glue (PySpark) / EMR / Databricks** merge the change records (operation-flag `MERGE`) into **Silver Delta** (current-state, conformed), then build **Gold** marts serving **Redshift** (loaded / Spectrum) and **Databricks + Unity Catalog**. **Airflow / MWAA** orchestrates the backfill→delta→merge DAGs (dependency management, retries, monitoring).

**Where reconciliation sits — two points:** (1) **OLTP target** — counts, checksums, business reconciliation source vs Aurora before each cutover; (2) **lakehouse** — Silver/Gold totals tied back to source control sums (finance trial-balance per period) as a DQ gate before analytics consumers switch over. DMS validation is the automated baseline beneath both.

**Where lineage / metadata sits.** A **catalog** populated *as objects migrate* (source→target mappings, transformation logic, owners, classifications, SLAs). **OpenLineage** events from Glue/Spark/Airflow build the source→Bronze→Silver→Gold→consumer graph; column-level for regulated data. Migration audit trail and steady-state governance in one.

**Cutover (per workload).** CDC caught up → brief write-freeze → CDC drains → DNS/connection flip → reconciliation gate green → owner sign-off. Source kept authoritative (reverse-CDC fallback) through bedding-in, then retired.

---

## Check yourself

1. **"Design a migration of 50 on-prem databases to AWS — where do you start?"** → Discovery & inventory (Application Discovery Service / DMS Fleet Advisor) → dependency-mapped portfolio → 7-R classification per workload → wave plan with exit criteria → MAP Assess/Mobilize/Migrate. *Start with the portfolio, not the database.* (§2)
2. **"How do you migrate with near-zero downtime?"** → DMS **full-load + CDC**; backfill history, CDC keeps target synced, cut over in a minutes-long window once CDC latency ≈ 0; tested rollback / reverse-CDC. (§7c, §7e)
3. **"How do you prove the migration is correct?"** → Layered reconciliation: row counts → checksums → business-level reconciliation queries (e.g. finance control totals) → DMS data validation, wired as a *cutover gate* with defined tolerance and owner sign-off. (§10)
4. **"Oracle → Redshift vs Oracle → Aurora?"** → Different *purposes*. Aurora PostgreSQL = OLTP modernization / license escape (transactional). Redshift = analytics warehouse (columnar MPP) — only if the workload is analytical. Don't put OLTP on Redshift; don't run a warehouse on Aurora. (§5)
5. **"Homogeneous vs heterogeneous — what changes in your approach?"** → Homogeneous: DMS alone. Heterogeneous: **SCT first** (schema + code conversion, assessment report, manual long-tail) then DMS for data. (§3b, §4d)
6. **"When is migrating a relational DB to DynamoDB the wrong move?"** → When query patterns are ad-hoc/unpredictable or you need joins/complex aggregation. NoSQL is access-pattern-first; lifting a normalized schema in without redesign is the classic anti-pattern. (§6c)
7. **"You have 200 TB to move and a saturated 1 Gbps link — what do you do?"** → Napkin math says weeks over the wire → **Snowball Edge** for bulk history offline + **DataSync/Direct Connect** for the delta and ongoing sync. (§9)
8. **"How do you handle a 4 TB table with LOBs and no primary key in DMS?"** → LOB mode choice (full vs limited vs inline — limited truncates, full is slow); no-PK breaks CDC so add a key or full-load-only; segment the large table for parallel load; size the replication instance and watch CDC latency. (§3e)
9. **"How do you sequence the waves?"** → Retire first (free), low-risk Replatform next to build the factory, heterogeneous Refactor mid-program, crown jewels last; dependency graph constrains order; each wave has explicit exit criteria. (§2c, §2f)
10. **"How do you get CDC into the lakehouse?"** → DMS-to-S3 (Parquet change records) → Glue/Spark/Databricks `MERGE` into Silver Delta; or Debezium→MSK→S3 when multiple consumers need the stream. (§8b)
11. **"How do you build governance during a migration without slowing it down?"** → Capture source→target mappings, owners, classifications, and lineage *as you migrate* into the catalog; emit OpenLineage from Glue/Airflow; it's one effort with two payoffs — migration audit trail + steady-state governance. (§10c)
12. **"What's your rollback plan after cutover?"** → Source stays authoritative through bedding-in; reverse-CDC (target→source) so a fallback loses no data; rehearse the rollback before cutover; never flip without it. (§7d)

---

## A worked reference migration

An ERP-finance-to-lakehouse migration is the most instructive single example, because it exercises every section of this guide at once. The shape:

- **Source and target.** SAP S/4HANA Finance (GL/AR/AP/CO/AA) into a Snowflake lakehouse on AWS — multi-TB historical backfill with roughly 10–30 GB of daily delta on top.
- **The path.** SAP source → S3 / EMR / Glue → Snowflake, landing through the Bronze→Silver→Gold pattern (§8) on the historical-backfill-plus-CDC-delta spine (§7c).
- **The architecture work.** Reference architecture, partitioning strategy, and Delta-style merge patterns, with an MVP scoped to one region and a few dozen company codes — wave and scope sequencing exactly as §2 and §11 describe it.
- **Where it gets hard.** Reconciliation gates, plus data dictionaries and lineage documentation produced *during* the migration rather than after it (§10). Finance is the most demanding version of this because control totals have to tie out to the cent — which is also why it is the best domain to learn it in.
- **What this shape does not teach you.** A homogeneous ERP-to-lakehouse pipeline never exercises **SCT**'s heterogeneous schema-and-procedural-code conversion. That long tail of PL/SQL/T-SQL conversion is a genuinely different problem, and reading about it is not the same as having done it.

---

## Vocabulary

- *"The 7 R's"* / *"per-workload disposition"* — strategy classification, not a blanket lift-and-shift.
- *"Migration factory"* / *"wave plan"* — repeatable, risk-decreasing execution.
- *"Full-load plus CDC"* — the near-zero-downtime spine.
- *"Heterogeneous vs homogeneous"* — the SCT-or-not fork.
- *"SCT + DMS combo"* — the canonical heterogeneous pattern.
- *"Cutover gate / exit criteria"* — reconciliation as a gate, not a report.
- *"Reconciliation: counts → checksums → business control totals"* — the correctness ladder.
- *"Reverse CDC"* — the credible rollback story.
- *"Access-pattern-first / single-table design"* — DynamoDB literacy.
- *"Bronze / Silver / Gold"* + *"CDC merge / upsert keyed on business key"* — lakehouse landing.
- *"AWS MAP — Assess / Mobilize / Migrate & Modernize"* — program-scale signal.
- *"OpenLineage"* / *"build governance as you migrate"* — ties migration to the lineage story.
- *"Babelfish"* (T-SQL on Aurora PostgreSQL) — a sharp detail that signals current AWS knowledge.

---

## Things to skip

- **Memorizing DMS quotas, DCU pricing, or exact throughput benchmarks.** Know the *shape* (instance sizing matters, serverless auto-scales, watch CDC latency); the numbers are googleable and change.
- **Deep SCT PL/SQL-construct compatibility matrices.** Know that the long tail of procedural code is the manual effort; don't recite which functions convert.
- **Snowmobile** — the truck is retired; don't cite it. Snowball Edge is the current physical-transfer answer.
- **Religious "Aurora vs Snowflake vs Redshift" wars.** Place each by purpose (OLTP / lakehouse / warehouse); don't evangelize.
- **Mainframe / COBOL migration specifics** — a distinct discipline, out of scope here.
- **Conflating pattern fluency with delivery experience on DMS/SCT.** The patterns are learnable from a guide; the operational judgement is not.

---


