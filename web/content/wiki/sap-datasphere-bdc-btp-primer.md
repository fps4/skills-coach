---
title: SAP Datasphere, BDC & BTP-on-RISE — Architect Primer
summary: RISE, BTP, Datasphere, BDC and SAC in plain English, plus the three integration patterns for putting SAP data next to a non-SAP lakehouse.
topic: enterprise
format: primer
tags: [sap, datasphere, btp, rise, bdc, sac, hana, federation]
updated: 2026-08-07
---

## Frame

SAP's data products are usually a "nice to have" rather than a requirement on a data-architecture role — which makes **conversational, not certified** exactly the right depth. The goal of this primer is to handle a question like *"so how would you think about Datasphere vs Snowflake in our estate?"* without faking expertise and without freezing.

Two structural ideas to internalise first, before the product names:

1. **SAP wants to sell you a stack, not a tool.** RISE = the bundle (infrastructure + S/4 + services). BTP = the extension platform. BDC = the data layer. SAC = the consumption layer. The story is "all SAP, all integrated, predictable bill." Customers without strong opinions buy in; customers with strong opinions (Snowflake-led, Databricks-led) federate.
2. **In multi-cloud, warehouse-heavy estates, SAP's data products live as a *source* to the non-SAP lake, not the destination.** Datasphere and BDC become good federation surfaces over SAP; the gold layer lives in Snowflake or Databricks.

---

## 1. The product landscape in plain English

### SAP RISE
- **What it is:** SAP's bundled subscription — S/4HANA Cloud + the underlying infra (on a hyperscaler of choice: Azure, AWS, GCP) + technical managed services (basis, OS patching, DR) + some bundled BTP credits.
- **What it's not:** a product. It's the *commercial wrapper.*
- **Architect implication:** if a customer is "on RISE," they don't run their own basis team. Some technical choices (storage tier, region) are constrained. The hyperscaler dependency still matters for integration (egress costs, network routing).

### SAP BTP (Business Technology Platform)
- **What it is:** SAP's extension platform — runtimes (Cloud Foundry, Kyma), services (Integration Suite, Event Mesh, Workflow, Build Apps, AI Core), and connectors. The place where you build "side-by-side" extensions to S/4 without modifying the core.
- **What lives on it:** custom apps, integrations to non-SAP, tax engines, AI/ML services, **Datasphere**, **BDC**, **SAC**.
- **"BTP on RISE":** RISE customers often have BTP entitlements bundled. "BTP on RISE projects" usually means extension apps or integrations built on BTP that consume S/4 over the network.

### SAP Datasphere
- **What it is:** SAP's cloud data warehousing product. The rename of Data Warehouse Cloud (DWC) in 2023.
- **What it does:** modelling layer (graphical + SQL), virtualisation + replication from S/4 and non-SAP, business and semantic layer, governance.
- **Core concepts:** **Spaces** (tenant subdivision, like Snowflake databases-of-databases), **Local vs. Remote Tables**, **Data Builder** (technical modelling), **Business Builder** (semantic / analytic), **Analytic Models**, **Replication Flows** (the modern way to land SAP data via CDC).
- **Integration with non-SAP:** federates with Snowflake, BigQuery, Databricks, Google Cloud Storage, S3 — bidirectionally. You can expose Datasphere views to non-SAP and pull non-SAP into Datasphere.

### SAP BDC (Business Data Cloud)
- **What it is:** SAP's 2025 product. The marketing line: "a unified data foundation that brings SAP and non-SAP data together with built-in business context."
- **What it actually does:** sits on top of Datasphere + Databricks (yes — SAP partnered with Databricks; Databricks is the lakehouse engine under BDC). Adds "data products" curated by SAP for common business objects (Finance, Procurement, HR, Supply Chain), pre-modelled and pre-mapped to S/4 source.
- **Why it exists:** SAP's response to customers building their own lakehouses outside SAP. BDC is the "stay in our ecosystem" answer with native data products.
- **Architect implication:** **BDC ships with Databricks under the hood**. If a customer is "BDC + Databricks," they're not necessarily Databricks-the-customer in a multi-cloud sense — they may be consuming Databricks as a BDC managed service. Worth clarifying.

### SAP Analytics Cloud (SAC)
- **What it is:** SAP's consumption / BI tool — stories, dashboards, planning, predictive.
- **Two consumption modes:**
  - **Live connection** to HANA / Datasphere — no data movement, real-time, but joined modelling is constrained.
  - **Import connection** — data copied into SAC's in-memory store, more flexible, but stale.
- **Architect implication:** SAC is fine for SAP-native consumers. Non-SAP analytics tools (ThoughtSpot, Tableau, Power BI) usually federate over Datasphere as a SQL endpoint.

### SAP HANA (the database)
- **What it is:** SAP's in-memory column-store database. The engine under S/4, BW/4, Datasphere.
- **Two flavours that matter:**
  - **HANA in S/4** — the OLTP store under your S/4 system. Optimised for transactional + ad-hoc operational analytics on the same data.
  - **HANA Cloud (standalone)** — the engine under Datasphere and many BTP services.
- **Architect implication:** you generally consume HANA via SQL or via CDS views. Don't conflate operational HANA (under S/4) with analytical HANA (Datasphere).

---

## 2. The integration patterns you must be able to draw

Three reference architectures. Be able to whiteboard each in 60 seconds.

### Pattern A — SAP-native end-to-end
```
S/4HANA ─(CDS + Replication Flow)─▶ Datasphere ─▶ BDC ─▶ SAC
                                                     │
                                                     └─▶ Databricks (under BDC)
```
- **When chosen:** SAP-committed shop, RISE customer, finance-led analytics.
- **Strengths:** governance, business semantics included, no integration build.
- **Weaknesses:** vendor concentration, costs scale steeply, non-SAP data is a second-class citizen.

### Pattern B — SAP-sourced, lakehouse-led
```
S/4HANA ─(CDC-enabled CDS)─┐
                            ├─▶ Replication Flow ─▶ Kafka/Confluent ─▶ Snowflake/Iceberg ─▶ dbt ─▶ BI
ECC / non-SAP ──────────────┘
                                                                          ▲
                                                                          │
                                                                  Datasphere as federation
                                                                  surface for SAP-side
                                                                  exploration only
```
- **When chosen:** multi-source estate with strong lakehouse investment already made.
- **Strengths:** single gold layer, single semantic model in dbt, non-SAP first-class.
- **Weaknesses:** you own the contract between S/4 and the lakehouse; reconciliation is your problem.

### Pattern C — Hybrid with BDC as a data-product surface
```
S/4HANA ─▶ BDC (data products) ─┬─▶ SAC for finance-native consumers
                                 │
                                 └─▶ Snowflake/Databricks via federation for data-science / BI consumers

Non-SAP ─▶ Snowflake/Databricks ─▶ Datasphere federation back to SAC
```
- **When chosen:** customer wants SAP's pre-modelled data products but already has lakehouse investment.
- **Strengths:** less integration build than Pattern B; SAC stays happy.
- **Weaknesses:** newer, fewer reference customers; BDC pricing model is evolving.

### Which pattern you will usually meet
Pattern B, by a wide margin, in any organisation that has already committed to a non-SAP lakehouse. The interesting work is the bridge between the two, and it is usually under-designed. Proposing Pattern A into an estate with existing lakehouse investment is the classic mis-read: it asks the organisation to abandon a working gold layer to reduce vendor count.

---

## 3. Replication Flow vs older extraction options

SAP has shipped many extraction mechanisms over the years. You should know which is current and which is legacy.

| Mechanism | Current? | When |
|---|---|---|
| **Replication Flow** (Datasphere / BDC) | ✅ Yes, current | CDC-enabled CDS views → Datasphere/BDC; modern, real-time |
| **ODP (Operational Data Provisioning)** | ✅ Yes | Older but still supported framework underneath Replication Flow |
| **SLT (System Landscape Transformation)** | ✅ Yes | Real-time table-level replication via DB triggers; common for Central Finance |
| **BW/4HANA extractors** | Legacy | Still works; rarely chosen for greenfield |
| **SAP Data Services** | Legacy | Old ETL; replaced by Datasphere flows |
| **Direct SQL on HANA** | Conditional | Works in a pinch; bypasses business semantics + authz |
| **OData APIs from S/4** | Yes | Synchronous, low-volume; rarely the answer for analytics |

**For an analytics integration in 2026:** Replication Flow on CDC-enabled CDS views is the SAP-blessed answer. Mention this and you sound current.

---

## 4. Vocabulary

Phrases that signal you've done the reading:

- *"Universal Journal"* — never just "GL table." Always ACDOCA + the Universal Journal naming.
- *"CDC-enabled CDS"* — instead of "extracting from SAP."
- *"Replication Flow into Datasphere"* — instead of "the SAP feed."
- *"Released views (`I_*`, `P_*`, `C_*`)"* — when discussing what to consume.
- *"BDC data products"* — when discussing the new SAP packaging.
- *"BTP side-by-side extension"* — when discussing where custom logic lives without modifying the S/4 core.
- *"Federation vs replication"* — frame the trade-off explicitly; SAP is now strong on federation.

---

## 5. Things that trip people up

- **Datasphere is *not* the database** — it's modelling + governance on top of HANA Cloud. Don't say "store data in Datasphere"; say "model data in Datasphere over HANA Cloud."
- **BDC ≠ Datasphere** — BDC is a layer above (data products, business context, Databricks engine). They coexist; BDC depends on Datasphere as the modelling surface for SAP-side.
- **Live SAC ≠ federated query** — a live SAC connection passes a single query each time, with its own constraints. It's not a generic federation engine.
- **RISE is not S/4 Cloud** — RISE is the *commercial* bundle. S/4HANA Cloud is the product. You can have S/4HANA Cloud without RISE; RISE is the wrapping.
- **HANA in S/4 vs HANA Cloud** — different deployment, different tuning, different consumption patterns. Don't conflate.

---

## 6. Practice / output

Produce a half-page summary:

> **SAP Data Stack — How the Pieces Fit (and Where the Warehouse Lives)**
>
> Sections: (1) RISE / BTP / Datasphere / BDC / SAC / HANA — what each is in one line; (2) the three integration patterns with a one-line trade-off each; (3) why Pattern B is the usual landing point.

Keep it scannable, and memorise the three reference architectures well enough to sketch any of them from memory. Being able to draw the alternative you are *not* recommending is what makes the recommendation credible.

---

## 7. Things to skip

- BW/4HANA — legacy, mention only if asked.
- HANA modelling internals (calculation views, modeller, attribute views) — relevant only if you go SAP-deep.
- SAP IS-RA / industry solutions — out of scope.
- ABAP-on-BTP / RAP framework — extension developer territory, not architect.

---

