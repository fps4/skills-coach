---
title: SAP commercial-data migration and trade promotion management
summary: What a migration design lead owns in an ECC-to-S/4HANA programme, the Migration Cockpit tooling, the commercial (SD) data model and what changes in it, and the trade-promotion and distributor systems around it.
---

> **Frame.** Companion to [SAP S/4HANA Finance and migration](./sap-s4hana-finance-and-migration.md),
> which covers the finance data model, the greenfield / brownfield / selective choice and SAP Activate.
> This guide covers what that one skips: the **commercial (SD) side** of the S/4 data model, the
> **migration tooling** a design lead reads designs against, the **design artefacts** the role
> produces, and two non-SAP systems a consumer-goods programme usually brings in — **trade promotion
> management (TPM)** on Salesforce and a **distributor management system (DMS)**.
>
> Register: enough to read a systems integrator's mapping specification critically and ask the right
> question in a workshop. Not enough to run a load — that is not the design lead's job.

## 1. What a migration design lead actually owns

The load tool belongs to the systems integrator (SI). The design lead owns the **decisions the tool
executes** and the **evidence that they were right**:

| Artefact | What it is | Who signs |
|---|---|---|
| **Object inventory** | Every migration object in scope, its source tables, target structure, business owner, load sequence and dependency | programme design authority |
| **Selection / scoping rules** | Which records migrate (e.g. customers with a document in the last 24 months; open sales orders only; no history) | business data owner |
| **Field-mapping specification** | Per target field: source table.field, rule type (direct · constant · value-map · derive · lookup/enrich · default), rule text, owner, status, version | design lead approves; owner + SI agree |
| **Value-mapping register** | Every code-list translation (company code, sales org, customer group, payment terms, condition type, unit of measure, country/region codes, BP grouping) with a **named owner and a sign-off state** | business owner per domain |
| **Data-quality / profiling report** | Fill rates, distinct values, patterns, duplicates, orphans, referential breaks — per object, before design freeze | design lead publishes |
| **Cleansing and enrichment rules** | What is fixed in source vs in flight vs after load; new S/4-mandatory fields and where their values come from | data owner + design lead |
| **Traceability matrix** | Business requirement → design rule → test case → validation result. Generated from the spec, not maintained by hand | design lead |
| **Validation criteria & reconciliation plan** | Per object: counts, control totals, grouped measures, sample checks, business sign-off criterion; tolerance policy **written before mock 1** | business owner accepts |
| **Mock-load plan** | Mock 1 (technical), mock 2 (business-validated), mock n, dress rehearsal, cutover; entry/exit criteria per mock | programme |
| **Defect log** | Root cause classified: design · data · tool · source system; design defects are the lead's queue | design lead drives closure |

The recurring failure modes, worth naming before they happen: value mappings with no owner; new
mandatory fields discovered at mock 2; duplicates in the customer master surfacing at CVI; custom
pricing access sequences nobody documented; "history" the business expected in the target and the
programme never scoped; the tolerance threshold negotiated *after* the comparison by whoever is most
tired.

A field-mapping specification kept as code — versioned, reviewed, and generating its own tests and
traceability — is the lightweight answer when a programme has no dedicated migration-governance tool.

## 2. Migration approaches — how the commercial data moves in each

| Approach | What happens to commercial data | Design-lead workload |
|---|---|---|
| **Greenfield** (new implementation) | Everything is *loaded*: master data + open items through the Migration Cockpit or an ETL tool. History stays behind (archive / warehouse) | highest — every object mapped from scratch, clean-slate value mappings |
| **Brownfield** (system conversion, SUM/DMO) | Data converted **in place**; no field mapping in the classic sense. The work is **pre-conversion harmonisation**: CVI, material number, rebates → settlement management, simplification-item checks | design decisions rather than mappings; heavy on data cleansing |
| **Selective data transition** ("bluefield", SNP CrystalBridge, SAP DMLT) | Selected company codes / time slices moved; a combination of conversion and load | both — plus the *selection* rules become the hard part |

A programme that names commercial *and* marketing data, a CRM, a DMS, TPM, mappings and enrichment
rules usually reads as greenfield or selective, with a parallel commercial-platform build. Ask which.

## 3. The tooling a design lead reads designs against

- **SAP S/4HANA Migration Cockpit** — the standard tool. Fiori app *Migrate Your Data* (the old `LTMC`
  transaction is superseded in current releases). Two ways in:
  - **Staging tables** — the cockpit creates a staging table per migration object in a HANA schema;
    they are filled from XML templates or, at scale, directly by an ETL tool (Data Services, or any
    tool that can write to the schema). The pattern for a large programme.
  - **Direct transfer** — reads directly from a connected SAP source (ECC → S/4) for selected objects,
    without files. Used in selective-transition shapes.
  - Predelivered **migration objects** (Business Partner / customer / supplier, material, pricing
    condition records, customer hierarchy, open sales orders, open AR/AP items, bank master, …).
  - **Value-mapping tasks**: for every code-list field the tool builds a source→target mapping that
    must be *confirmed* before simulation. This is where the value-mapping register lands; if the
    register is owned, the mapping tasks are a formality.
  - **Simulation → migration** per object, with instance-level error messages. Mock loads are runs of
    this.
- **Migration Object Modeler (`LTMOM`)** — adjusts predelivered objects (add custom fields, change
  structure) and defines **rules**: field-based and event-based rules, custom value mappings. A design
  that needs a Z-field on the customer master means an LTMOM change — so ask who owns the LTMOM
  object.
- **LSMW** — the ECC-era tool (batch input, direct input, BAPI, IDoc). Still present in on-premise S/4
  but unsupported for many S/4 objects and absent in cloud editions. If it is proposed for S/4 loads,
  that is a question, not a plan.
- **SAP Data Services (BODS)** + **Information Steward** — ETL with profiling and rapid-data-migration
  content; the classic pairing with the cockpit's staging tables on large programmes.
- **Third-party** — Syniti (Advanced Data Migration, strong on governance and traceability), SNP
  CrystalBridge (selective transition), Natuvion, Precisely. The artefacts in §1 are what Syniti-style
  tools try to productise.

## 4. The commercial (SD) data model — what changes ECC → S/4

**Business Partner and Customer-Vendor Integration (CVI).** In S/4 the **Business Partner
(`BUT000`)** is the master; `KNA1`/`LFA1` become synchronised views. Every customer needs a BP with
**roles** — `FLCU00` (FI customer) and `FLCU01` (SD customer); suppliers `FLVN00`/`FLVN01`. Design
decisions the lead owns: **BP grouping** and number ranges (keep the customer number as the BP number
or not), the **CVI mapping tables** (account groups → BP groupings/roles, industry, legal form), and
**de-duplication** — one legal entity that was three customers and two vendors in ECC becomes one BP
with several roles. CVI is mandatory *before* a brownfield conversion and is the first place
duplicates surface.

**Sales-area data.** Customer data has three layers: general (`KNA1`), company code (`KNB1`) and
**sales area** (`KNVV` — sales org / distribution channel / division), plus **partner functions**
(`KNVP`: sold-to, ship-to, bill-to, payer). Value mappings for sales areas are where global programmes
lose weeks: each country has its own org structure and the target is usually harmonised.

**Customer hierarchy.** Used for pricing and rebates (and heavily in consumer goods for trade terms).
A migration object exists; the design question is whether the target hierarchy is the ECC one or a
new commercial hierarchy defined by the CRM/TPM side.

**Pricing — condition technique.** Condition type → access sequence → condition tables (`A###`),
records in `KONH`/`KONP`. Unchanged in S/4, *but* custom condition tables and access sequences are the
classic undocumented item. Pricing **results** on documents moved from `KONV` to **`PRCD_ELEMENTS`**
(relevant only if open documents carry pricing). Migration object: *pricing condition (SD)*; expect
scoping rules by validity date.

**Rebates → Settlement Management.** Classic SD rebate processing (`VBO*` agreements) is **not
available** in S/4; it is replaced by **Settlement Management / condition contracts** (`WCOCO`). Open
rebate agreements do not migrate 1:1 — they are *redesigned*, and the accrued amounts need a cutover
decision. In consumer goods this overlaps with TPM (§5) and is a frequent design issue.

**Other simplifications worth naming:** material number extended to 40 characters; credit management
moved to FSCM; SD output management to BRF+; foreign trade to GTS; `MATDOC` for material documents.
Each has a **Simplification Item**, and the SI should have run the check.

**Open transactional data in scope:** open sales orders (`VBAK`/`VBAP`), open deliveries, open
billing, open AR items, contracts and scheduling agreements. Rule of thumb: **migrate open items, not
history**; history goes to the warehouse.

## 5. Trade promotion management (TPM) and Salesforce

**TPM in one paragraph.** A consumer-goods manufacturer plans promotions with each retail customer (a
temporary price reduction, a display, a feature), funds them from a **trade budget**, accrues the cost
(**off-invoice** discounts taken on the invoice vs **bill-back** claims paid later), settles the
**claims/deductions** the retailer sends, and measures **baseline vs uplift** afterwards — baseline is
what would have sold without the promotion, uplift the extra volume attributed to it. The data domains
are: customer/account **hierarchy** (account planning level), product hierarchy, price lists, **funds
and budgets**, promotion plans and **tactics**, accruals, claims and settlements, and
shipment/consumption baselines. Trade spend is often the second-largest cost line in consumer goods.

**SAP-side TPM:** historically SAP CRM Trade Promotion Management; now *SAP Trade Management* for
consumer products. A common target split instead puts planning in **Salesforce TPM** (Consumer Goods
Cloud) while SAP remains the system of record for customers, products, pricing and settlement — which
makes **SAP SD ↔ Salesforce TPM reconciliation** a standing job.

**Salesforce data model, minimum vocabulary:** `Account` (with parent hierarchy), `Contact`,
`Product2`, `Pricebook2` / `PricebookEntry`, `Opportunity`, custom objects; **External IDs** for
upsert-based loads (the source system's key, so a reload is idempotent); **Data Loader / Bulk API
2.0**; record types; duplicate and matching rules. Consumer Goods Cloud adds retail-execution and TPM
objects (accounts as retail stores, promotions, tactics, funds, budgets, account plans). Integration
is typically MuleSoft or another iPaaS with SAP as master — and the "who is master for what" table is
a design-lead artefact.

**The migration design questions TPM raises:** which customer hierarchy is master (SAP or Salesforce);
whether promotion **history** is migrated (baselines need it) or only open promotions and funds; how
open accruals and unsettled claims are cut over; how SAP condition records (off-invoice) and Salesforce
tactics stay consistent; product hierarchy alignment.

## 6. Distributor management systems (DMS)

In indirect markets (much of Africa, Asia, Latin America and parts of Eastern Europe for many
consumer-goods categories), the manufacturer sells to **distributors**, who sell to **outlets**. A DMS
captures **secondary sales** (distributor → outlet), **outlet master data**, distributor stock, and
promotion payouts / claims at distributor level. Data problems the design lead inherits: outlet
masters duplicated across distributors with different codes; manufacturer SKU vs distributor SKU
mapping; secondary-sales feeds with inconsistent units; promotion claims that must reconcile to SAP
settlements. In a migration this is usually **integration design with a master-data decision** (does
the outlet live in SAP as a BP, in Salesforce as an account, or only in the DMS?) rather than a load.

## 7. Say it cold

CVI and BP roles; `KNVV`/`KNVP`; condition technique and `PRCD_ELEMENTS`; rebates → settlement
management; staging tables vs direct transfer; `LTMOM` rules; why LSMW is a question; baseline vs
uplift; bill-back vs off-invoice; secondary sales.

Out of scope here: ABAP, configuration (SPRO), Fiori app extension, SAP Activate ceremonies beyond the
mock-load cadence, Salesforce administration.
