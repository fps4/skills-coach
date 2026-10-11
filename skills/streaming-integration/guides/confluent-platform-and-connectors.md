---
title: Confluent Platform, Connectors and Schema Governance
summary: Confluent's product vocabulary mapped onto open-source Kafka, plus connector strategy, cluster linking, Tableflow, and Schema Registry governance as data contracts.
---

## Frame

Confluent is Kafka with a branded layer of products around it. Most of what an architect needs is
the mapping from open-source Kafka (or a managed service such as AWS MSK) to Confluent's names, plus
the governance practices that make topics into stable interfaces.

Three mental models:

1. **Map every Confluent product to its open-source equivalent.** You are not learning streaming;
   you are renaming it. The table in Section 1c does most of the work.
2. **"Managed vs custom connector" is an ownership decision, not a technical one.** A managed
   connector is operated by Confluent (you configure; they run, patch, scale). A self-managed
   connector means you own the Connect worker. Connector strategy is deciding which to standardise
   on per source.
3. **Schema Registry plus compatibility modes are your data contracts.** Operationally a data
   contract is subject naming + compatibility mode + ownership + tests (Section 5).

See also [Flink SQL on Confluent](./confluent-flink-sql.md) for the stream-processing layer.

---

# Section 1 — Confluent Cloud vs Confluent Platform

## 1a. The two products

- **Confluent Platform (CP)** — the **self-managed** distribution you run on your own infrastructure
  (on-prem, your VPC, OpenShift). Kafka brokers plus the Confluent components (Schema Registry,
  Connect, ksqlDB, Control Center, REST Proxy), packaged and supported. You operate it.
- **Confluent Cloud (CC)** — the **fully managed SaaS**: serverless Kafka, managed Schema Registry,
  managed connectors, managed Flink, Stream Designer, Tableflow. Confluent runs the brokers.

Rule of thumb: Platform when data must stay on your own infrastructure (regulated, on-prem,
OpenShift estates); Cloud when you want to offload operations and move fast. Large organisations
often run both, with a hybrid bridge between them — which is where cluster linking comes in.

## 1b. Cluster types on Confluent Cloud

| Type | For |
|---|---|
| **Basic** | Dev/test, small workloads, pay-as-you-go |
| **Standard** | Production, smaller scale, multi-AZ |
| **Enterprise** | Production with private networking, higher limits |
| **Dedicated** | Largest scale, single-tenant, private networking — the enterprise default |
| **Freight** | Cost-optimised, high-throughput, relaxed latency |

**Dedicated** is the typical enterprise production answer (single tenant, private networking,
predictable capacity). Its capacity is expressed in **CKUs** (Confluent Kafka Units) — the cost
lever.

## 1c. Open-source / MSK to Confluent map

| Open-source / AWS MSK | Confluent name | Note |
|---|---|---|
| MSK / self-managed Kafka brokers | Confluent Cloud / Confluent Platform | Same Kafka; managed vs self-managed |
| Kafka Connect cluster you operate | **Confluent Managed Connectors** | Confluent runs the worker; you configure |
| Custom Connect plugin / self-run worker | **Custom Connectors / self-managed Connect** | You own the worker (CC can host custom plugins too) |
| Confluent Schema Registry (self-run) | **Confluent Cloud Schema Registry** | Same API, managed |
| ksqlDB | ksqlDB (maintenance) → **Confluent Flink** | Flink is the strategic direction |
| MirrorMaker 2 | **Cluster Linking** | Native, offset-preserving replication |
| Manual topic/ACL provisioning | **Confluent Terraform provider / CLI** | Infrastructure as code for the platform |
| AWS Glue Schema Registry | Confluent Schema Registry | Different APIs — matters when migrating or mixing |
| (no direct equivalent) | **Stream Designer** | Visual pipeline builder |
| (no direct equivalent) | **Tableflow** | Topics → Iceberg/Delta tables for the lakehouse |

---

# Section 2 — Connectors and connector strategy

## 2a. Managed vs custom vs self-managed

- **Managed (fully managed) connector** — Confluent operates it end to end. You pick it from the
  catalog and configure it (JSON, UI, CLI, Terraform); Confluent runs, scales, patches and monitors
  it. Lowest operations, but you depend on the catalog covering your system.
- **Custom connector** — a plugin not in the managed catalog that you upload and Confluent Cloud
  hosts and runs. The middle ground.
- **Self-managed connector** — you run your own Kafka Connect workers with any plugin. Maximum
  control and reach; you own scaling, failure, upgrades and offsets.

| Choose | When |
|---|---|
| **Managed** | System is in the catalog; lowest ops wanted; standard enterprise systems (Postgres, S3, Snowflake, MongoDB, Salesforce…) |
| **Custom (CC-hosted)** | A plugin exists but is not managed; you still want CC to run it |
| **Self-managed (Connect)** | Exotic or legacy source, on-prem data residency, heavy custom transforms, or a CP deployment |

A connector strategy in one sentence: default to managed connectors for catalog-covered systems to
minimise operations, fall back to self-managed Connect for legacy or on-prem systems or data that
cannot leave the estate, and provision every connector through the same config-as-code path.

## 2b. Source vs sink

- **Source connectors** — external system → Kafka (CDC from a database via Debezium, JDBC source,
  Salesforce, S3 source).
- **Sink connectors** — Kafka → external system (S3, JDBC, Snowflake, Elasticsearch, HTTP).

## 2c. Change Data Capture

**CDC** (Debezium or managed CDC connectors) streams row-level database changes into Kafka — the
backbone of event-driven and data-mesh architectures. Points to hold:

- a **snapshot** phase followed by a **streaming** phase;
- the **outbox pattern** — the service writes its event to an outbox table in the same transaction
  as its state change, and CDC publishes it, avoiding a dual write to database and Kafka;
- a CDC stream of a dimension table can feed a Flink **temporal join**, enriching each event with
  the dimension as it was at event time.

## 2d. Single Message Transforms and troubleshooting

- **SMTs** — lightweight per-record transforms inside a connector (mask a field, route by topic,
  rename). Heavy logic belongs in Flink; SMTs are plumbing.
- **Troubleshooting** a failing connector, in the order to look:
  1. **converter / schema mismatch** — the most common real cause;
  2. **poison records** and the connector DLQ (`errors.tolerance` +
     `errors.deadletterqueue.topic.name`);
  3. connector **task** failures and restarts;
  4. **offset** management;
  5. **throughput / lag** tuning (`tasks.max`, partitions).

---

# Section 3 — Stream Designer, Tableflow, cluster linking

## 3a. Stream Designer

A **visual, low-code pipeline builder** on Confluent Cloud: compose topics, connectors and
ksqlDB/Flink processing on a canvas and deploy them as one unit. Good for prototyping and onboarding;
governed production still wants pipelines as version-controlled config or SQL.

## 3b. Tableflow

**Tableflow** materialises Kafka **topics as open-format tables (Apache Iceberg / Delta Lake)** for
the lakehouse — no separate ETL or sink job to land streams in the warehouse. One governed topic,
queryable by the data platform.

## 3c. Cluster linking

**Cluster Linking** is native, **offset-preserving** replication between Kafka clusters — the
managed successor to MirrorMaker 2. Use cases:

- **Hybrid bridge** — Platform (on-prem) ↔ Cloud.
- **Multi-region / DR** — active-passive or geo-distribution.
- **Migration** — move workloads with offsets intact: mirror topics, cut consumers over gradually,
  move producers last. A zero-downtime bridge off self-managed Kafka.

---

# Section 4 — Infrastructure as code and the CLI

- **Confluent CLI** (`confluent`) — manage environments, clusters, topics, ACLs, connectors,
  schemas and Flink statements from scripts.
- **Confluent Terraform provider** — declaratively provision clusters, topics, service accounts,
  ACLs/RBAC, connectors and schemas. This is how a platform team enforces standards: topic naming,
  partition counts, retention and RBAC become code-reviewed Terraform, not console clicks. The
  console is for inspection, not provisioning.

---

# Section 5 — Schema Registry governance and data contracts

## 5a. What Schema Registry does

A central store for **schemas** (Avro, Protobuf, JSON Schema) that producers and consumers register
against, so messages are **validated and evolvable** without breaking consumers. Each topic's key
and value schema live under a **subject**.

## 5b. Subject naming strategies

| Strategy | Subject = | Use when |
|---|---|---|
| **TopicNameStrategy** (default) | `<topic>-key` / `<topic>-value` | One schema type per topic (most common) |
| **RecordNameStrategy** | the record's fully qualified name | Several event types, same schema shared across topics |
| **TopicRecordNameStrategy** | `<topic>-<record-name>` | Several event types per topic, scoped to that topic |

Why put several event types on one topic? Ordering. An order's created, updated and cancelled events
on one topic, keyed by order id, stay in order per key. The record-name strategies make that
possible.

## 5c. Compatibility modes

| Mode | Allows | Safe evolution |
|---|---|---|
| **BACKWARD** (default) | New schema reads old data | Add optional fields / remove fields → **upgrade consumers first** |
| **FORWARD** | Old schema reads new data | Add fields / remove optional fields → **upgrade producers first** |
| **FULL** | Both | Only fully compatible changes |
| **NONE** | Anything | No checks — avoid on governed topics |
| **\*_TRANSITIVE** | Same, against **all** prior versions | Strongest guarantee |

The must-know: **compatibility mode dictates upgrade order** (producers or consumers first). For a
shared cross-team contract, push for **FULL_TRANSITIVE**, so any producer version interoperates with
any consumer version.

## 5d. Data contracts

A **data contract** = schema **+** compatibility policy **+** ownership **+** metadata/semantics
**+** quality rules. Confluent's data-contract features extend Schema Registry with **field-level
tags** (e.g. PII), **validation rules**, and **migration rules** that transform data across a breaking
evolution. A topic is not just a schema; it is a contract that says who owns it, how it may evolve,
which fields are sensitive and how it migrates.

## 5e. Topic-design standards

What a platform's topic standard specifies:

- **Naming convention** — e.g. `<domain>.<entity>.<event-type>.<version>`.
- **Partitioning** — by key for ordering; partition count for throughput plus headroom (easy to
  raise, hard to lower).
- **Retention and cleanup** — time/size retention vs **compaction** (keep the latest value per key,
  for upsert, latest-state and changelog topics).
- **Replication factor / `min.insync.replicas`** — durability.
- **Keying** — chosen for ordering and even distribution.
- **DLQ and replay** conventions.
- **RBAC** — least privilege per topic and consumer group, provisioned via Terraform.

## 5f. Streams as data products

Schema contracts, topic standards and connector strategy are the mechanics; **data mesh** is the
operating model that gives each governed topic an owner, documentation, discoverability and an SLA.

---

# Section 6 — Security baseline

**RBAC** role bindings per cluster, topic and consumer group; **service accounts and API keys**;
**ACLs**; **private networking** (PrivateLink or VPC peering on Dedicated/Enterprise); **encryption**
in transit and at rest; **audit logs**. The production baseline: least-privilege service accounts,
RBAC as Terraform, private networking, audit logs on.

---

## Self-test

Without notes: (a) name each Confluent product and its open-source equivalent; (b) give the
managed-vs-self-managed connector decision rule; (c) troubleshoot a connector failure by likely
cause; (d) explain how compatibility mode dictates producer/consumer upgrade order and what makes a
topic a stable contract; (e) enumerate a topic-design standard and say how Terraform enforces it.
