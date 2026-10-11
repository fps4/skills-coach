---
title: SAP S/4HANA Finance and migration
summary: The Universal Journal and the finance data model of S/4HANA, the migration approaches and their trade-offs, and the data-architecture decisions inside a migration.
---

## Frame

A refresher for an architect who already knows ERP and dimensional finance data and wants to talk
fluently with an SAP-side architect about S/4HANA Finance — and to reason about migration approaches
and the data-architecture decisions inside each. It is not a functional-consultant guide.

Three mental models to hold throughout:

1. **The Universal Journal (ACDOCA) is the answer to "where is the truth?"** S/4 merged FI, CO, asset
   accounting, the material ledger and more into one line-item table. If a question about S/4 Finance
   data starts with "where does X live?", the first guess is ACDOCA.
2. **Migration is a data-architecture problem dressed as an SAP project.** Cutover risk,
   harmonisation, custom-code re-platforming and interface re-pointing are decisions an architect
   makes alongside the SAP-side lead.
3. **"We'll figure it out after go-live" loses.** Finance cutovers that skimp on reconciliation can
   end in delayed payments and public incidents. Reconciliation, dual-run and lineage are not
   bureaucracy — they are risk insurance, and the cost of skimping is asymmetric.

---

## 1. S/4HANA Finance — the model in one page

### The Universal Journal: ACDOCA

The single fact table for journal lines. It replaces (or supersedes by integration) the ECC-era
separate tables:

- BSEG / BKPF — FI document line items / headers
- COEP — CO line items
- ANEP / ANEK — asset accounting line items
- MLIT / MLHD — material ledger line items
- FAGLFLEXA — New GL line items

Typical width: 350–400+ columns. Grain: **one row per posting line, per ledger, per company code**.
Multi-ledger by design: the leading ledger 0L, plus parallel ledgers (e.g. 2L for IFRS, 3L for local
GAAP).

Why this matters for analytics:

- **FI and CO no longer need reconciling** — same table, same grain.
- **GL and sub-ledgers no longer need reconciling at line level** (BSEG ↔ COEP is gone).
- **Parallel ledgers live in the same table**, distinguished by `RLDNR` (ledger ID) — filter on it or
  you double-count.

### Plan and totals — ACDOCP / ACDOCT

- **ACDOCP** — plan data (formerly COSP/COSS and similar).
- **ACDOCT** — totals; rarely used downstream, since analytics aggregates ACDOCA on demand.

### The classic finance modules under S/4

- **FI-GL** — general ledger
- **FI-AR / FI-AP** — accounts receivable / payable (customer / vendor postings)
- **FI-AA** — asset accounting
- **CO-PA** — profitability analysis; in S/4, **account-based CO-PA** on ACDOCA replaces the
  costing-based approach with its separate parallel structure
- **CO-OM** — overhead management (cost centres, internal orders)
- **FI-FM** — funds management (rarely seen outside the public sector)
- **New GL** was the bridge in ECC; in S/4 the concept evolved into the Universal Journal.

### Master-data tables worth knowing by name

| Object | Table(s) | Notes |
|---|---|---|
| Chart of accounts / GL master | SKA1 (chart), SKB1 (company code) | |
| Customer | KNA1 (general), KNB1 (company code), BUT000 (BP) | S/4 uses the **Business Partner (BP)** as the master — KNA1/LFA1 are now views |
| Vendor | LFA1 / LFB1 / BUT000 | Same — converged into BP |
| Cost centre | CSKS | Hierarchies in SETHEADER / SETLEAF |
| Profit centre | CEPC | |
| Material | MARA | |
| Company code | T001 | |
| Controlling area | TKA01 | |
| Document types | T003 | Number ranges and posting rules |

### CDS views — the virtual layer

SAP's **Virtual Data Model (VDM)**. Two things matter:

- **Basic / composite / consumption** views — the layered VDM, enforced by `@VDM.viewType`
  annotations.
- **Released views (`I_*`, `P_*`, `C_*`)** — SAP's promise that these are stable for customer use.
  Prefer released views over custom Z* CDS views, which carry no such promise.

Annotations that come up in data-architecture conversations:

```
@Analytics.dataExtraction.enabled: true            -- exposes via ODP / Replication Flow
@ObjectModel.changeDataCapture.enabled: true       -- CDC-eligible
@AccessControl.authorizationCheck: #CHECK          -- inherits S/4 authorisation
@VDM.viewType: #BASIC | #COMPOSITE | #CONSUMPTION
```

`dataExtraction.enabled` together with `changeDataCapture.enabled` is what makes a view usable as a
Replication Flow source into Datasphere, Business Data Cloud or Kafka.

---

## 2. The migration approaches — name them, know the trade-offs

Three families and one related play, each with a distinguishing question.

### Greenfield ("new implementation")

- Start fresh: a new S/4 system, redesigned processes; migrate only required master data and open
  items.
- **When chosen:** the legacy ECC is a mess, the business wants process re-engineering, or the source
  is a non-SAP ERP.
- **Data-architecture impact:** a clean break allows a clean Universal Journal design, a fresh chart
  of accounts and new hierarchies. But there is no transactional history, so analytics must
  dual-source legacy and S/4 for years.
- **Identifier:** "we're starting over."

### Brownfield ("system conversion")

- An in-place upgrade of the existing ECC system to S/4: same SID, same history, same custom code
  (initially).
- **When chosen:** the existing implementation is solid, the business wants minimal disruption, and
  preserving history matters.
- **Data-architecture impact:** ACDOCA is built from the existing BSEG/COEP by SAP's conversion tool.
  Custom Z* code often breaks against the new HANA-native primitives and needs a remediation pass.
  Existing interfaces keep pointing at the same SID — and the old data quality comes along.
- **Identifier:** "convert what we have, don't break anything."

### Selective data transition ("bluefield")

- Cherry-pick what moves to S/4 — selected company codes first, or selected master data plus N years
  of history, or selected modules. Usually heavy on third-party tools (SNP, Syniti and similar).
- **When chosen:** a large multi-entity estate — multiple brands or country rollouts — that can
  sequence the migration in waves.
- **Data-architecture impact:** dual-run windows are real and need real architecture — analytics must
  federate across ECC and S/4 during the transition, and reconciliation between the two becomes the
  centre of the data architect's work.
- **Identifier:** "brand by brand, country by country."

### Central Finance — related but distinct

- Not a migration approach as such: a parallel S/4 instance that **replicates** finance postings from
  one or more source systems (ECC, non-SAP) via SLT, giving a single consolidated finance ledger
  without retiring the sources.
- **When chosen:** a fast consolidated reporting layer is wanted before the full migration.
  Sometimes a stepping stone to full S/4.
- **Data-architecture impact:** Central Finance becomes a system of record for consolidated
  reporting, but the operational sources still exist — two truths to reconcile until the sources
  migrate.
- **Identifier:** "we want consolidated finance reporting before we're ready to migrate."

Selective transition *moves* data into S/4 in waves; Central Finance only *mirrors* postings into a
reporting ledger while the sources remain the operational systems.

---

## 3. SAP Activate — the methodology shape

Six phases. The point is to know where data-architecture decisions land.

| Phase | What happens | Data-architecture decisions |
|---|---|---|
| Discover | Business case, baseline | Scope of the analytics estate after migration |
| Prepare | Project set-up, governance | Migration approach (green / brown / selective) |
| Explore | Fit-to-standard workshops, gap analysis | Master-data harmonisation strategy; chart-of-accounts decisions |
| Realize | Build, configure, migration scripts | Extraction pipelines, dual-run topology, reconciliation framework |
| Deploy | Cutover, go-live | Cutover gates, reconciliation freeze, lineage capture |
| Run | Hypercare, optimisation | Stabilise analytics, retire legacy feeds, post-go-live consolidation |

**Fit-to-standard** workshops fit the business to standard S/4 processes and record the gaps; that is
where master-data and chart-of-accounts decisions get made.

The pattern: **biggest decisions in Prepare and Explore, biggest pain in Realize, biggest risk in
Deploy.**

---

## 4. The data architect's checklist for any migration

A skeleton for any question about designing the data platform through an S/4 migration:

1. **Chart-of-accounts harmonisation** — several legacy charts collapsing into one? The mapping table
   is critical and becomes a permanent artefact.
2. **Master-data convergence** — Business Partner consolidation (KNA1 + LFA1 → BUT000): duplicates,
   merge rules, golden record.
3. **Open items at cutover** — open AR/AP invoices, GL balances, asset balances move as of a cutover
   date; everything else stays in legacy.
4. **Historical depth** — how many years of history move, and where the rest lives. Analytics has to
   bridge.
5. **Custom code (Z\*)** — every Z report, function and BAPI is a migration risk. Inventory and decide:
   rewrite, replace with standard, or retire.
6. **Interface re-pointing** — every inbound and outbound feed, mapped from old to new endpoints,
   schemas and SLAs. Usually the long tail.
7. **Authorisation model** — S/4 roles differ from ECC; the analytics-side authorisation that mirrors
   them is co-designed.
8. **Reconciliation framework** — legacy-to-legacy before cutover, S/4-to-legacy during dual-run,
   trend checks after. This is the data architect's own deliverable.
9. **Cutover plan** — what freezes when, who signs off each gate, the fallback path. Dress rehearsals
   matter.
10. **Analytics continuity** — finance and executive dashboards cannot go dark during cutover; design
    the dual-source bridge up front.

A good answer picks the three or four items the constraints make most important and goes deep on
those. The architect's job in a migration is to make the cutover boring: heavy up-front investment in
reconciliation gates, dual-run periods and a fallback path.

---

## 5. Out of scope here

- Deep ABAP and S/4 functional configuration (FI customising, number ranges, posting keys).
- HANA tuning at the storage layer.
- Embedded analytics in depth (KPIs, SAC stories built on CDS).

The commercial (SD) side of the data model and the migration tooling are covered in
[SAP commercial-data migration](./sap-commercial-data-migration-and-tpm.md).
