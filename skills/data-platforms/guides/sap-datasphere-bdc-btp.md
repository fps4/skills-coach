---
title: SAP Datasphere, BDC and BTP — Architect Primer
summary: The SAP data stack in plain English — RISE, BTP, Datasphere, Business Data Cloud, SAC and HANA — with three reference integration patterns and the current extraction options.
---

## Frame

Enough of the SAP data stack to discuss "Datasphere vs Snowflake in our estate" without faking
expertise. Two structural ideas first, before the product names:

1. **SAP sells a stack, not a tool.** RISE = the bundle (infrastructure + S/4 + services). BTP = the
   extension platform. BDC = the data layer. SAC = the consumption layer. The story is "all SAP, all
   integrated, predictable bill." Customers without strong opinions buy in; customers with a strong
   Snowflake or Databricks investment federate.
2. **In multi-cloud, lakehouse-led estates, SAP's data products are a *source* to the non-SAP lake,
   not the destination.** Datasphere and BDC become federation surfaces over SAP; the gold layer lives
   in Snowflake or Databricks.

---

## 1. The product landscape

### SAP RISE
- **What it is:** SAP's bundled subscription — S/4HANA Cloud + hyperscaler infrastructure (Azure, AWS,
  GCP) + technical managed services (basis, OS patching, DR) + some BTP credits.
- **What it is not:** a product. It is the *commercial wrapper*.
- **Implication:** a RISE customer runs no basis team; some technical choices (storage tier, region)
  are constrained; the hyperscaler still matters for integration (egress, network routing).

### SAP BTP (Business Technology Platform)
- **What it is:** SAP's extension platform — runtimes (Cloud Foundry, Kyma), services (Integration
  Suite, Event Mesh, Workflow, Build Apps, AI Core) and connectors.
- **What it is for:** **side-by-side extensions** — custom logic that consumes S/4 over the network
  instead of modifying the S/4 core. Datasphere, BDC and SAC also run on BTP.

### SAP Datasphere
- **What it is:** SAP's cloud data-warehousing product, renamed from Data Warehouse Cloud in 2023.
- **What it does:** modelling (graphical + SQL), virtualisation and replication from S/4 and non-SAP
  sources, a business/semantic layer, governance.
- **Core concepts:** **Spaces** (subdivisions of a tenant with their own objects, connections and
  storage), **local vs remote tables** (persisted vs virtual), **Data Builder** (technical modelling),
  **Business Builder** (semantic / analytic layer), **Analytic Models**, **Replication Flows** (CDC
  landing of SAP data).
- **Non-SAP integration:** federates with Snowflake, BigQuery, Databricks, GCS and S3 in both
  directions.

### SAP Business Data Cloud (BDC)
- **What it is:** SAP's 2025 data layer: "SAP and non-SAP data together with business context."
- **What it does:** sits on Datasphere with **Databricks as the lakehouse engine underneath**, and adds
  SAP-curated **data products** for Finance, Procurement, HR and Supply Chain, pre-modelled and
  pre-mapped to S/4.
- **Why it exists:** SAP's answer to customers building lakehouses outside SAP.
- **Implication:** a "BDC + Databricks" customer may be consuming Databricks as an SAP-managed service
  rather than running their own workspace — worth clarifying.

### SAP Analytics Cloud (SAC)
- **What it is:** SAP's BI and planning tool.
- **Live connection** to HANA / Datasphere — no data movement, real time, constrained modelling.
- **Import connection** — data copied into SAC's in-memory store; flexible, but stale.
- Non-SAP BI tools (Tableau, Power BI and others) usually federate over Datasphere as a SQL endpoint.

### SAP HANA
- SAP's in-memory column-store database, the engine under S/4, BW/4 and Datasphere.
- **HANA in S/4** — the transactional store under the ERP, optimised for OLTP plus operational
  analytics on the same data.
- **HANA Cloud** — the standalone engine under Datasphere and many BTP services.
- Consumed via SQL or CDS views. Do not conflate operational HANA with analytical HANA.

---

## 2. Three reference integration patterns

### Pattern A — SAP-native end to end
```
S/4HANA ─(CDS + Replication Flow)─▶ Datasphere ─▶ BDC ─▶ SAC
                                                     │
                                                     └─▶ Databricks (under BDC)
```
- **When:** SAP-committed shop, RISE customer, finance-led analytics.
- **Strengths:** governance and business semantics included, no integration build.
- **Weaknesses:** vendor concentration, steeply scaling cost, non-SAP data second-class.

### Pattern B — SAP-sourced, lakehouse-led
```
S/4HANA ─(CDC-enabled CDS)─┐
                            ├─▶ Replication Flow ─▶ Kafka ─▶ Snowflake/Iceberg ─▶ dbt ─▶ BI
ECC / non-SAP ──────────────┘
                                         Datasphere: federation surface for SAP-side exploration only
```
- **When:** multi-source estate with a strong existing lakehouse investment.
- **Strengths:** a single gold layer, a single semantic model, non-SAP data first-class.
- **Weaknesses:** you own the contract between S/4 and the lakehouse; reconciliation is your problem.

### Pattern C — Hybrid with BDC as a data-product surface
```
S/4HANA ─▶ BDC (data products) ─┬─▶ SAC for finance-native consumers
                                 └─▶ Snowflake/Databricks via federation for data science / BI

Non-SAP ─▶ Snowflake/Databricks ─▶ Datasphere federation back to SAC
```
- **When:** the customer wants SAP's pre-modelled data products but already has a lakehouse.
- **Strengths:** less integration build than Pattern B; SAC consumers stay served.
- **Weaknesses:** newer, fewer reference customers, evolving pricing.

---

## 3. Replication Flow vs older extraction options

| Mechanism | Current? | When |
|---|---|---|
| **Replication Flow** (Datasphere / BDC) | Yes | CDC-enabled CDS views → Datasphere/BDC and onward; near real time |
| **ODP (Operational Data Provisioning)** | Yes | The older framework underneath Replication Flow |
| **SLT (System Landscape Transformation)** | Yes | Real-time table-level replication via DB triggers; common for Central Finance |
| **BW/4HANA extractors** | Legacy | Still works; rarely chosen for greenfield |
| **SAP Data Services** | Legacy | Old ETL; replaced by Datasphere flows |
| **Direct SQL on HANA** | Conditional | Bypasses business semantics and authorisation |
| **OData APIs from S/4** | Yes | Synchronous, low-volume; rarely the answer for analytics |

For an analytics integration today, Replication Flow on CDC-enabled CDS views is the SAP-supported
answer. See [Snowflake](./snowflake-platform.md) (Section 6) for the routes into Snowflake.

---

## 4. Key vocabulary

- **Universal Journal (ACDOCA)** — S/4's single line-item table for finance and controlling postings.
- **CDC-enabled CDS views** — the extraction source for Replication Flows.
- **Released views (`I_*`, `P_*`, `C_*`)** — interface, private and consumption CDS views; the stable,
  SAP-supported surface to consume instead of raw tables.
- **BDC data products** — SAP's pre-modelled packaging of business objects.
- **Side-by-side extension** — custom logic on BTP, outside the S/4 core.
- **Federation vs replication** — query SAP data in place (fresh, no copy, bounded by the source) or
  copy it via CDC (owned, joinable, a contract to maintain). SAP is now strong on federation.

---

## 5. Things that trip people up

- **Datasphere is not the database** — it is modelling and governance on top of HANA Cloud. You model
  data in Datasphere over HANA Cloud.
- **BDC ≠ Datasphere** — BDC is a layer above (data products, business context, a Databricks engine)
  and depends on Datasphere as the SAP-side modelling surface.
- **Live SAC ≠ federated query** — a live connection passes a single query each time, with its own
  constraints; it is not a general federation engine.
- **RISE is not S/4HANA Cloud** — RISE is the commercial bundle; S/4HANA Cloud is the product, and can
  run without RISE.
- **HANA in S/4 vs HANA Cloud** — different deployment, tuning and consumption patterns.
