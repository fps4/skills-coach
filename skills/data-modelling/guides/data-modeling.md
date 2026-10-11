---
title: Data modelling — levels, methodologies and tools
summary: The methodology-selection layer above Data Vault, dimensional and the rest — how to pick a model per layer and defend the choice.
---

## Frame

Data modelling is the discipline with no single right answer. A modeller who picks a methodology
because they were trained on it (Kimball from BI, 3NF from OLTP, Data Vault from a vault-led
project) produces the wrong estate as often as the right one. **Pick a methodology because the use
case demands it.**

This guide sits *above* the specific methodologies. It covers (a) the three levels of modelling,
(b) the methodology choices and their trade-offs, (c) the tool landscape, and (d) the anti-patterns
to call out in a review. Data Vault has its own guide: [Data Vault 2.0 with dbt](./data-vault-2-dbt.md).

Three mental models:

1. **Modelling is a series of *decisions*, not artefacts.** The diagram is a side effect of the
   decisions. Optimising for "a nice ERD" instead of "the right decisions" produces slow, fragile
   estates.
2. **The right model depends on the grain, the consumer, and the rate of change.** State the grain.
   Identify the consumer. Estimate the rate of change. Then pick.
3. **Most enterprise estates need several methodologies, layered.** Documents at the landing edge,
   Data Vault for integration, dimensional for marts, event schemas for streaming, wide tables for
   ML. The value is choosing the right one per layer and making them compose.

---

## 1. The three levels: conceptual, logical, physical

### Conceptual model
- **What it is:** business entities and relationships, in business language. No tables, columns,
  keys or platform.
- **Who reads it:** business stakeholders, sponsors, domain leads.
- **What it answers:** "What things exist in our business, and how do they relate?"
- **Notation:** boxes and lines, cardinalities in plain English ("a customer can have many
  orders"). Sometimes Chen-style ER diagrams; often whiteboard sketches.
- **Tooling:** whiteboard, Miro, draw.io, Lucid. Don't overinvest — the conversation is the artefact.

### Logical model
- **What it is:** entities → tables, attributes → columns, relationships → keys. Normalised (or
  methodology-shaped). Still platform-agnostic.
- **Who reads it:** data engineers, fellow architects.
- **What it answers:** "What structure supports the conceptual model, irrespective of where it runs?"
- **Notation:** Crow's Foot ER diagrams; sometimes UML class diagrams.
- **Tooling:** dbdiagram.io (text-as-code), SqlDBM, Sparx EA, ER/Studio, draw.io.

### Physical model
- **What it is:** the logical model on a specific platform — data types, clustering keys,
  partitioning, indexes, storage format, materialisation strategy.
- **Who reads it:** the team implementing it.
- **What it answers:** "How does this live on Snowflake / HANA / BigQuery / Iceberg, and how does it
  perform?"
- **Notation:** DDL in source control.
- **Tooling:** dbt models in version control, or migration tooling (Liquibase, Flyway).

### The discipline
Walk the levels in order. Don't jump from "we need a customer table" to `cluster_by(customer_id)`
without the conceptual step. The most common modelling failure: physical decisions made before the
conceptual model is settled.

---

## 2. The major methodologies

Know the distinguishing question for each.

### 3NF / Inmon ("Corporate Information Factory")
- **Distinguishing question:** "Will we need this data in many shapes, with strong referential
  integrity, over a long horizon?"
- **Shape:** highly normalised, no redundancy, every fact stored exactly once.
- **Strength:** integrity, storage efficiency, single source of truth at the integration layer.
- **Weakness:** slow for analytics (many joins), demanding to maintain, brittle to source change.
- **When chosen:** corporate warehouses with high quality demands and stable sources. Increasingly
  rare — Data Vault gives similar source agility with less rigidity.

### Kimball dimensional ("star schema")
- **Distinguishing question:** "Will analysts and BI tools consume this, where query speed and an
  intuitive shape matter most?"
- **Shape:** facts (events, measurements) + dimensions (descriptive context). Star or snowflake.
  Surrogate keys, conformed dimensions across marts.
- **Strength:** fast queries, intuitive, well understood, BI-friendly.
- **Weakness:** integration logic baked into the fact-load pipeline; brittle to source change;
  no full audit history without extra work.
- **When chosen:** almost always the right answer for the **marts layer**. The open question is what
  feeds the marts.

### Data Vault 2.0
- **Distinguishing question:** "Do we have many sources, do they change often, do auditors care, and
  does history matter?"
- **Shape:** hubs (business keys), links (relationships), satellites (attributes over time).
  Insert-only.
- **Strength:** source-system agility, audit-grade lineage, parallel loading.
- **Weakness:** verbose; reads need PIT/bridge tables; overkill for small estates.
- **When chosen:** the integration layer of large multi-source warehouses; ERP-anchored estates with
  a migration ahead; regulated financials. See [Data Vault 2.0 with dbt](./data-vault-2-dbt.md).

### One Big Table (OBT) / wide / denormalised
- **Distinguishing question:** "Is this consumed mostly by data science / ML, where joins are friction
  and one row per event is the natural shape?"
- **Shape:** a single very wide table, every relevant attribute denormalised onto each row.
- **Strength:** trivially queryable, ML-friendly; columnar warehouses make storage cheap and scans fast.
- **Weakness:** update anomalies, schema sprawl, ad-hoc history handling.
- **When chosen:** feature stores, log/event analytics, exploratory marts. Often right for the
  ML-facing layer; never a substitute for an integration layer.

### Activity schema / event-based
- **Distinguishing question:** "Is the business a stream of events about the same subjects, and do we
  need temporal analyses?"
- **Shape:** one wide table per subject ("customer activity stream"), one row per event, typed event
  attributes.
- **Strength:** unifies analytics, BI and ML around one grain; sequence analysis is trivial.
- **Weakness:** newer (popularised around 2020), less ecosystem support, needs discipline.
- **When chosen:** product and customer-journey analytics. Niche for finance.

### Document / semi-structured (JSON, Avro, Protobuf)
- **Distinguishing question:** "Does the structure vary per record, or come from event streams whose
  schemas evolve?"
- **Shape:** nested objects, arrays, polymorphic fields. Schema-on-read or schema-with-evolution.
- **Strength:** flexible, lossless preservation of source shape, evolution-friendly.
- **Weakness:** hard to query without flattening, no referential integrity, verbose queries.
- **When chosen:** event streams, API integration layers, audit logs. Almost always present at the
  **landing** layer.

---

## 3. Choosing a methodology — the decision matrix

| Question | If yes, reach for |
|---|---|
| Multiple source systems, frequent change, audit-heavy? | Data Vault for the integration layer |
| Marts feeding BI / analysts? | Kimball dimensional |
| Single source, high integrity, low change? | 3NF (rarely needed in modern estates) |
| ML / data science consumption? | OBT or activity schema |
| Event-stream landing? | Document / JSON / Avro |
| Streaming-first system? | Schema registry + event schemas + downstream materialisations |

Most enterprise estates need at least three of these in layers — JSON at the landing edge, Data
Vault for integration, dimensional for marts, OBT for ML. The skill is choosing per layer.

---

## 4. Modelling ERP-origin finance data — three patterns

### Pattern A — pass-through to dimensional
- **Shape:** ERP → landing (extracts) → dimensional marts directly.
- **Pros:** fast time-to-value, simple.
- **Cons:** integration logic in the mart layer; brittle to ERP changes; weak audit story; hard
  multi-source consolidation.
- **When:** small single-source estate, MVP phase.

### Pattern B — Data Vault integration, dimensional marts above
- **Shape:** ERP → landing → Raw Vault → Business Vault → dimensional marts.
- **Pros:** survives source migrations (e.g. SAP ECC → S/4HANA), audit-grade lineage, parallel
  sources handled cleanly.
- **Cons:** more upfront effort and storage; the team must be comfortable with vault patterns.
- **When:** multi-source, migration in flight, audit-exposed financials.

### Pattern C — activity stream for finance events
- **Shape:** postings + payment events + business events → one wide activity table per subject.
- **Pros:** strong for temporal analyses (cohort, journey, churn from finance data).
- **Cons:** novel in finance; auditors may push back; does not replace the general ledger.
- **When:** as an *additional* analytical surface, never as the system-of-record layer.

### The SAP-side primitive: ACDOCA
The S/4HANA Universal Journal is already star-leaning — fact-like rows with dimensional attributes.
It is tempting to consume it directly. Don't: the integration layer still has to harmonise across
sources and master data, and preserve history independently of how the ERP retires old data.

An example layered topology for such an estate:

```
ERP ─(CDC extracts)─▶ Kafka (Avro + Schema Registry)
                              │
                              ▼
                  Object storage / Iceberg (JSON / Avro landing)
                              │
                              ▼
                  Warehouse — Raw Vault (DV2.0)
                              │
                              ▼
                  Warehouse — Business Vault
                              │
                              ▼
                  Warehouse — dimensional marts
                              │
                              ▼
                  BI tools / data science (OBT)
```

---

## 5. Modelling streaming / event data

### Schema first
- **Define the event schema before writing the producer.** Avro / Protobuf / JSON Schema in a
  registry (Confluent Schema Registry, Apicurio).
- **Compatibility rules** — backward (consumers on the newest schema can read older messages; the
  safe default), forward (consumers on an older schema can read newer messages), full (both).

### Data contracts
Producers publish against a contract; consumers validate against it; a breaking change means a new
versioned topic, not a silent change.

### Materialisation
Event stream → continuous ingestion (Snowpipe, Kafka Connect, Auto Loader) → landing as JSON/Avro
records → modelled downstream in the warehouse's chosen methodology.

Streaming doesn't change the *target* model; it changes the *contract* between producer and
consumer. The downstream model still chooses between vault, dimensional and OBT on its own merits.

---

## 6. Modelling tools — the landscape

### Code-first / text-as-diagram
- **dbdiagram.io** — browser-based, DBML syntax; fast for sketching a logical model.
- **Mermaid ER diagrams** — Markdown-embedded, live in the repo, render in GitHub/GitLab.
- **PlantUML** — broader (UML class, sequence, C4) but also does ER.
- **SchemaSpy, tbls** — generate ERDs from existing schemas.

### GUI ER tools
- **SqlDBM** — online, Snowflake-aware, collaborative.
- **Lucidchart / draw.io / Miro / Excalidraw** — generic; good for conceptual diagrams.
- **DataGrip** — IDE with an ER view generated from a live database.

### Enterprise EA tools (heavy, expensive)
Sparx Enterprise Architect, ER/Studio, Erwin Data Modeler, SAP PowerDesigner — for large
enterprises with formal architecture functions.

### SAP-specific
HANA calculation views; SAP Datasphere Data Builder and Business Builder.

### Streaming / event modelling
- **Confluent Schema Registry**, **Apicurio Registry** — the hub for Avro/Protobuf/JSON schemas.
- **AsyncAPI** — documentation standard for event-driven APIs, rendered the way Swagger renders REST.

### Document / NoSQL
- **Hackolade** — multi-model (relational, JSON, GraphQL, Avro), for hybrid estates.
- **JSON Schema** — the canonical spec for JSON documents.

### A lightweight workflow
1. Whiteboard / Miro / Excalidraw for the conceptual sketch with stakeholders.
2. dbdiagram.io or Mermaid for the logical model, kept in the repo.
3. dbt models in version control for the physical model.
4. Generated lineage / ERD (dbt docs, SchemaSpy) for the current-state artefact.

---

## 7. Notations — Chen vs Crow's Foot vs UML

- **Chen** — entities as rectangles, relationships as diamonds, attributes as ovals. Verbose, mostly
  academic now.
- **Crow's Foot** — entities as boxes with attributes inline, relationship lines with multiplicities.
  The modern default that most tools draw.
- **UML class diagrams** — closer to OO; common for service-domain entities.

---

## 8. Modern patterns worth naming

- **Bronze / Silver / Gold** — the lakehouse medallion layers; the layered model in different clothes.
- **Iceberg / Delta / Hudi** — open table formats that give object storage warehouse-like behaviour.
  They change *where* the model lives, not the model.
- **Wide vs narrow** — columnar warehouses reward wide tables; storage of a 200-column table is no
  longer the cost driver it once was.
- **Slowly changing dimensions** — SCD2 in Kimball = dbt snapshots in dbt = effectivity / satellite
  history in Data Vault. Same problem, three idioms.
- **Schema-on-write vs schema-on-read** — validate and shape at store time, or store as delivered
  and impose structure at query time (the data-lake default).

---

## 9. Anti-patterns to call out in a review

- **Modelling the physical layer before the conceptual one is settled.** Reverse the order.
- **One methodology everywhere.** Vault-everywhere is as wrong as dimensional-everywhere.
- **Surrogate keys in operational / system-of-record tables.** They belong in the warehouse.
- **Grain not stated.** Grain ambiguity is the root cause of half of all warehouse bugs.
- **SCD2 columns in a mart when the source is already insert-only / an event stream.** Don't build
  complexity the data gives you for free.
- **JSON columns in the target layer when the data could be modelled relationally.** JSON is a
  landing-layer pattern, with exceptions for genuinely variable shapes.
- **The modelling tool as the deliverable.** A beautiful diagram nobody updates is worse than a
  scrappy whiteboard photo everyone trusts.

---

## 10. Out of scope here

- Notation debates (Chen vs IDEF1X vs Crow's Foot vs Bachman) — default to Crow's Foot.
- Tool wars (Erwin vs ER/Studio vs PowerDesigner).
- OLTP normalisation beyond 3NF.
- The full catalogue of dimensional patterns (junk, role-playing, factless facts) — name them when
  relevant; *The Data Warehouse Toolkit* has them all.
