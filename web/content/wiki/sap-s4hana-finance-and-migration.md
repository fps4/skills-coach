---
title: SAP S/4HANA Finance & Migration Patterns — Architect Refresher
summary: The Universal Journal, the three migration approaches, and why an S/4 migration is a data-architecture problem wearing an ERP project's clothes.
topic: enterprise
format: refresher
tags: [sap, s4hana, acdoca, finance, erp, migration, greenfield, brownfield]
updated: 2026-08-07
---

## Frame

This is a refresher for an architect who already understands ERP and dimensional finance data, and has worked on the analytics side of an S/4HANA estate (GL/AR/AP/CO/AA). It is *not* a SAP functional-consultant guide. The goal: be able to (a) speak fluently to S/4HANA Finance with an SAP-side architect, and (b) reason about migration approaches and the data-architecture decisions inside each.

Three mental models to hold throughout:

1. **Universal Journal (ACDOCA) is the answer to "where's the truth?"** — S/4 merged FI, CO, AA, ML, and the rest into one line-item table. If a question about S/4 Finance data starts with "where does X live?", the first guess is ACDOCA.
2. **Migration is a data architecture problem dressed as a SAP project.** Cutover risk, harmonisation, custom-code re-platforming, interface re-pointing — all of these are decisions an architect of architects makes alongside the SAP-side lead.
3. **The "we'll figure it out post-go-live" school loses.** Public post-mortems of botched finance go-lives — delayed supplier and partner payments being the recurring symptom — read the same way every time. Reconciliation, dual-run and lineage are not bureaucracy; they are risk insurance, and the cost of skimping is asymmetric.

---

## 1. S/4HANA Finance — the model in one page

### The Universal Journal: ACDOCA
The single fact table for journal lines. Replaces (or supersedes by integration) the ECC-era separates:
- BSEG / BKPF — FI document line items / headers
- COEP — CO line items
- ANEP / ANEK — Asset Accounting line items
- MLIT / MLHD — Material Ledger line items
- FAGLFLEXA — New GL line items

ACDOCA typical width: 350–400+ columns. Grain: **one row per posting line, per ledger, per company code**. Multi-ledger by design (Leading 0L, parallel ledgers e.g. 2L for IFRS, 3L for local GAAP).

Why this matters for analytics:
- **You no longer reconcile FI vs CO** — same table, same grain.
- **You no longer reconcile GL vs sub-ledgers** at the line level (BSEG ↔ COEP is gone).
- **Parallel ledgers** live in the same table, distinguished by `RLDNR` (ledger ID).

### Periodic aggregates — ACDOCP / ACDOCT
- **ACDOCP** — plan data (was COSP/COSS/etc).
- **ACDOCT** — totals (less used downstream; analytics generally aggregates ACDOCA on demand).

### The classic Finance modules under S/4
- **FI-GL** — general ledger
- **FI-AR / FI-AP** — accounts receivable / payable (customer / vendor postings)
- **FI-AA** — asset accounting
- **CO-PA** — profitability analysis (margin reporting; in S/4 lives in "Account-Based CO-PA" on ACDOCA, replacing the costing-based parallel ledger)
- **CO-OM** — overhead management (cost centres, internal orders)
- **FI-FM** — funds management (rarely seen outside public sector)
- **NewGL was the bridge in ECC** — in S/4 the concept evolved into the Universal Journal model.

### Master data tables worth knowing by name
| Object | Table(s) | Notes |
|---|---|---|
| Chart of accounts / GL master | SKA1 (chart), SKB1 (company-code) | Sometimes consolidated in S/4 |
| Customer | KNA1 (general), KNB1 (company-code), BUT000 (BP) | S/4 uses **Business Partner (BP)** as the master — KNA1/LFA1 are now views |
| Vendor | LFA1 / LFB1 / BUT000 | Same — converged into BP |
| Cost centre | CSKS | Hierarchies in SETHEADER / SETLEAF |
| Profit centre | CEPC | |
| Material | MARA | |
| Company code | T001 | |
| Controlling area | TKA01 | |
| Document types | T003 | Defines doc-number-range, posting rules |

### CDS Views — the new virtual layer
SAP's "Virtual Data Model" (VDM). Two flavours that matter:
- **Basic / Composite / Consumption** views — the layered VDM. Composition is enforced by `@VDM.viewType` annotations.
- **Released views (`I_*`, `P_*`, `C_*`)** — SAP's promise that these are stable for customer use. Always prefer released over Z* CDS views you find.

Annotations that come up in data-architecture conversations:
```
@Analytics.dataExtraction.enabled: true            -- exposes via ODP / Replication Flow
@ObjectModel.changeDataCapture.enabled: true       -- CDC-eligible
@AccessControl.authorizationCheck: #CHECK           -- inherits S/4 authz
@VDM.viewType: #BASIC | #COMPOSITE | #CONSUMPTION
```

The combination of `dataExtraction.enabled + changeDataCapture.enabled` is what makes a view usable as a Replication Flow source into Datasphere / BDC / Kafka.

---

## 2. The migration approaches — name them, know the trade-offs

You'll be asked. Memorise the three families and their distinguishing question.

### Greenfield ("new implementation")
- Start fresh — new S/4 system, redesign processes, migrate only required master + open items.
- **When chosen:** legacy ECC is a mess, or business wants process re-engineering, or moving from non-SAP ERP.
- **Data architecture impact:** clean break enables a clean Universal Journal design, fresh chart of accounts, new hierarchies. But: no transactional history → analytics must dual-source (legacy + S/4) for years.
- **Identifier:** "we're starting over."

### Brownfield ("system conversion")
- In-place upgrade of existing ECC system to S/4. Same SID, same history, same custom code (initially).
- **When chosen:** existing implementation is solid, business wants minimal disruption, history preservation matters.
- **Data architecture impact:** ACDOCA built from existing BSEG/COEP via SAP's conversion tool. Custom code (Z*) often breaks against the new HANA-native primitives — needs remediation pass. Historical interfaces continue to point at the same SID.
- **Identifier:** "convert what we have, don't break anything."

### Selective Data Transition ("Bluefield" / "hybrid" / SAP Pathfinder)
- Cherry-pick what moves to S/4 — selected company codes first, or selected master + N years of history, or selected modules. Third-party tools heavy (SNP, Datavard/Syniti).
- **When chosen:** large multi-entity estate — multiple brands, multiple country rollouts. Can sequence the migration brand by brand.
- **Data architecture impact:** dual-run windows are real and need real architecture — analytics must federate across ECC + S/4 during the transition. Reconciliation between the two becomes the centre of the data architect's life. **This is the usual pattern for any large portfolio group**, precisely because a single big-bang across brands is unfinanceable in risk terms.
- **Identifier:** "we'll do it brand by brand / country by country."

### Central Finance (sFIN / FINS) — a *related but distinct* play
- Not a migration approach per se. It's a parallel S/4 instance that **replicates** finance postings from one or more source systems (ECC, non-SAP) via SLT, providing a single consolidated finance ledger without retiring the sources.
- **When chosen:** you want a fast consolidated reporting layer without doing the full migration first. Sometimes a stepping stone to full S/4 later.
- **Data architecture impact:** Central Finance becomes a system of *record* for consolidated reporting, but the operational sources still exist. You have two truths to reconcile *forever* unless you migrate the sources.
- **Identifier:** "we want consolidated finance reporting before we're ready to migrate."

### Reading which approach an estate has actually chosen
The approach is rarely stated outright, but it is easy to infer. Multi-entity portfolios almost always land on selective data transition sequenced entity by entity, because the alternatives price the risk badly at that size. The questions that settle it: which entity is leading, and at what phase? Those two answers determine the dual-run window, and the dual-run window determines most of the data architecture.

---

## 3. SAP Activate — the methodology shape

Six phases. You don't need to recite SAP's official artefacts, but you should be able to name where data architecture decisions land.

| Phase | What happens | Data architecture decisions |
|---|---|---|
| Discover | Business case, baseline | Define scope of analytics estate post-migration |
| Prepare | Project setup, governance | Decide migration approach (green/brown/selective) |
| Explore | Fit-to-standard workshops, gap analysis | Master data harmonisation strategy; chart of accounts decisions |
| Realize | Build, configure, data migration scripts | Build extraction pipelines, dual-run topology, reconciliation framework |
| Deploy | Cutover, go-live | Cutover gates, reconciliation freeze, lineage capture |
| Run | Hypercare, optimisation | Stabilise analytics, retire legacy feeds, post-go-live consolidation |

The "where data architecture sits" pattern: **biggest decisions in Prepare and Explore, biggest pain in Realize, biggest risk in Deploy.**

---

## 4. The data architect's checklist for any migration

Use this as a mental skeleton for any design-round question about migration:

1. **Chart of accounts harmonisation** — multiple legacy COAs collapsing into one? Mapping table is critical, becomes a forever artefact.
2. **Master data convergence** — Business Partner consolidation (KNA1 + LFA1 → BUT000). Duplicates, merge rules, golden record.
3. **Open items at cutover** — open AR/AP invoices, GL balances, asset balances. Migration is at a specific cutover date; everything else stays in legacy.
4. **Historical depth** — how many years of history move? Where does the rest live? Analytics needs to bridge.
5. **Custom code (Z*)** — every Z report, Z function, Z BAPI is a migration risk. Inventory + decision (rewrite / replace with standard / retire).
6. **Interface re-pointing** — every inbound and outbound feed. Often the long tail. Map old → new endpoints, schemas, SLAs.
7. **Authorization model** — S/4 roles are different from ECC. Architects co-design the analytics-side authz that mirrors.
8. **Reconciliation framework** — pre-cutover legacy-to-legacy, dual-run S/4-to-legacy, post-cutover trends. This is the architect's deliverable.
9. **Cutover plan** — what freezes when, who signs off each gate, fallback path. Dress rehearsals matter.
10. **Analytics continuity** — the dashboards finance and execs see *cannot* go dark during cutover. Architect the dual-source bridge.

A clean answer to "how would you design the data platform during an S/4 migration?" walks down a subset of this list, picking the three or four that the specific constraints make load-bearing.

---

## 5. The recurring failure mode

The public record on failed S/4HANA Finance go-lives is remarkably consistent. The pattern: external consultants drive the cutover, internal capability to diagnose and recover is thin, and the first visible symptom is payments to suppliers or partners arriving late. It is almost never a technical surprise — it is a reconciliation gate that was descoped under schedule pressure.

The architect's position, stated positively:

> *"On a multi-entity migration the job is to make the cutover boring — heavy investment up front in reconciliation gates, dual-run periods, and a rehearsed fallback path. The cost of skimping there is asymmetric: the saving is a few weeks, and the exposure is the finance close."*

Worth holding onto, because this is the one part of a migration where the architecture argument and the risk argument are the same argument.

---

## 6. Practice / output

By end of week 1, produce a one-pager:

> **S/4HANA Migration — Approach Selection & Data-Architecture Decisions**
>
> Sections: (1) Greenfield vs Brownfield vs Selective Data Transition vs Central Finance — when each fits; (2) The 10-point data architect's checklist; (3) The reconciliation framework template I'd propose on day 1.

Keep it under 800 words, scannable in 5 minutes, usable as a private interview reference.

---

## 7. Things to skip (for now)

- Deep ABAP — you're not the SAP-side developer.
- S/4 functional configuration (FI Customising, document number ranges, posting keys) — same.
- HANA tuning at the storage layer — relevant if you ever own HANA itself, not for this role.
- Embedded Analytics deep-dive (KPIs, SAC stories from CDS) — covered lightly in the Datasphere/BDC primer.

---

