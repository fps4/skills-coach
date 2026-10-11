---
title: Microsoft Fabric — Architect's Primer
summary: Fabric's capacity model, OneLake, the compute surfaces, Direct Lake, Real-Time Intelligence, Synapse migration and where Fabric stops against Databricks on Azure.
---

## Frame

The product vocabulary of Fabric at conversational speed — the names, the boundaries, and the places
where Fabric behaves differently from what a Databricks user would assume.

Three mental models:

1. **Fabric is SaaS, Databricks is PaaS.** Databricks runs compute in *your* subscription against
   *your* storage. Fabric runs everything inside a Microsoft-managed tenant, on OneLake, against a
   capacity you pre-pay. That explains most of the rest — no cluster to size, no per-workload price,
   a workspace-shaped rather than catalog-shaped security model.
2. **One storage layer, many engines.** OneLake is the only place data lives. Warehouse, Lakehouse,
   Eventhouse and the semantic model are engines over the same Delta-Parquet files. Compare them on
   **write surface and guarantees**, not storage.
3. **The capacity is the architecture.** On a metered platform a bad workload costs money. On Fabric a
   bad workload costs *everyone else's latency*, until it costs a whole rung. Capacity planning is a
   design constraint next to residency and throughput, not a FinOps afterthought.

> **Dated claims.** Fabric ships every few weeks. Items marked **⚠ verify** have moved before; check
> the current Microsoft docs before stating them as fact.

---

# Section 1 — Capacities

## 1a. The ladder

Capacity is bought as an **F SKU** in an Azure subscription: **F2, F4, F8, F16, F32, F64, F128, F256,
F512, F1024, F2048** — nothing in between. The number is **capacity units (CU)**. An estate needing 33
sustained CU buys F64 and pays for F64.

Legacy **P SKUs** (Power BI Premium) map onto the same platform — P1 ≈ F64, P2 ≈ F128, P3 ≈ F256.
Microsoft has been moving customers from P to F; that retirement is often the real reason Fabric is on
the table. **⚠ verify**

| Shape | What it is | Catch |
|---|---|---|
| Pay-as-you-go | Billed per hour running | Can be **paused** and bills nothing; everything on it stops |
| Reservation (1 year) | Substantially cheaper **⚠ verify discount** | Cannot be paused |
| Trial | 60-day, roughly F64 | Not a planning instrument |

A dev or test capacity paused outside office hours is a different cost line from production — a lever
with no Databricks equivalent.

## 1b. Smoothing, bursting, throttling

- **Bursting** — one operation may briefly consume more CU than the capacity nominally has, so a heavy
  query does not simply fail on a small SKU.
- **Smoothing** — consumption is spread over a window. **Interactive** operations (report render,
  ad-hoc SQL) smooth over **minutes**; **background** operations (pipelines, Spark, refreshes) over
  **24 hours**. That is why overnight batch does not throttle morning users.
- **Throttling** — when smoothed future usage exceeds what the capacity can pay off, it degrades in
  stages:

  | Stage | Roughly when | Effect |
  |---|---|---|
  | Interactive delay | ~10–60 min of accumulated overage | Queries slowed |
  | Interactive rejection | ~1–24 h | Interactive requests refused |
  | Background rejection | beyond ~24 h | Scheduled jobs refused too |

  **⚠ verify thresholds.** The durable part is the shape: interactive degrades first, background last.

- **Surge protection** — a capacity-admin setting that caps background usage so a runaway job cannot
  starve interactive users.

**Design rule:** planning a capacity to 100% means throttled interactive users at month-end while
background jobs catch up. Size against two allowances — the whole estate, and a stricter one for
interactive work — and the binding one sets the rung.

## 1c. The F64 cliff

**Content in a workspace on F64 or above can be consumed by users without a Power BI Pro licence.**
Below F64, every consumer needs Pro or PPU. An estate with thousands of report consumers has a
different answer at F32 than at F64, and consumer licensing can decide the SKU regardless of compute.

## 1d. Autoscale billing for Spark

Spark jobs billed pay-as-you-go against a serverless meter instead of capacity CU — taking Spark out of
throttling, at the cost of a separate meter. A third option between buying a bigger SKU and moving a
workload to another platform. **⚠ verify availability and naming.**

---

# Section 2 — OneLake

## 2a. What it is

**One logical data lake per tenant**, provisioned automatically, on ADLS Gen2 semantics, with
workspaces as top-level folders.

```
onelake/
  <workspace>/
    <item>.Lakehouse/
      Tables/      ← Delta tables
      Files/       ← unmanaged files
    <item>.Warehouse/
    <item>.KQLDatabase/
```

OneLake speaks the **ADLS Gen2 / ABFS driver**, so Azure Databricks, Synapse Spark, ADF and any ABFS
client can read and write it. **Delta-Parquet is the native table format** across every engine.

## 2b. Shortcuts

A **shortcut** references data elsewhere — another OneLake location, ADLS Gen2, S3, GCS, Dataverse —
presented as if it were in OneLake. No copy, no pipeline, no second bill. Shortcuts answer the
"Fabric means copying everything into Microsoft's lake" objection and let a Databricks + Fabric estate
coexist. They are also a **governance seam**: permissions across a shortcut are not automatically the
permissions of the target.

## 2c. Mirroring

**Near-real-time replication of an external database into OneLake as Delta, managed by Fabric, with no
pipeline to build.** Sources include Azure SQL, Cosmos DB, Snowflake, PostgreSQL and **Azure Databricks
Unity Catalog**. **⚠ verify source list.** Mirroring storage and compute are free up to an allowance
tied to the capacity size.

**Unity Catalog mirroring** is the answer to "we have Databricks and want Power BI on Fabric": mirror
the catalog into OneLake, serve it with Direct Lake, and keep Databricks as the engine of record —
not a migration.

## 2d. V-Order

A write-time Parquet optimisation — sorting, encoding, compression tuned for VertiPaq. **Costs write
throughput, pays back at read.** Disable it on write-heavy Spark tables that no semantic model reads.

---

# Section 3 — The compute surfaces

| Surface | Engine | Write surface | Use it when |
|---|---|---|---|
| **Lakehouse** | Spark | Spark / notebooks / Dataflows | Files, Python/Scala transformation, ML, medallion layering |
| **Warehouse** | Distributed T-SQL | **Full T-SQL DDL/DML** | SQL teams; `INSERT`/`UPDATE`/`MERGE` and **multi-table transactions** |
| **Eventhouse / KQL DB** | Kusto | Streaming ingest, KQL | Telemetry, logs, time series, event exploration |
| **SQL Database in Fabric** | SQL Server engine | Full OLTP | Operational workload that also belongs in the analytics estate — auto-mirrored to OneLake |
| **Semantic model** | VertiPaq / Direct Lake | read | Power BI serving layer |

## 3a. Lakehouse vs Warehouse

- A **Lakehouse** has a **SQL analytics endpoint**: **read-only T-SQL**. `SELECT`, views, any SQL
  client — but no `INSERT`, `UPDATE`, `DELETE` or `MERGE`. Writes happen in Spark.
- A **Warehouse** is full T-SQL: DDL, DML, stored procedures and **transactions spanning multiple
  tables**.

**Rule:** if correctness depends on two tables changing together, or a stored-procedure T-SQL codebase
must keep working, it is a Warehouse. Spark, files or ML go to a Lakehouse. Cross-database queries
make a mixed estate normal. Remove the multi-table transaction and a crash between two writes leaves
torn rows — that is the concrete case for the Warehouse.

## 3b. Eventhouse and Real-Time Intelligence

- **Eventstream** — low-code ingest and routing from Event Hubs, Kafka, IoT Hub or CDC feeds to
  Eventhouse, Lakehouse, Activator or derived streams, with a light processor for filtering and joins.
- **Eventhouse / KQL Database** — the Kusto store: very fast ingest, sub-second KQL over huge event
  volumes. **OneLake availability** exposes the same data as Delta.
- **Activator** — condition-based triggers: when a pattern appears, fire an action.

Eventstream is not a stream-processing engine in the Spark Structured Streaming sense. **Event-time
windows, watermarks and restating a window when a late event arrives** are Structured Streaming
ground. An ingestion-time engine drifts per window and counts every redelivery twice. **⚠ verify** how
far Eventstream windowing has moved.

---

# Section 4 — Direct Lake

- **Import** — data copied into the semantic model on a schedule. Fast, stale, refresh windows.
- **DirectQuery** — every visual becomes a SQL query against the source. Fresh, slow, source under load.
- **Direct Lake** — the model reads **Delta-Parquet files in OneLake directly into VertiPaq**, page by
  page, on demand. Import-mode speed with no refresh job.

Beyond the pitch:

- **It falls back to DirectQuery** when it cannot hold the model — table too large for the SKU,
  unsupported constructs, certain view or security setups. A silent fallback is a classic production
  surprise.
- **Guardrails scale with the SKU** — row-count and model-size limits per F SKU.
- **It wants well-maintained Delta** — V-Ordered, compacted, no masses of small files. Direct Lake
  performance is a table-maintenance problem.
- Treat it as a **bounded premium** for specific workloads, not a universal win.

See [Power BI for data architects](./power-bi-for-data-architects.md) for storage modes in general.

---

# Section 5 — Data Factory in Fabric

- **Pipelines** — control flow and Copy activity; ADF's pipeline surface inside Fabric, billed on the
  capacity.
- **Dataflows Gen2** — Power Query (M) transformation for analysts. Cheap to build, expensive to own at
  scale; the architect decides where the boundary with engineered pipelines sits rather than banning them.
- **Copy job** — simpler incremental copy. **⚠ verify naming.**
- **Notebooks and Spark job definitions** for anything substantial.

ADF still matters for integration-runtime features (self-hosted IR for on-prem sources). A hybrid
estate often keeps ADF or uses the **on-premises data gateway**; "Fabric pipelines replace ADF
everywhere" is a sales line, not an architecture one.

---

# Section 6 — Fabric vs Databricks on Azure

| Dimension | Fabric | Databricks on Azure |
|---|---|---|
| Model | SaaS, Microsoft tenant | PaaS, your subscription and storage |
| Cost shape | Pre-paid capacity, step function | Metered DBU, straight line |
| Marginal workload | €0 until saturation, then a whole rung | Priced on its own |
| BI serving | Direct Lake | Power BI over SQL warehouse; Import or DirectQuery |
| T-SQL | Full, in Warehouse | Not a T-SQL surface |
| Streaming semantics | Eventstream + Eventhouse; weaker on event-time restatement | Structured Streaming — watermarks, event time, exactly-once sinks |
| ML lifecycle | Notebooks + MLflow, thinner | Mature — MLflow, feature engineering, serving, UC lineage |
| Governance | Workspace roles, OneLake data access roles, Purview, domains | Unity Catalog — finer-grained, catalog-shaped |
| Platform engineering | Git integration, deployment pipelines, REST, CLI, Terraform **⚠ verify** | Asset Bundles, Terraform, mature CI/CD |

**In one sentence:** on a metered platform a workload's cost is a property of the workload; on a
capacity it is a property of the estate — so per-workload price tables answer a question nobody asked.

**Fabric wins** on Power BI-centric estates (Direct Lake, the F64 licensing cliff), T-SQL
stored-procedure estates, one bill and one vendor, and unused capacity headroom as free compute.

**Databricks wins** on event-time streaming correctness, the ML lifecycle, fine-grained governance,
open-format portability, and engineering-shaped teams.

**Coexistence is usually right:** Databricks as the engineering and ML platform writing Delta, Unity
Catalog mirrored or shortcut into OneLake, Fabric as the serving and self-service layer with Direct
Lake. Two platforms is a real cost — contract, landing zone, identity, skills — so a meter can win
individual workloads and still lose the estate. See [Databricks](./databricks-platform.md).

---

# Section 7 — Synapse → Fabric migration

| Synapse component | Fabric target | The catch |
|---|---|---|
| Dedicated SQL pool | **Warehouse** | Not lift-and-shift: T-SQL surface differences **⚠ verify**; distribution and index concepts disappear |
| Serverless SQL pool views | **Lakehouse SQL endpoint** or Warehouse | Endpoint is read-only; anything that wrote needs rehoming |
| Synapse Spark notebooks | **Fabric notebooks / Lakehouse** | Closest to lift-and-shift; check runtime and library versions |
| Synapse pipelines | **Fabric pipelines** | Broadly compatible; on-prem sources need the gateway story |
| Linked services / IR | Connections, on-prem data gateway | Rework, not migration |
| ADLS Gen2 storage | **Shortcut it, do not copy it** | The cheapest step is the one where no data moves |

Synapse has an announced end-of-support trajectory with Fabric as successor **⚠ verify dates**.

**Migration approach:** assess per workload, migrate in waves, prove parity before each cutover with a
gate that can block it, keep a decommission ledger, and leave a workload where it is when nothing
survives its constraints.

---

# Section 8 — Platform engineering on Fabric

- **Git integration** — a workspace binds to an Azure DevOps or GitHub repo; items serialise to files.
- **Deployment pipelines** — dev → test → prod workspace stages with deployment rules.
- **REST APIs and the `fab` CLI.**
- **Terraform provider** **⚠ verify status**; the capacity itself is an Azure resource
  (`Microsoft.Fabric/capacities`, Bicep), while workspaces are not.
- **Workspace identity** — a managed identity for trusted access to storage behind firewalls.
- **Domains** — a tenant-level grouping of workspaces; the data-mesh-shaped governance unit.
- **Security layers** — tenant settings, capacity settings, workspace roles (Admin / Member /
  Contributor / Viewer), item permissions, **OneLake data access roles** for folder-level RBAC, and
  Purview for sensitivity labels and DLP.

**The weakness to name:** Fabric's security model is **workspace-shaped**. Consistent row- and
column-level governance across Warehouse, Lakehouse, SQL endpoint and a Direct Lake semantic model is
materially harder than in Unity Catalog; Warehouse RLS is not automatically the semantic model's
security. Coming from a governed Databricks estate, that is the migration risk to raise.

---

# Section 9 — Review questions

**Lakehouse or Warehouse?** Write surface and transaction guarantees decide. Read-only T-SQL endpoint
on the Lakehouse; full DML and multi-table transactions in the Warehouse.

**How do you size a capacity?** Two allowances — whole estate and interactive — the binding one sets
the rung; never plan to the ceiling; then check the F64 consumer-licensing cliff.

**What happens when a capacity is over-consumed?** Bursting, then smoothing (minutes interactive,
24 h background), then throttling in stages: interactive delay, interactive rejection, background
rejection. Surge protection caps background usage.

**How do Fabric and an existing Databricks coexist?** Unity Catalog mirroring into OneLake, or
shortcuts to ADLS. Databricks stays the engine of record; Fabric serves.

**What is Direct Lake and when does it not work?** Direct read of Delta into VertiPaq, no refresh; it
falls back to DirectQuery beyond SKU guardrails or on unsupported constructs; performance depends on
table maintenance.

**First month on a Fabric estate?** Inventory and classify workloads by constraint; establish the
capacity baseline and what consumes it; put Git integration and deployment pipelines in place before
more items exist; run the smallest migration wave that proves the parity gate.
