---
title: Data Modeling — Approach, Methodologies & Tools
summary: The methodology-selection layer above Data Vault and dimensional — the three modeling levels, the decision matrix, and how to defend a choice without dogma.
topic: data-engineering
format: refresher
tags: [data-modeling, kimball, data-vault, 3nf, erd, dimensional, sap]
updated: 2026-08-07
---

## Frame

Data modeling is the architect's most-tested discipline that *doesn't* have a single right answer. Junior modellers pick a methodology because they were trained on it (Kimball if they came up through BI; 3NF if they came from OLTP DBA-land; Data Vault if they came from a vault-led project). **Senior architects pick a methodology because the use case demands it.**

This guide sits *above* the specific methodologies — Data Vault 2.0, dimensional, etc. — that other guides cover in depth. The goal here: be fluent in (a) the three levels of modeling (conceptual → logical → physical), (b) the methodology choices and their trade-offs, (c) the tool landscape, and (d) how to defend a modeling choice on its merits rather than by training.

Three mental models to hold:

1. **Modeling is a series of *decisions*, not artefacts.** The diagram is a side effect of the decisions. Architects who optimise for "having a nice ERD" instead of "making the right decisions" produce slow, fragile estates.
2. **The right model depends on the grain, the consumer, and the rate of change.** Same three questions every time. State the grain. Identify the consumer. Estimate the rate of change. Then pick.
3. **Most enterprise estates need multiple methodologies layered.** DV2.0 for integration, dimensional for marts, document/JSON for unstructured boundary data, event schemas for streaming. The architect's value is choosing the right one per layer and making them compose.

---

## 1. The three levels: conceptual, logical, physical

The classic three-layer model, and the vocabulary almost every modeling conversation assumes.

### Conceptual model
- **What it is:** business entities and relationships, in business language. No tables, no columns, no keys, no platform.
- **Who reads it:** business stakeholders, sponsors, finance / domain leads.
- **What it answers:** "What things exist in our business, and how do they relate?"
- **Notation:** boxes + lines, names of things, cardinalities in plain English ("a customer can have many bookings"). Sometimes Chen-style ER diagrams; often just whiteboard sketches.
- **Tooling:** whiteboard, Miro, draw.io, Lucid. Don't overinvest in tooling here — the conversation is the artefact.

### Logical model
- **What it is:** entities → tables, attributes → columns, relationships → keys. Normalised (or methodology-shaped). Still platform-agnostic.
- **Who reads it:** data engineers, fellow architects.
- **What it answers:** "What's the data structure that supports the conceptual model, irrespective of where it runs?"
- **Notation:** Crow's Foot ER diagrams; for SAP-origin data, sometimes UML class diagrams.
- **Tooling:** dbdiagram.io (text-as-code), SqlDBM (Snowflake-aware), Sparx EA, ER/Studio, draw.io with ERD shape library.

### Physical model
- **What it is:** the logical model translated to a specific platform — data types, clustering keys, partitioning, indexes, storage format, materialisation strategy.
- **Who reads it:** the team implementing it.
- **What it answers:** "How does this actually live on Snowflake / HANA / BigQuery / Iceberg, and how does it perform?"
- **Notation:** DDL in source control.
- **Tooling:** dbt models in version control (the modern answer), or migration tooling (Liquibase, Flyway).

### The discipline
Walk the levels in order. Don't jump from "we need a customer table" to "let's add a `cluster_by(customer_id)`" without doing the conceptual step. The most common modelling failure mode: physical decisions made before the conceptual model is settled.

---

## 2. The major methodologies

Five families. Know the distinguishing question for each.

### 3NF / Inmon ("Corporate Information Factory")
- **Distinguishing question:** "Will we need this same data in many different shapes, with strong referential integrity, over a long horizon?"
- **Shape:** highly normalised, no redundancy, every fact stored exactly once.
- **Strength:** integrity, storage efficiency, single-source-of-truth at the integration layer.
- **Weakness:** slow for analytics (many joins), demanding to model and maintain, brittle to source-system change.
- **When chosen:** corporate-grade warehouses with high data-quality demands and stable sources. Increasingly rare in modern estates.
- **Architect signal:** *"In 2026 I'd reach for 3NF rarely — Data Vault gives you the same source-system agility with less rigidity."*

### Kimball dimensional ("Star schema")
- **Distinguishing question:** "Will this data be consumed by analysts and BI tools, where query speed and intuitive shape matter most?"
- **Shape:** facts (events / measurements) + dimensions (descriptive context). Star or snowflake. Surrogate keys, conformed dimensions across marts.
- **Strength:** fast queries, intuitive for analysts, well-understood, BI-tool-friendly.
- **Weakness:** integration logic baked into the fact-load pipeline; brittle to source-system change; doesn't preserve full audit history without extra work.
- **When chosen:** consumer-facing marts. Almost always the right answer for the **marts layer**.
- **Architect signal:** *"Dimensional is the right answer for marts. The question is what feeds the marts."*

### Data Vault 2.0
- **Distinguishing question:** "Do we have many sources, do they change often, do auditors care, and is history important?"
- **Shape:** hubs (business keys), links (relationships), satellites (attributes over time). Insert-only.
- **Strength:** source-system agility, audit-grade lineage, parallel-loadable.
- **Weakness:** verbose; reads require PIT/Bridge tables; overkill for small estates.
- **When chosen:** the integration layer of large multi-source warehouses; SAP-anchored estates with migration ahead; SOX-exposed financials.
- **Architect signal:** see the dedicated Data Vault guide.

### One Big Table / wide / denormalised
- **Distinguishing question:** "Is this data being consumed mostly by data science / ML, where joins are friction and one-row-per-event is the natural shape?"
- **Shape:** single very-wide table, every relevant attribute denormalised onto each row.
- **Strength:** trivially queryable, ML-friendly, columnar warehouses (Snowflake, BigQuery, Databricks) make storage cheap and query fast.
- **Weakness:** update anomalies, schema sprawl, history handling is ad-hoc.
- **When chosen:** ML feature stores, log/event analytics, exploratory data science marts. **Increasingly common at modern cloud-data shops.**
- **Architect signal:** *"OBT is often the right answer for the ML-facing consumer layer; it's not a substitute for an integration layer."*

### Activity Schema / event-based
- **Distinguishing question:** "Is the business fundamentally a stream of events about the same set of subjects (customers, partners), and do we need temporal analyses?"
- **Shape:** one wide table per subject ("customer activity stream") with one row per event, plus typed event attributes.
- **Strength:** unifies analytics, BI, and ML around a single grain; sequence analyses are trivial.
- **Weakness:** newer (Narrator.ai, ~2020 popularisation), less ecosystem support, requires discipline.
- **When chosen:** product analytics, customer journey analytics. Niche for finance.

### Document / semi-structured (JSON, Avro, Protobuf)
- **Distinguishing question:** "Does the data carry variable structure per record, or come from event streams where schemas evolve?"
- **Shape:** nested objects, arrays, polymorphic fields. Schema-on-read or schema-with-evolution.
- **Strength:** flexibility, lossless preservation of source shape, evolution-friendly.
- **Weakness:** hard to query without flattening, no referential integrity, queries get verbose (see SQL refresher §10).
- **When chosen:** event streams, API integration layers, audit logs. **Almost always present at the *landing* layer of a modern warehouse.**

---

## 3. Choosing a methodology — the decision matrix

| Question | If yes, reach for |
|---|---|
| Multiple source systems, frequent change, audit-heavy? | Data Vault for integration layer |
| Marts feeding BI / analysts? | Kimball dimensional |
| Single source, high integrity, low change? | 3NF (rarely needed in modern estates) |
| ML / data science consumption? | OBT or Activity Schema |
| Event-stream landing? | Document / JSON / Avro |
| Streaming-first system? | Schema registry + event schemas + downstream materialisations |

The honest architect's framing: *"Most enterprise estates need at least three of these in layers — JSON at the landing edge, Data Vault for integration, dimensional for marts, OBT for ML. The skill is choosing per layer."*

---

## 4. Modeling SAP-origin finance data — concrete patterns

ERP finance is the most instructive worked example, because all three patterns below are defensible and the choice between them is genuinely load-bearing.

### Pattern A — pass-through to dimensional
- **Shape:** S/4HANA → landing (CDS extracts) → dimensional marts directly.
- **Pros:** fast time-to-value, simple, low complexity.
- **Cons:** integration logic baked into the mart layer; brittle to S/4 changes; weak audit story; multi-source consolidation hard.
- **When:** small single-source estate, MVP phase, no parallel sources.

### Pattern B — Data Vault as integration layer, dimensional marts above
- **Shape:** S/4HANA → landing → Raw Vault → Business Vault → dimensional marts.
- **Pros:** source-agility (an ECC → S/4 migration mid-flight barely disturbs the marts), audit-grade lineage, parallel sources cleanly handled.
- **Cons:** more upfront effort, more storage, requires team comfort with vault patterns.
- **When:** **the usual right answer** for a multi-brand, multi-source, SOX-exposed estate — especially with a migration in flight.

### Pattern C — Activity stream for finance events
- **Shape:** S/4 postings + payment events + order events → a single wide activity table per subject (partner, brand, order).
- **Pros:** powerful for temporal analyses (cohort, customer-journey, churn-from-finance-data).
- **Cons:** novel pattern in finance; auditors may push back; doesn't replace the GL.
- **When:** as an *additional* analytical surface, never as a replacement for the system-of-record dimensional / vault layer.

### The SAP-side modeling primitive: ACDOCA
Universal Journal is already a star-leaning shape in S/4 — fact-like rows with dimensional attributes. Tempting to *consume directly* without modelling further. The architect's discipline: **don't.** Even when the source is friendly, the integration layer's job is to normalise across brands, harmonise master data, and preserve history independent of how SAP retires old data.

---

## 5. Modeling for streaming / event data

When the source isn't a database but a Kafka topic, modeling discipline shifts:

### The schema-first principle
- **Define the event schema before you write the producer.** Avro / Protobuf / JSON Schema in a registry (Confluent Schema Registry, Apicurio).
- **Schema evolution rules** — backward, forward, full compatibility. Backward (newest schema can read older messages) is the safe default.

### The data-contract pattern
Producer publishes against a contract; consumers validate against the contract; breaking changes require a versioned new topic, not a silent change.

### The materialisation pattern
Event stream → continuous ingestion (Snowpipe, Kafka Connect, Databricks Auto Loader) → **landing as JSON/Avro records** → modelled downstream into the warehouse's chosen methodology (vault, dimensional, OBT).

### Architect-level signal
*"Streaming data doesn't change the *target* model; it changes the *contract* between producer and consumer. The downstream warehouse model still chooses between vault / dimensional / OBT on its own merits."*

---

## 6. Modeling tools — the landscape

What's actually used, by category.

### Code-first / text-as-diagram (modern preference)
- **[dbdiagram.io](https://dbdiagram.io)** — free, browser-based, DBML syntax. Excellent for sketching a logical model fast.
- **[Mermaid ER diagrams](https://mermaid.js.org/syntax/entityRelationshipDiagram.html)** — Markdown-friendly, lives in your repo, renders in GitHub/GitLab.
- **[PlantUML](https://plantuml.com/)** — broader (UML class, sequence, C4) but also does ER.
- **dbt-erdantic, SchemaSpy, tbls** — auto-generate ERDs from existing schemas.

### GUI ER tools
- **SqlDBM** — online, Snowflake-aware, collaborative. Increasingly the cloud-data architect's choice.
- **Lucidchart / draw.io / Miro / Excalidraw** — generic but good for conceptual diagrams.
- **DataGrip** — JetBrains IDE; has a built-in ER view auto-generated from live database.

### Enterprise EA tools (heavy, expensive)
- **Sparx Enterprise Architect** — broad EA (TOGAF, UML, BPMN, ERD).
- **ER/Studio (IDERA)** — long-time ER specialist.
- **Erwin Data Modeler** — same lineage; common in large enterprises.
- **SAP PowerDesigner** — SAP's own; often present in SAP-heavy shops.

### SAP-specific
- **HANA Studio / Web IDE** — for HANA calc views and SAP-side modelling.
- **SAP Datasphere Data Builder + Business Builder** — modelling surfaces inside Datasphere.
- **SAP Solution Manager** — sometimes used for blueprint-level conceptual models.

### Streaming / event modelling
- **Confluent Schema Registry** — the hub for Avro/Protobuf/JSON schemas.
- **Apicurio Registry** — open-source schema registry.
- **AsyncAPI** — documentation standard for event-driven APIs (the AsyncAPI Studio renders schemas + topics like Swagger does for REST).

### Document / NoSQL
- **Hackolade** — multi-model (relational, JSON, GraphQL, Avro), good for hybrid estates.
- **JSON Schema** — the canonical spec for JSON documents.

### The architect's actual workflow (most days)
1. Whiteboard / Miro / Excalidraw for the conceptual sketch with stakeholders.
2. dbdiagram.io or Mermaid for a logical model captured in the repo.
3. dbt models in version control for the physical model — DDL effectively lives there.
4. Auto-generated lineage / ERD from dbt docs or SchemaSpy for the "current state" artefact.

The full-blown EA tools (Sparx, Erwin) are for large enterprises with formal EA functions; smaller estates run on the lighter stack above.

---

## 7. Notations — Chen vs Crow's Foot vs UML

You should be able to read all three; you'll write mostly Crow's Foot.

- **Chen notation** — entities as rectangles, relationships as diamonds, attributes as ovals. Verbose, mostly academic now.
- **Crow's Foot** — entities as boxes with attributes inline, relationships as lines with multiplicities ("crow's feet"). The modern default.
- **UML class diagrams** — closer to OO; common when modelling SAP-side or service-domain entities.

When in doubt: Crow's Foot. It's what dbdiagram.io / SqlDBM / DataGrip / Lucid all default to.

---

## 8. Modern patterns worth naming

### Lakehouse modeling
- **Bronze / Silver / Gold layers** — Databricks-popularised; the layered model in different clothes.
- **Iceberg / Delta / Hudi** — open table formats that enable lakehouse warehouse-like behaviour on object storage. They don't *change* the model; they change *where the model lives*.

### Wide vs narrow
- Snowflake / BigQuery / Databricks all reward wide tables more than narrow rows-style relational stores. **Storage of 200-column tables is no longer the cost driver it was in 2005.** Sometimes the "right" model is wider than your instincts expect.

### Slowly-changing dimensions revisited
- **SCD2** in Kimball-land = dbt snapshots in dbt-land = effectivity satellites in Data Vault land. Same problem, three idioms.

### Wide-event tables (Activity Schema variant)
- Sometimes called "skinny activity" — one event-stream-per-subject pattern that emphasises temporal sequencing.

---

## 9. Anti-patterns to call out in an architecture review

- **Modeling at the physical layer before the conceptual one is settled.** Reverse the order.
- **Pretending one methodology fits everywhere.** Vault-everywhere is as wrong as dimensional-everywhere.
- **Surrogate keys in OLTP / source-of-record tables.** Surrogate keys belong in the warehouse, not in the operational system.
- **Modeling without grain stated explicitly.** Grain ambiguity is the root cause of half of all warehouse bugs.
- **Modeling SCD2 columns inline in dimensional marts when source data is already insert-only / event-stream.** Don't add the complexity you can get for free.
- **Using JSON columns in the warehouse when the source could be modelled relationally.** JSON is a landing-layer pattern, not a target-layer one (with exceptions for genuinely variable shapes).
- **Modeling tools as the deliverable.** A beautiful Lucidchart that nobody updates is worse than a scrappy whiteboard photo that everyone trusts.

---

## 10. A worked layered topology

Pulling the above together for a multi-brand ERP-anchored finance estate:

```
S/4HANA ─(CDC-enabled CDS)─▶ Kafka/Confluent (Avro + Schema Registry)
                                              │
                                              ▼
                                  S3 / Iceberg (JSON / Avro landing)
                                              │
                                              ▼
                                  Snowflake — Raw Vault (DV2.0)
                                              │
                                              ▼
                                  Snowflake — Business Vault
                                              │
                                              ▼
                                  Snowflake — dimensional marts
                                              │
                                              ▼
                                  ThoughtSpot / SAC / data science (OBT)
```

This isn't the only valid topology — it's the one that holds up best when the requirements are audit-grade lineage, multi-brand consolidation, and surviving a source-system migration without rewriting the marts.

---

## 11. Vocabulary

- *"State the grain"* — first sentence in any modelling discussion.
- *"Conceptual → logical → physical"* — when sequencing the conversation.
- *"Conformed dimension"* — dimensional vocabulary for cross-mart consistency.
- *"Hub-link-satellite"* — Data Vault vocabulary.
- *"Schema-on-read vs schema-on-write"* — when discussing data lakes.
- *"Schema evolution: backward / forward / full"* — for streaming schemas.
- *"Slowly-changing dimension Type 2"* — for history-aware dimensions.
- *"Data contract"* — for producer-consumer agreements.
- *"Insert-only"* — for vault-style or event-stream targets.

---

## 12. Check yourself

1. **"Walk me through how you'd model an SAP-origin finance estate."**
   Answer shape: Pattern B (DV + dimensional). State the grain. Walk the layers. Acknowledge the alternatives.
2. **"When would you choose Data Vault over dimensional?"**
   Answer shape: integration layer in multi-source / migration / audit-heavy contexts. Dimensional always for marts.
3. **"How do you handle slowly-changing dimensions?"**
   Answer shape: depends on layer — snapshots for marts, effectivity satellites in vault, source-event-stream where available.
4. **"How do you think about modeling event-stream data?"**
   Answer shape: schema-first, contract-driven, schema-registry-backed; landing as Avro/JSON; downstream model chosen on consumer needs.
5. **"What modelling tool do you use?"**
   Answer shape: light-tool default (dbdiagram.io / Mermaid in repo + dbt for physical); upgrade to SqlDBM / Sparx EA if the org needs formal EA artefacts. Avoid the trap of evangelising a specific tool.
6. **"Give me a modelling decision you regretted."**
   Have one ready. Senior architects always have one. Frame as: decision + why it seemed right + what failed + what you learned.

---

## 13. Practice / output

Produce a one-page **"How I Approach Data Modelling"** brief:

- The three-level discipline (conceptual → logical → physical), one line each.
- The methodology decision matrix (§3).
- The layered topology from §10, with one line on why each layer earns its place.
- Your tool stack in one sentence: "Whiteboard / Miro for conceptual, dbdiagram.io or Mermaid in repo for logical, dbt for physical."

Having written it down is the point. A discipline you can point to beats one you can only assert, and writing the matrix out is what exposes the methodology preferences you did not know you had.

---

## 14. Things to skip

- Deep notation arguments (Chen vs IDEF1X vs Crow's Foot vs Bachman). Know they exist; default to Crow's Foot; move on.
- Tool wars (Erwin vs ER/Studio vs PowerDesigner). Acknowledge the heavy tools exist; don't evangelise.
- Modelling for OLTP systems (normalisation forms beyond 3NF, ACID nuances). Out of scope for an analytics-focused architect.
- Detailed dimensional modelling rules (Kimball's *The Data Warehouse Toolkit* has 30+ patterns — junk dimensions, role-playing dimensions, factless facts). Name them when relevant; don't recite.

---

