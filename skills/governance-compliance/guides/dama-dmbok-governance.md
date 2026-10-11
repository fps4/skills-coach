---
title: DAMA-DMBOK and data governance
summary: The DAMA-DMBOK vocabulary for data management — the eleven knowledge areas, the distinctions people confuse, data-quality dimensions, metadata and lineage, and governance operating models.
---

## Frame

DAMA-DMBOK (Data Management Body of Knowledge, currently DMBOK2 with a Revised Edition) is the
*vocabulary standard* of the data-management profession. Most data architects don't read it cover to
cover; they need to (a) know the eleven knowledge areas, (b) speak the vocabulary fluently,
(c) distinguish data governance from data management, and (d) connect DMBOK terms to the work
actually happening.

Three mental models:

1. **DAMA names things; it doesn't solve things.** It gives a shared vocabulary for talking to other
   architects, auditors and regulators. The implementation choices (tools, patterns, processes) stay
   yours.
2. **Data governance is a *function*; data management is the *practice*.** Governance answers *who
   decides*; management answers *who does*. Mixing them up is the most common conversational error.
3. **The "Data Wheel" centres on Data Governance.** All other knowledge areas sit around it. This is
   intentional — DAMA's stance is that without governance, the other areas drift.

---

## 1. The eleven knowledge areas (the DAMA Wheel)

They appear in this order in DMBOK2's table of contents and on the Wheel diagram.

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

The most architecturally load-bearing are Data Architecture itself, Data Modeling, Reference & Master
Data, Metadata and lineage, and Data Quality. Security and Integration are pervasive concerns that cut
across the others.

---

## 2. Each area in one paragraph

### Data Governance (centre)
The *function* that authorises decisions about data — ownership, stewardship, policies, standards.
Embodied by councils, RACI matrices, policies. Distinct from data management, which executes the
decisions governance makes.

### Data Architecture
The *blueprint* of the enterprise data landscape — systems of record, integration patterns, reference
architectures, principles. The Data Architect role typically owns this area.

### Data Modeling & Design
Conceptual, logical and physical models. Dimensional, Data Vault, 3NF, document-oriented. The
discipline of representing business concepts as data structures.

### Data Storage & Operations
The DBA-world counterpart — database management, capacity, backup, recovery, performance. Less
architecturally interesting, but where SLAs live.

### Data Security
Access control, classification, masking, encryption, retention. Crosses every other area and meets
regulation such as SOX, GDPR and PCI DSS.

### Data Integration & Interoperability
Movement and transformation — ETL, ELT, streaming, federation, APIs. Where event-driven architecture
lives in DAMA's vocabulary.

### Document & Content Management
Unstructured data — documents, images, scans. Often outside the warehouse but increasingly relevant
(invoice OCR, contract management, audit evidence).

### Reference & Master Data
Reference = small, low-cardinality, slow-changing lookup data (country codes, currency codes, document
types). Master = high-value entities that need a single golden record (customer, vendor, product,
employee, partner, location). Different patterns apply to each.

### Data Warehousing & Business Intelligence
The consumption side — warehouses, marts, BI tools, dashboards, OLAP. Where the work is finally *seen*
by business users.

### Metadata
"Data about data." Three flavours: **business** (definitions, ownership), **technical** (schema,
lineage, profiling stats), **operational** (job runs, latencies, errors). Lineage lives here.

### Data Quality
The discipline of measuring and improving data fitness for use. Has specific *dimensions* (see §4).

---

## 3. The most-confused distinctions

### Master data vs reference data
- **Master data** = high-value entities — customer, vendor, product, employee, partner, location.
  Often crosses multiple operational systems and needs a *single golden record* (MDM).
- **Reference data** = controlled value lists — currency codes, country codes, document types, tax
  codes. Slow-changing, low-cardinality, often standardised externally (ISO codes).
- **Difference:** master is *about things in the world*; reference is *about how we categorise
  things*.

### Data governance vs data management
- **Governance** = decision rights, accountability, authority. *Who decides what's true.*
- **Management** = the execution. *Who does the work and how.*
- **Difference:** governance is policy and authority; management is operational discipline.

### Data steward vs data owner
- **Owner** = the accountable executive. Has authority, sets direction.
- **Steward** = the operational caretaker. Maintains quality, enforces standards day to day.
- **Difference:** owner = accountability; steward = responsibility.

### Data catalog vs metadata repository vs lineage tool
- **Catalog** = the human-facing discovery surface ("what data exists, what does it mean, who owns
  it").
- **Metadata repository** = the underlying storage of metadata.
- **Lineage tool** = the specific capability for tracing data movement (often part of a catalog).
- Modern tools (Atlan, Collibra, Alation, Microsoft Purview) bundle all three. See
  [Data governance, catalog and quality](./data-governance-catalog-quality.md) for the operational
  layer.

---

## 4. Data-quality dimensions

DMBOK names six core dimensions.

| Dimension | What it measures | Example |
|---|---|---|
| **Accuracy** | Correctness vs reality | Vendor address matches the actual address |
| **Completeness** | Presence of expected values | All required fields populated |
| **Consistency** | Same data agrees across systems | Customer name the same in CRM and ERP |
| **Timeliness** | Currency relative to when it's needed | Posting reflected in BI within 1 hour |
| **Uniqueness** | No unintended duplicates | One row per business key |
| **Validity** | Conformance to format/rules | VAT ID matches the country format |

(Some sources add **Integrity** — referential integrity across systems.)

Data quality isn't binary; it's measured across these dimensions. The architecture decision is which
dimensions matter for which dataset and at what SLA — and how the metrics are made observable.

---

## 5. Metadata and lineage

### Three flavours of metadata
1. **Business metadata** — definitions, ownership, stewardship, glossary terms, classification.
2. **Technical metadata** — schema, data types, source-to-target mappings, transformation logic,
   profiling stats.
3. **Operational metadata** — job runs, run-times, row counts, error counts, latencies, lineage at
   execution time.

### Lineage in practice
Two granularities:

- **Table-level lineage** — which tables feed which. Easy to capture (dbt does it automatically),
  valuable for impact analysis.
- **Column-level lineage** — which columns derive from which. Hard to capture (often needs SQL
  parsing or runtime instrumentation), critical for audit-grade answers such as "where did this
  reported figure come from?"

### OpenLineage
A cross-tool open standard for emitting lineage events. Adopted by Airflow, dbt, Spark, Flink,
Snowflake and others.

---

## 6. Governance operating models

### Centralised
A central data office decides policies, standards, ownership. Implementations are uniform but slower
and often resented by domains.

### Federated
A central office defines policies and standards; domains own their data and implement. The
data-mesh-friendly model.

### Hybrid (most common)
A central office for cross-cutting concerns (policies, standards, security, classification); domains
own their data; a coordination layer (council, guild, RACI) keeps them aligned.

For an organisation with several business units and regulatory exposure, federated governance with a
central council for cross-unit regulatory policies is the usual fit: pure centralisation doesn't scale
across units, and pure federation spreads regulatory exposure too thin.

---

## 7. Data mesh — the modern reading of DMBOK

Data mesh (Zhamak Dehghani, 2019) reframes data architecture around four principles:

1. **Domain-oriented ownership** — domains own their data, including the analytical side.
2. **Data as a product** — each dataset has an owner, SLA, schema, consumers, observability.
3. **Self-serve data infrastructure** — a central platform makes it cheap for domains to publish.
4. **Federated computational governance** — automated policy enforcement at the platform layer.

This maps cleanly to DMBOK vocabulary: federated governance + master-data discipline + metadata-rich
data products.

---

## 8. Certification: CDMP

DAMA's certification is **CDMP** (Certified Data Management Professional). Three levels: Associate,
Practitioner, Master. Based on the DMBOK2 Revised Edition. Study material: the DMBOK2 Revised Edition
itself as the definitive reference, plus published CDMP study guides and practice questions.

---

## 9. Working vocabulary

- **Federated governance** — preferred over "decentralised."
- **Golden record** — the output of MDM.
- **Data product** — any dataset with an owner, schema, SLA and consumers.
- **Data contract** — the agreement at the producer–consumer seam.
- **Column-grain lineage** — audit-grade traceability.
- **DQ dimensions** — rather than a vague "quality".
- **Steward vs owner**, **reference vs master** — never confuse these.

---

## 10. Adjacent frameworks

DMBOK is not the only framework in the room. **TOGAF** is an enterprise-architecture method; **DCAM**
is a capability-assessment model for data management. They complement DMBOK rather than compete with
it. DMBOK3 drafts are still in community development and not authoritative.
