---
title: DAMA-DMBOK & Governance — Architect Refresher
summary: The eleven knowledge areas, governance vs management, the six DQ dimensions, and how Data Mesh reads against the canonical vocabulary.
topic: governance
format: refresher
tags: [dama, dmbok, governance, data-quality, mdm, metadata, data-mesh]
updated: 2026-08-07
---

## Frame

DAMA-DMBOK (Data Management Body of Knowledge, currently DMBOK2 with a Revised Edition) is the *vocabulary standard* of the data-management profession. Most data architects don't read it cover-to-cover; they need to (a) know the 11 knowledge areas, (b) speak the vocabulary fluently, (c) distinguish data governance from data management, and (d) connect DMBOK terms to the work actually happening.

The goal of this guide: be conversational in DAMA terms within hours, so that *"how do you think about data quality dimensions?"* or *"what's your approach to master data?"* gets answered in the right vocabulary rather than an improvised one.

Three mental models:

1. **DAMA names things; it doesn't solve things.** It gives you a shared vocabulary to talk to other architects, auditors, and regulators. The actual implementation choices (tools, patterns, processes) are yours.
2. **Data governance is a *function*; data management is the *practice*.** Governance answers *who decides*; management answers *who does*. Mixing them up is the most common conversational error.
3. **The "Data Wheel" centres on Data Governance.** All other knowledge areas sit around it. This is intentional — DAMA's stance is that without governance, the other areas drift.

---

## 1. The 11 knowledge areas (the DAMA Wheel)

Memorise these in order. They appear in DMBOK2's table of contents and on the iconic Wheel diagram.

1. **Data Governance** *(centre of the wheel)*
2. **Data Architecture**
3. **Data Modeling & Design**
4. **Data Storage & Operations**
5. **Data Security**
6. **Data Integration & Interoperability**
7. **Document & Content Management**
8. **Reference & Master Data**
9. **Data Warehousing & Business Intelligence**
10. **Metadata**
11. **Data Quality**

A 30-second summary worth being able to give from memory:
> *"DMBOK organises data management into eleven knowledge areas around a central function — Data Governance. The most architecturally load-bearing for a finance estate are Data Architecture itself, Data Modeling, Master & Reference Data, Metadata and lineage, and Data Quality. Security and Integration are pervasive concerns that cut across the others."*

---

## 2. Each area in one paragraph

### Data Governance (centre)
The *function* that authorises decisions about data — ownership, stewardship, policies, standards. Embodied by councils, RACI matrices, policies. Distinct from data management, which executes the decisions governance makes.

### Data Architecture
The *blueprint* of the enterprise data landscape — systems of record, integration patterns, reference architectures, principles. The "Data Architect" role typically owns this area.

### Data Modeling & Design
Conceptual, logical, and physical models. Dimensional, Data Vault, 3NF, document-oriented. The discipline of representing business concepts as data structures.

### Data Storage & Operations
The DBA-world counterpart — database management, capacity, backup, recovery, performance. Less architecturally interesting but where SLAs live.

### Data Security
Access control, classification, masking, encryption, retention. Crosses every other area. In finance, intersects with SOX, GDPR, PCI.

### Data Integration & Interoperability
Movement and transformation — ETL, ELT, streaming, federation, APIs. Where event-driven architecture lives in DAMA's vocabulary.

### Document & Content Management
Unstructured data — documents, images, scans. Often outside the warehouse but increasingly relevant (invoice OCR, contract management, audit evidence).

### Reference & Master Data
Reference = small, low-cardinality, slow-changing lookup data (country codes, currency codes, doc types). Master = high-value entities that need a single golden record (customer, vendor, product, employee, partner, location). Different patterns apply to each.

### Data Warehousing & Business Intelligence
The consumption side — warehouses, marts, BI tools, dashboards, OLAP. Where the work is finally *seen* by business users.

### Metadata
"Data about data." Three flavours: **business** (definitions, ownership), **technical** (schema, lineage, profiling stats), **operational** (job runs, latencies, errors). Lineage lives here.

### Data Quality
The discipline of measuring and improving data fitness for use. Has specific *dimensions* (see §4).

---

## 3. The most-confused distinctions

### Master Data vs Reference Data
- **Master data** = high-value entities — customer, vendor, product, employee, partner, location. Often crosses multiple operational systems and needs a *single golden record* (MDM).
- **Reference data** = controlled value lists — currency codes, country codes, doc types, tax codes. Slow-changing, low-cardinality, often standardised externally (ISO codes).
- **Difference:** master is *about things in the world*; reference is *about how we categorise things*.

### Data Governance vs Data Management
- **Governance** = decision rights, accountability, authority. *Who decides what's true.*
- **Management** = the execution. *Who does the work and how.*
- **Difference:** governance is policy and authority; management is operational discipline.

### Data Steward vs Data Owner
- **Owner** = the accountable executive. Has authority, sets direction.
- **Steward** = the operational caretaker. Maintains quality, enforces standards day-to-day.
- **Difference:** owner = accountability; steward = responsibility.

### Data Catalog vs Metadata Repository vs Lineage Tool
- **Catalog** = the human-facing discovery surface ("what data exists, what does it mean, who owns it").
- **Metadata Repository** = the underlying storage of metadata.
- **Lineage Tool** = the specific capability for tracing data movement (often part of a catalog).
- Modern tools (Atlan, Collibra, Alation, Microsoft Purview) bundle all three.

---

## 4. Data Quality dimensions

DMBOK names six core dimensions. Know them by name.

| Dimension | What it measures | Example |
|---|---|---|
| **Accuracy** | Correctness vs reality | Vendor address matches actual address |
| **Completeness** | Presence of expected values | All required fields populated |
| **Consistency** | Same data agrees across systems | Customer name same in CRM and S/4 |
| **Timeliness** | Currency relative to when it's needed | Posting reflected in BI within 1 hour |
| **Uniqueness** | No unintended duplicates | One row per business key |
| **Validity** | Conformance to format/rules | VAT ID matches country format |

(Some sources add **Integrity** — referential integrity across systems.)

**Architect's framing:** *"Data quality isn't a binary; it's measured across these dimensions. The architecture decision is which dimensions matter for which dataset and at what SLA — and how we make the metrics observable."*

---

## 5. Metadata + Lineage — where architects spend the most time

### Three flavours of metadata
1. **Business metadata** — definitions, ownership, stewardship, glossary terms, classification.
2. **Technical metadata** — schema, data types, source-to-target mappings, transformation logic, profiling stats.
3. **Operational metadata** — job runs, run-times, row counts, error counts, latencies, lineage at execution time.

### Lineage in practice
Two granularities:

- **Table-level lineage** — which tables feed which. Easy to capture (dbt does it automatically), valuable for impact analysis.
- **Column-level lineage** — which columns derive from which. Hard to capture (often needs SQL parsing or runtime instrumentation), critical for SOX-grade audit responses.

**Architect's framing:** *"Table-level lineage is table stakes; column-level lineage is what auditors actually need when they ask 'where did this 10-K figure come from?'"*

### OpenLineage
Cross-tool open standard for emitting lineage events. Increasingly adopted by Airflow, dbt, Spark, Flink, Snowflake. Worth name-dropping.

---

## 6. Governance models — what an architect actually proposes

Three operating models. Know them; pick one when asked.

### Centralised
A central data office decides policies, standards, ownership. Implementations are uniform but slower and often resented by domains.

### Federated
Central office defines policies and standards; domains own their data and implement. The "Data Mesh"-friendly model.

### Hybrid (most common)
Central office for cross-cutting concerns (policies, standards, security, classification); domains own their data; a coordination layer (council, guild, RACI) keeps them aligned.

**Architect's framing for a multi-brand group:** *"At brand-portfolio shape, federated governance with a central council for cross-brand regulatory policies (DAC7, ViDA, SOX, GDPR) is the natural fit. Pure-centralised won't scale across brands; pure-federated leaves regulatory exposure too distributed."*

---

## 7. Data Mesh — the modern reading of DMBOK

Data Mesh (Zhamak Dehghani, 2019) reframes data architecture around four principles:

1. **Domain-oriented ownership** — domains own their data, including the analytical side.
2. **Data as a product** — each dataset has an owner, SLA, schema, consumers, observability.
3. **Self-serve data infrastructure** — central platform makes it cheap for domains to publish.
4. **Federated computational governance** — automated policy enforcement at the platform layer.

This maps cleanly to DMBOK vocabulary: federated governance + master data discipline + metadata-rich data products. **The overlap is worth naming explicitly** — Data Mesh is largely DMBOK's governance chapter restated for domain-owned platforms, and treating them as rival vocabularies wastes both.

---

## 8. The eleven areas on a real estate

Abstract knowledge areas get much easier to hold once they are anchored to a
concrete shape. Take a multi-brand group running SAP finance into a cloud
warehouse, under SOX and EU tax reporting — a common enough estate — and each
area acquires a specific problem:

| Area | What it concretely means here |
|---|---|
| Data Governance | Federated across brands with a central council for SOX, DAC7, ViDA, GDPR |
| Data Architecture | The ERP↔warehouse/lakehouse seam; multi-cloud; multi-brand consolidation |
| Modeling | Dimensional for marts; Data Vault for the integration layer of ERP-origin data |
| Storage & Ops | Cloud-warehouse-led, with a legacy on-prem Hadoop estate being retired |
| Security | Attribute-based access control on the warehouse; SSO for identity; PCI DSS for payments |
| Integration | Kafka for streaming; Airflow for batch orchestration |
| Document Mgmt | Partner contracts and invoices — OCR and ML, increasingly in scope |
| Reference & Master | The multi-brand partner master is *the* hard problem; tax reporting forces it |
| DW & BI | The cloud warehouse plus a BI layer; a vendor-native tool for ERP consumers |
| Metadata | Lineage is SOX-load-bearing; catalog choice follows from that, not the reverse |
| Data Quality | Reconciliation between the ERP and the warehouse is a continuous DQ task |

---

## 9. The CDMP path (optional)

DAMA's certification is **CDMP** (Certified Data Management Professional). Three levels: Associate, Practitioner, Master. Based on the DMBOK2 Revised Edition.

- **Worth it when:** you sit in or near a formal EA/governance function that values the credential. Conversational fluency — everything above — is what most architecture work actually needs.
- **Best study path:** Nicole Janeway's CDMP study guide + datastrategypros.com free practice questions + DMBOK2 Revised Edition itself for definitive reference.

---

## 10. Vocabulary

- *"Federated governance"* — preferred over "decentralised."
- *"Golden record"* — for MDM outputs.
- *"Data product"* — for any dataset with owner, schema, SLA, consumers.
- *"Data contract"* — for the agreement at the producer-consumer seam.
- *"Lineage at column-grain"* — when discussing audit-grade traceability.
- *"DQ dimensions"* — when discussing data quality (not just "quality").
- *"Steward vs owner"* — when role-clarifying.
- *"Reference vs master"* — never confuse these.

---

## 11. Practice / output

Five checks that this has landed. You should be able to:

1. **Recite the 11 knowledge areas** in 30 seconds.
2. **Distinguish master vs reference data** in one sentence each.
3. **Distinguish governance vs management** in one sentence.
4. **Name the 6 DQ dimensions** without looking.
5. **Sketch a federated governance model for a multi-brand portfolio** on a whiteboard in 60 seconds.

If you can do those five things, you are conversational in DAMA — which is what the vocabulary is for.

Optional output: a one-page cheat-sheet with the wheel, the six DQ dimensions, the master/reference distinction, and the federated-governance sketch.

---

## 12. Things to skip

- Deep CDMP exam prep — only if you are actually sitting the exam.
- DMBOK3 drafts — still in community development, not authoritative.
- Religious wars over DAMA vs other frameworks (TOGAF for EA, DCAM for capability assessment) — name them, don't enter them. You already have TOGAF certified; mention it complements DMBOK.

---

