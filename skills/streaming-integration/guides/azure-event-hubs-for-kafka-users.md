---
title: Azure Event Hubs for Kafka Users
summary: Event Hubs through a Kafka lens — the concept mapping, the units you buy, and the places where the Kafka mental model breaks (checkpointing, partitions, protocol parity, Capture, geo-DR).
---

## Frame

Event Hubs exposes a **Kafka-compatible endpoint**, so Kafka producer, consumer and Connect
knowledge transfers directly. What does not transfer is the **operational vocabulary**: the units
you buy, the limits that bite, where offsets live, and what Capture does. Event Hubs is a smaller
surface than Kafka; the value is in knowing the seams.

> **Dated claims.** Event Hubs has been closing Kafka-parity gaps steadily, so anything marked
> **⚠ verify** should be checked against current documentation before you rely on it.

---

## 1. The mapping

| Kafka | Event Hubs | Note |
|---|---|---|
| Cluster | **Namespace** | The billing and networking boundary |
| Topic | **Event hub** (the entity) | One namespace holds many |
| Partition | Partition | Same guarantee — order within a partition, not across |
| Consumer group | Consumer group | Same idea, tighter limits |
| Broker | — | Managed away entirely |
| ZooKeeper / KRaft | — | Managed away entirely |
| Producer / consumer API | Same, over the Kafka endpoint (port 9093, SASL_SSL) | Or the native AMQP 1.0 SDK |
| Kafka Connect | Works against the endpoint | |
| Confluent Schema Registry | **Azure Schema Registry**, hosted in the namespace | Avro and JSON Schema, schema groups, compatibility modes |
| `__consumer_offsets` | **Nothing** — see §4 | The one that surprises people |

---

## 2. Tiers and units

| Tier | Unit | Roughly |
|---|---|---|
| **Basic** | Throughput Unit (TU) | 1 consumer group, 1-day retention, **no Kafka endpoint**. Effectively a toy |
| **Standard** | **Throughput Unit (TU)** | The default. Kafka endpoint, 20 consumer groups, 1–7 day retention, Capture as a paid add-on |
| **Premium** | **Processing Unit (PU)** | Resource isolation, longer retention (up to ~90 days), more partitions and consumer groups, Capture included |
| **Dedicated** | **Capacity Unit (CU)** | Single-tenant cluster, the largest limits |

**The number worth memorising: 1 Standard TU = 1 MB/s or 1,000 events/s ingress, and 2 MB/s
egress.** Standard caps at 40 TUs. Exceed your TUs and producers are throttled with a server-busy
error and must retry.

**Auto-inflate** (Standard) raises TUs automatically up to a ceiling. It **does not lower them
again** — one traffic spike leaves the namespace permanently larger and costlier until someone
notices.

**⚠ verify** specific limits — partition counts per tier, consumer group counts, retention ceilings
and maximum message size have all moved.

---

## 3. Partitions

- **Ordering is per partition**, as in Kafka: the partition key is the ordering contract.
- **Partition count on Standard is fixed at creation** — historically it could not be increased,
  which makes the initial choice more permanent than on Kafka. Premium and Dedicated allow
  increases. **⚠ verify.**
- Limits are much lower than a self-managed Kafka cluster — tens per event hub on Standard, hundreds
  to a thousand-plus on Dedicated. **⚠ verify.**

On Event Hubs, partition count is a capacity *and* an ordering decision taken early and hard to
reverse, so it is designed rather than defaulted. A consumer group scales to at most one active
reader per partition.

---

## 4. Offsets and checkpointing — the real difference

Kafka stores consumer offsets **in the broker** (`__consumer_offsets`). Event Hubs does not.

**The client checkpoints to an external store — normally an Azure Blob Storage container** — via
the SDK's processor client. So:

- The **checkpoint store is part of your architecture**: it needs provisioning, permissions,
  monitoring and a lifecycle.
- **Consumer lag is not a broker-side metric you just read.** It is computed from sequence numbers
  against checkpoints, or taken from whatever platform metrics expose it. **⚠ verify.**
- **Partition ownership and rebalancing** are coordinated **through that store**, not by a
  broker-side group coordinator.

This is the difference that changes an operational design.

---

## 5. Kafka protocol — what works and what does not

Works: standard produce and consume (Kafka protocol 1.0+), Kafka Connect, most client libraries,
consumer groups.

Historically missing or partial — **⚠ verify each; this is the fastest-moving part of the
product**:

- **Kafka transactions** and full exactly-once producer semantics;
- **Kafka Streams** — long unsupported, later in preview on higher tiers;
- **Log compaction** — long unsupported, later added;
- **Kafka-style broker ACLs** — Event Hubs uses **SAS tokens or Entra ID RBAC** instead;
- Admin/topic-management via the Kafka Admin API — partial, tier-dependent.

The Kafka endpoint covers produce, consume and Connect — most of what a migration needs. Confirm
the current state of transactions, Streams and compaction before designing on them.

---

## 6. Capture — and why it is not a Delta landing

**Capture** writes batches of events to Blob Storage or ADLS Gen2 on a time or size window, in
**Avro**.

1. It is a cheap, no-code durable raw archive without running a consumer — good for replay and
   audit.
2. **It writes Avro files, not Delta tables.** Landing a stream in the lakehouse as Delta needs
   Structured Streaming, a Fabric Eventstream with a Lakehouse destination, or Stream Analytics.

Retention on Standard is 1–7 days, short compared with a Kafka cluster configured for 30. **Event
Hubs is usually a transport, not a system of record** — the lake table is. Replay strategy therefore
has to be designed, not assumed.

---

## 7. Reliability and networking

- **Geo-disaster recovery (Geo-DR)** — metadata-only replication behind a failover alias. **The
  event data does not replicate.** Commonly misread.
- **Geo-replication** — newer, replicates event data itself, on higher tiers. **⚠ verify.**
- **Availability zones** within a region on supporting tiers.
- **Private endpoints, VNet service endpoints, IP filtering** — the standard Azure private-networking
  story; normally a hard requirement in an enterprise estate.
- **Identity** — SAS keys or **Entra ID RBAC** with managed identities. Entra ID is the current
  answer; connection-string-only sounds dated.

---

## 8. Getting it into the data platform

| Route | Use |
|---|---|
| **Fabric Eventstream** | Low-code ingest into an Eventhouse or Lakehouse. Fast to stand up; limited transformation surface |
| **Spark Structured Streaming** | Kafka connector against the endpoint, or the native connector. **The only route here with real event-time semantics** — windows, watermarks, late-arrival restatement, exactly-once sinks |
| **Azure Stream Analytics** | SQL-like streaming jobs with windowing. Mature; a separate service with a separate bill |
| **Capture** | Raw Avro archive only |

The choice is decided by whether the workload needs event-time correctness. An ingestion-time
engine miscounts late events per window, and an at-least-once pipeline without an idempotent sink
double-counts every redelivery.

---

## 9. Common design questions

**How does it differ from Kafka operationally?** Offsets live in a checkpoint store you own, not in
the broker. You buy throughput units rather than sizing brokers. Retention is days, not weeks, so
the lake is the system of record. Partition count is harder to change. Auth is SAS or Entra RBAC,
not Kafka ACLs.

**How do you size it?** Ingress MB/s and events/s against TUs; egress at 2× ingress per TU;
partitions from required consumer parallelism and the ordering key; consumer groups from the number
of independent readers. Then check retention against the replay requirement, and decide whether
auto-inflate is a safety net or an unbounded bill.

**How do you guarantee no data loss?** Producer retries; checkpoint only after the sink commits; an
idempotent or transactional sink so a replay does not double-count; and Capture or a raw lake
landing so the stream can be replayed beyond the retention window.
