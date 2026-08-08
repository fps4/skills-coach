---
title: Confluent Platform, Connectors & Schema Registry Governance — Architect's Guide
summary: Confluent's branded dialect mapped onto open-source Kafka — Cloud vs Platform, managed and custom connectors, cluster linking, Tableflow, and Schema Registry as data-contract governance.
topic: streaming
format: guide
tags: [confluent, kafka, connect, schema-registry, data-contracts, terraform, msk]
updated: 2026-08-07
---

## Frame

This guide closes a *vocabulary* gap, not a knowledge gap. If you know
open-source Kafka or managed **AWS MSK** well — Connect, Schema Registry, topic
design, governance — then almost nothing here is a new concept. What it adds is
Confluent's branded dialect: Confluent Cloud vs Platform, Confluent-*managed* vs
*custom* connectors, Stream Designer, Tableflow, cluster linking, the Confluent
CLI and Terraform provider. Same machinery, Confluent's names on it.

It also folds in **Schema Registry governance and data contracts** (Section 5),
since the two belong together: connectors move data, the registry governs its
shape.

Three mental models to hold going in:

1. **Map every Confluent product to the MSK/OSS equivalent.** You are not
   learning streaming; you're renaming it. The table in Section 1c is the
   highest-leverage thing in this guide — it converts open-source Kafka
   experience into Confluent fluency directly.
2. **"Managed vs custom connector" is a governance/ownership decision, not a
   technical one.** A Confluent-managed connector means Confluent operates it
   (you configure, they run, patch, scale); a custom/self-managed connector
   means *you* own the Connect worker. A connector *strategy* is mostly deciding
   which to standardize on per source — an architecture call, not a coding one.
3. **Schema Registry + compatibility modes *are* your data contracts.** "Data
   contract" sounds like a new buzzword; operationally it is subject naming +
   compatibility mode + ownership + tests. Section 5 gives you the language to
   present existing practice as contract governance.

The through-line: defining connector strategies across managed and custom
connectors, and establishing Schema Registry governance, data contracts and
topic-design standards a platform team can hold everyone to.

---

# Section 1 — Confluent Cloud vs Confluent Platform

## 1a. The two products (say both, know the line)

- **Confluent Platform (CP)** — the **self-managed** distribution you run on
  your own infra (on-prem, your VPC, OpenShift/Red Hat — note the IBM/Red Hat
  tie-in). Kafka brokers + the Confluent components (Schema Registry, Connect,
  ksqlDB, Control Center, REST Proxy) packaged and supported. *You* operate it.
- **Confluent Cloud (CC)** — the **fully managed SaaS**: serverless Kafka,
  managed Schema Registry, managed connectors, managed Flink, Stream Designer,
  Tableflow. Confluent runs the brokers; you consume.

Architect framing: *"Confluent Platform when the client needs data on their own
infra — regulated, on-prem, Red Hat/OpenShift estates, which is squarely IBM
Consulting territory. Confluent Cloud when they want to offload ops and move
fast. A COE usually has to support *both* and a hybrid bridge between them —
which is where cluster linking comes in."* That sentence reads as someone who's
designed for enterprises, not just used a sandbox.

## 1b. Cluster types on Confluent Cloud (cost/scale awareness)

| Type | For |
|---|---|
| **Basic** | Dev/test, small workloads, pay-as-you-go |
| **Standard** | Production, smaller scale, multi-AZ |
| **Enterprise** | Production with private networking, higher limits |
| **Dedicated** | Largest scale, single-tenant, private networking, the enterprise default |
| **Freight** | Cost-optimized, high-throughput, relaxed-latency (newer tier) |

Know that **Dedicated** is the typical enterprise production answer (single
tenant, private networking, predictable capacity) and that capacity is expressed
in **CKUs** (Confluent Kafka Units) — the cost lever.

## 1c. The "rename your MSK knowledge" map (highest-leverage table)

| You ran (OSS / AWS MSK) | Confluent name | Note |
|---|---|---|
| MSK / self-managed Kafka brokers | Confluent Cloud / Confluent Platform | Same Kafka; managed vs self-managed |
| Kafka Connect cluster you operated | **Confluent Managed Connectors** | Confluent runs the worker; you configure |
| Custom Connect plugin / self-run worker | **Custom Connectors / self-managed Connect** | You own the worker (CC can host custom plugins too) |
| Confluent Schema Registry (self-run) | **Confluent Cloud Schema Registry** (managed) | Same API, managed |
| ksqlDB | ksqlDB (maintenance) → **Confluent Flink** | Flink is the strategic direction (guide #1) |
| MirrorMaker 2 | **Cluster Linking** | Native, offset-preserving replication |
| Manual topic/ACL provisioning | **Confluent Terraform provider / CLI** | IaC for the platform |
| Glue Schema Registry | Confluent Schema Registry | Note if a client is AWS-Glue-based |
| (no direct equiv) | **Stream Designer** | Visual pipeline builder |
| (no direct equiv) | **Tableflow** | Topics → Iceberg/Delta tables for the lakehouse |

Practice saying the right-hand column. That's the whole vocabulary gap.

---

# Section 2 — Connectors and connector strategy

## 2a. Managed vs custom vs self-managed (the ownership spectrum)

- **Confluent Managed (fully managed) connector** — Confluent operates it end to
  end. You pick it from the catalog, configure it (JSON/UI/CLI/Terraform), and
  Confluent runs, scales, patches, and monitors it. Lowest ops, fastest, but you
  depend on the catalog covering your source/sink.
- **Custom connector** — a connector plugin *not* in the managed catalog that you
  upload and Confluent Cloud hosts/runs for you (a middle ground on newer CC).
- **Self-managed connector** — you run your own Kafka Connect workers (on CP or
  your infra) with any plugin. Maximum control and reach; you own scaling,
  failure, upgrades, and offsets.

The architect's decision rule (this *is* "connector strategy"):

| Choose | When |
|---|---|
| **Managed** | Source/sink is in the catalog; want lowest ops; standard enterprise systems (Postgres, S3, Snowflake, Mongo, Salesforce…) |
| **Custom (CC-hosted)** | Plugin exists but isn't managed; still want CC to run it |
| **Self-managed (Connect)** | Exotic/legacy source, on-prem data residency, heavy custom transforms, or CP deployment |

*"Connector strategy for a COE is mostly: default to managed for catalog-covered
systems to minimize ops, fall back to self-managed Connect for legacy/on-prem or
where data can't leave the client estate, and standardize the config-as-code path
so every connector is provisioned the same way."* That's the bullet, answered.

## 2b. Source vs sink, and the patterns you've run

- **Source connectors** — external system → Kafka (CDC from a DB via Debezium,
  JDBC source, Salesforce, S3 source).
- **Sink connectors** — Kafka → external system (S3 sink, JDBC sink, Snowflake,
  Elasticsearch, HTTP).

The reference shape to hold in mind is the full
**REST→Kafka→transform→Kafka→deliver** model with Kafka Connect plus HTTP/S3
sinks, with Connect running across databases and cloud services on both the
source *and* sink side.

## 2c. CDC — the connector pattern worth deep-diffing

**Change Data Capture** (Debezium / managed CDC connectors) streams row-level
DB changes into Kafka — the backbone of event-driven and data-mesh
architectures. Be ready to discuss: snapshot + streaming phases, the outbox
pattern (avoid dual-write), and feeding a **temporal join** dimension in Flink
(guide #1, Section 5c). CDC → temporal join is a chef's-kiss architecture answer.

## 2d. Single Message Transforms (SMTs) and troubleshooting

- **SMTs** — lightweight per-record transforms in the connector (mask a field,
  route by topic, rename). Know they exist and that **heavy logic belongs in
  Flink, not SMTs** — SMTs are for plumbing.
- **Troubleshooting** — configuration and troubleshooting, the two things that
  actually consume connector time. Common
  failure modes to name — **DLQ** for poison messages (`errors.tolerance` +
  `errors.deadletterqueue.topic.name`), connector **task** failures and
  restarts, **offset** management, **converter/schema** mismatches (the #1 real
  cause), and **throughput/lag** tuning (tasks.max, partitions). Your platform's
  replay/DLQ design is direct evidence here.

---

# Section 3 — Stream Designer, Tableflow, cluster linking

## 3a. Stream Designer

A **visual, low-code pipeline builder** on Confluent Cloud — compose topics,
connectors, and ksqlDB/Flink processing into a pipeline through a canvas, deploy
as one unit. Know what it is and the architect's caveat: *"good for rapid
prototyping and onboarding teams; for COE-governed production I'd still want the
pipeline as version-controlled config/SQL, not only a canvas."*

## 3b. Tableflow

**Tableflow** materializes Kafka **topics as open-format tables (Apache Iceberg /
Delta Lake)** for the lakehouse — no separate ETL job to land streams in the
warehouse. This is the **streaming-meets-lakehouse bridge** and a strong talking
point: *"Tableflow is how I'd expose governed streams to the analytics/lakehouse
side as Iceberg tables without standing up a separate sink pipeline — one
governed topic, queryable by the data platform."* Ties cleanly to your
Databricks/lakehouse refresher.

## 3c. Cluster linking

**Cluster Linking** — native, **offset-preserving** replication between Kafka
clusters (the managed successor to MirrorMaker 2). Use cases to name:
- **Hybrid bridge** CP (on-prem) ↔ CC (cloud) — the IBM migration story.
- **Multi-region / DR** — active-passive or geo-distribution.
- **Migration** — move workloads to Confluent Cloud with offsets intact.

*"For a client modernizing off self-managed Kafka, cluster linking is the
zero-downtime bridge — mirror topics with offsets preserved, cut consumers over
gradually."* That's a migration-architect answer.

---

# Section 4 — Infrastructure as code & the Confluent CLI

- **Confluent CLI** (`confluent`) — manage environments, clusters, topics, ACLs,
  connectors, schemas, Flink statements from the terminal/scripts.
- **Confluent Terraform provider** — declaratively provision clusters, topics,
  service accounts, ACLs/RBAC, connectors, and schemas. **This is how a COE
  enforces standards** — topic naming, partition counts, retention, RBAC become
  code-reviewed Terraform, not console clicks.

Architect framing, for a spec-driven, PR-only delivery model: *"COE
governance lives in Terraform — topics, ACLs, schemas, connectors as
version-controlled, peer-reviewed config. The console is for inspection, not
provisioning."*

---

# Section 5 — Schema Registry governance & data contracts

This is its own competency, and the part most often under-specified. Here's
the language to present it as governance.

## 5a. What Schema Registry does

A central store for **schemas** (Avro, Protobuf, JSON Schema) that producers and
consumers register against, so messages are **validated and evolvable** without
breaking consumers. Each topic's key/value schema lives under a **subject**.

## 5b. Subject naming strategies (know the three)

| Strategy | Subject = | Use when |
|---|---|---|
| **TopicNameStrategy** (default) | `<topic>-key` / `<topic>-value` | One schema type per topic (most common) |
| **RecordNameStrategy** | the record's fully-qualified name | Multiple event types, same schema across topics |
| **TopicRecordNameStrategy** | `<topic>-<record-name>` | Multiple event types *per* topic, scoped to the topic |

The interesting one is **multiple event types per topic** (e.g. an order
lifecycle: created/updated/cancelled on one topic) — RecordName/
TopicRecordName strategies enable it. Knowing *why* you'd put several event types
on one topic (ordering guarantees per key) is senior signal.

## 5c. Compatibility modes (the heart of data contracts)

| Mode | Allows | Safe to evolve |
|---|---|---|
| **BACKWARD** (default) | New schema reads old data | Add optional fields / remove fields → **upgrade consumers first** |
| **FORWARD** | Old schema reads new data | Add fields / remove optional → **upgrade producers first** |
| **FULL** | Both | Only fully-compatible changes |
| **NONE** | Anything | No checks (avoid in a COE) |
| **\*_TRANSITIVE** | Same, vs **all** prior versions | Strongest guarantee; the COE default to push for |

The architect's must-know: **compatibility mode dictates upgrade order
(producers vs consumers first).** *"BACKWARD (the default) means I add optional
fields and upgrade consumers ahead of producers; for a shared COE contract I push
for FULL_TRANSITIVE so any version interoperates with any other — that's what
makes a topic a stable contract across teams."*

## 5d. Data contracts — the modern framing

A **data contract** = schema **+** compatibility policy **+** ownership **+**
metadata/semantics **+** quality rules. Confluent's data-contract features extend
Schema Registry with **field-level tags/metadata, rules, and migration rules**
(e.g. tag a field as PII, enforce a validation rule, define a transform on
evolution). Present your production schema-governance work in this language:
*"A topic isn't just a schema — it's a contract: who owns it, its compatibility
mode, its PII tags and validation rules, and how it migrates. That's what makes a
data product reusable across a data mesh."*

## 5e. Topic-design standards (the COE deliverable)

What a COE standard actually specifies — be ready to enumerate:
- **Naming convention** — e.g. `<domain>.<entity>.<event-type>.<version>`.
- **Partitioning** — by key for ordering; partition count for throughput +
  headroom (hard to reduce later).
- **Retention & cleanup** — time/size retention vs **compaction** (compacted for
  upsert/latest-value topics — ties to changelog sinks in guide #1, Section 2a).
- **Replication factor / min.insync.replicas** — durability.
- **Keying** — chosen for ordering and even distribution.
- **DLQ + replay** conventions.
- **RBAC** — least-privilege per topic/consumer group, provisioned via Terraform.

This list, delivered fluently, *is* "topic-design standards for the COE."

## 5f. Data mesh / data products

The strategic wrapper: streams as **data products** — owned, documented,
discoverable, contract-governed, reusable. A mature platform has dozens of
productized streams rather than dozens of point-to-point pipes. Connect it:
*"Schema Registry
contracts + topic standards + connector strategy are the mechanics; data mesh is
the operating model that makes each governed topic a reusable product with an
owner and an SLA."*

---

# Section 6 — Security & RBAC (round it out)

Be conversant: **RBAC** (role bindings per cluster/topic/consumer-group),
**service accounts + API keys**, **ACLs**, **private networking** (PrivateLink /
VPC peering on Dedicated/Enterprise), **encryption** in transit/at rest, and
**audit logs**. The COE answer: *"least-privilege service accounts, RBAC as
Terraform, private networking for production clusters, audit logs on."*

---

# Section 7 — Check yourself

1. *"Confluent Platform or Cloud for this client?"* → on-prem/regulated/Red Hat →
   Platform; offload ops/speed → Cloud; usually hybrid bridged by cluster
   linking (Section 1a).
2. *"Managed vs custom vs self-managed connectors — how do you choose?"* →
   ownership/governance decision; default managed for catalog systems,
   self-managed for legacy/on-prem/custom (Section 2a).
3. *"How do you troubleshoot a failing connector?"* → schema/converter mismatch
   first, DLQ for poison records, task restarts, offsets, lag/throughput tuning
   (Section 2d).
4. *"How do you migrate a client off self-managed Kafka?"* → cluster linking,
   offset-preserving, gradual consumer cutover (Section 3c).
5. *"How do you govern schemas across teams?"* → subject strategy + compatibility
   mode (FULL_TRANSITIVE for shared contracts) + ownership + PII tags/rules =
   data contracts; upgrade-order implications (Section 5c–5d).
6. *"What's in a topic-design standard?"* → naming, partitioning, retention vs
   compaction, RF/min-ISR, keying, DLQ, RBAC via Terraform (Section 5e).
7. *"How do you enforce COE standards at scale?"* → Terraform provider — topics,
   ACLs, schemas, connectors as reviewed code (Section 4).
8. *"What's Tableflow / why does it matter?"* → topics → Iceberg/Delta for the
   lakehouse without a separate ETL sink (Section 3b).

---

## One-paragraph self-test

If you can, without notes, (a) name each Confluent product and its MSK/OSS
equivalent, (b) give the managed-vs-self-managed connector decision rule, (c)
troubleshoot a connector failure by likely cause, (d) explain how compatibility
mode dictates producer/consumer upgrade order and what makes a topic a stable
contract, and (e) enumerate a topic-design standard and say how Terraform
enforces it — you speak Confluent's dialect fluently. This was always a
vocabulary gap rather than a knowledge gap: once the names are automatic, open
Kafka and MSK experience transfers wholesale.
