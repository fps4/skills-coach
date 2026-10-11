---
title: SAP Advanced Event Mesh (Solace)
summary: Consuming SAP business events from a Solace-based broker — how a router differs from a log, AMQP 1.0 addressing and acks, thin CloudEvents and the enrichment they force, landing patterns, operations and anti-patterns.
---

## Frame

Written for someone who owns the *consuming* side of an SAP event integration — cloud, IaC,
streaming, lakehouse — and needs to reason about the SAP-side event backbone they do not operate.

Three things to internalise before any product detail:

1. **AEM is Solace PubSub+, resold by SAP.** Almost every technical answer is a Solace answer. When
   SAP documentation is thin, Solace documentation is authoritative.
2. **A broker is not a log.** Kafka instincts mislead here. Solace routes messages to queues by topic
   subscription; it does not retain a partitioned, replayable log by default. Retention, ordering,
   scale-out and replay all work differently (§3).
3. **SAP business events are thin notifications, not data.** An S/4HANA event says *that* a business
   object changed and gives its key — not the record. Every downstream design therefore needs an
   **enrichment call back into SAP** (§5).

---

## 1. Name disambiguation

SAP has three similarly named messaging products.

| Product | What it is | Where it fits |
|---|---|---|
| **SAP Event Mesh** (the older BTP service, once "Enterprise Messaging") | SAP's lightweight BTP messaging service. Queue-centric, modest limits, AMQP 1.0 / MQTT / REST | Legacy; SAP steers customers off it |
| **SAP Advanced Event Mesh (AEM)** | **Solace PubSub+ Platform**, OEM'd and sold by SAP. Event brokers + event mesh + Event Portal + Mission Control + Insights | The strategic enterprise event backbone |
| **SAP Event Broker for SAP cloud applications** | A minimal, SAP-managed broker for SAP-to-SAP cloud eventing only. No customer topics, no mesh | SAP-to-SAP scenarios only |

Also separate: **SAP Integration Suite / Cloud Integration (CPI)** is the *mediation and
orchestration* layer — transformation, protocol conversion, legacy connectivity. In the reference
architecture it is deliberately demoted: AEM distributes events; CPI is used *only where mediation
is genuinely required*. Event distribution is not integration processing.

---

## 2. The platform in one page

| Surface | What it does | Who uses it |
|---|---|---|
| **Event Portal** | Design-time governance: application domains, applications, events, schemas, versions, AsyncAPI import/export, event catalogue. Can also discover runtime brokers and Kafka clusters | Architects, domain teams |
| **Mission Control** | Runtime operations: broker lifecycle, queues, topic subscriptions, client usernames, ACL and client profiles, message VPN configuration | Platform engineers |
| **Insights** | Metrics, monitoring, alerting; exports to Datadog / Grafana / New Relic / Splunk | SRE / platform |
| **Event Broker Service** | The broker instance — a sized Solace PubSub+ software broker in a region | Runtime |

**Deployment shapes**

- **Public regions** — SAP/Solace-managed in a hyperscaler region; public TLS endpoints.
- **Private / dedicated regions** — the broker runs in *your* hyperscaler account and Kubernetes
  cluster, managed by the AEM control plane; VPC-private connectivity (peering, PrivateLink) instead
  of public egress.
- **Event mesh** — brokers linked by **Dynamic Message Routing (DMR)**, so a subscription in one
  region attracts matching events published in another. Routing is subscription-driven and
  automatic.

A common enterprise setup: single-broker topology per tenant, separate non-production and production
tenants. Every connection lands in a **message VPN** — the broker's logical tenant boundary.

---

## 3. Solace vs Kafka

| Concern | Kafka | Solace / AEM |
|---|---|---|
| **Core abstraction** | Partitioned, retained, replayable **log** | **Router** that moves messages to queues by subscription |
| **Topic** | A physical, pre-provisioned, partitioned resource | A **dynamic, hierarchical routing address stamped on the message**. Never pre-created; millions are fine and free |
| **Topic syntax** | Flat string | Levels separated by `/`; wildcards `*` (exactly one level) and `>` (one or more trailing levels) |
| **Durable consumption unit** | Consumer group + offsets | **Queue** with one or more **topic subscriptions** |
| **Retention** | Time/size retention; consumers rewind by offset | Messages leave the queue when acked. Persistence is a **spool quota**, not retention. Replay needs the separate, bounded **Replay Log** |
| **Ordering & scale-out** | Order per partition; consumers ≤ partitions | **Exclusive queue** = strict order, one active consumer. **Non-exclusive** = competing consumers, no order. **Partitioned queue** = order per partition key with scale-out |
| **Filtering** | Consumer-side, or topic-per-filter | **Server-side, on the topic hierarchy** |
| **Schema governance** | Schema Registry, enforced at serialisation | **Event Portal schemas are design-time only.** The broker does not validate payloads |
| **Delivery** | At-least-once with offsets | **Direct** (at-most-once, cheap fan-out) or **Guaranteed** (spooled, acked, redelivered) |

Four consequences:

- **Design the topic hierarchy as a filtering surface.** Filtering is server-side and topic-only, so
  anything a consumer might filter on — domain, entity, verb, version, company code, region —
  belongs *in the topic*, left to right, coarse to fine. A convention like
  `<domain>/<entity>/<verb>/<version>/<qualifiers…>` (e.g. `finance/invoice/posted/v1/NL/1000`) is
  the whole governance model.
- **Version in the topic.** No runtime schema enforcement, so a breaking change is a new topic level
  (`/v2`). Consumers migrate by changing a subscription.
- **Do not promise Kafka-style replay.** The Replay Log is size- and time-bounded per message VPN.
  "Reprocess six months of events" is met by a durable landing zone (object storage, Kafka, Iceberg)
  fed by a consumer. **AEM is a distribution backbone, not an event store.**
- **Schema validation is the consumer's job** — at the consuming edge, the control Event Portal
  cannot enforce.

---

## 4. AMQP 1.0 against a Solace broker

**Connection**

- Endpoint `amqps://<host>:5671` (TLS; `5672` plain — avoid). Same broker, other ports: SMF
  `55443`/`55555`, MQTT `8883`, REST `9443`.
- SASL `PLAIN` with a **client username + password** (a broker-level identity, not a human one), or
  `EXTERNAL` with a client certificate. Brokers also support **OAuth 2.0 / OIDC** (JWT validated on
  connect) and LDAP.

**Addressing**

| Intent | AMQP address | Behaviour |
|---|---|---|
| Publish an event | target `topic://finance/invoice/posted/v1` | Routed to every queue with a matching subscription |
| Consume durably (**do this**) | source `<queue-name>` (bare name = queue) | Binds the pre-provisioned durable queue; guaranteed delivery |
| Consume a topic directly (**avoid**) | source `topic://finance/invoice/>` | Temporary, non-durable endpoint; everything published while disconnected is lost |

**Consumers bind to durable queues; queues subscribe to topics.** The queue is the contract and the
buffer; producers never know it exists.

**Flow control, acks and failure**

- **Prefetch = AMQP link credit.** Keep it modest when several consumers share a non-exclusive queue,
  or one consumer hoards messages and scaling does nothing.
- **Settlement is the ack.** `accepted` removes the message; `released` returns it for redelivery;
  `rejected` / `modified` with `undeliverable-here` routes it towards the dead-message queue.
- **Dead-lettering** is queue configuration: `max-redelivery-count` on the queue, `DMQ-eligible` on
  the message, a configured **Dead Message Queue**, plus `max-msg-spool-usage` (per-queue quota) and
  TTL / `respect-TTL`.
- **Redelivery means duplicates.** At-least-once is the only honest promise; consumers dedupe on the
  event's own identifier (the CloudEvents `id`).

**Client libraries.** Any AMQP 1.0 client works: `python-qpid-proton`, `rhea` (Node.js), Qpid JMS,
AMQPNetLite (.NET). Solace's SMF clients are faster and expose more broker semantics, but AMQP keeps
the consumer vendor-neutral — usually the right trade for a platform team.

---

## 5. What SAP publishes — and why it changes the pipeline

**S/4HANA → AEM** runs through S/4's **Enterprise Event Enablement** (event bindings and channels),
ABAP RAP business events, or CPI publishing to AEM. The SAP team owns this half.

**The envelope is CloudEvents 1.0:**

```
specversion : 1.0
type        : sap.s4.beh.businesspartner.v1.BusinessPartner.Created.v1
source      : /default/sap.s4.beh/<system-id>
id          : <uuid>
time        : 2026-08-12T09:14:22Z
datacontenttype : application/json
```

Over AMQP these arrive **structured** (the whole CloudEvent as JSON in the body) or **binary**
(attributes as AMQP application-properties, payload in the body). Pin one in the design — it decides
where the consumer reads type and id from.

**The payload is a key, not a record:**

```json
{ "BusinessPartner": "1000123" }
```

Consequences:

- **Enrichment is mandatory** — call back into S/4 (OData/API, via the API gateway and its OAuth
  model) to fetch the object's current state. A naive "event → object storage" sink does not fit.
- **Change signals, not a data feed.** Enrichment returns *current* state, so the event stream alone
  is not a source of truth for history. Build historical fidelity downstream (append the enriched
  snapshot with the event time, or use CDC/replication).
- **Read-after-write races.** The event can arrive before the object is readable through the API.
  Retry with backoff on 404 or incomplete reads; exhausted retries go to the DMQ, not the floor.
- **Fan-out amplifies the callback.** Five consumers of one event means five calls into S/4 — the
  argument for enriching once centrally and republishing a canonical, fattened event.
- **Large payloads need a claim check** — put oversized enriched payloads in object storage and pass
  a reference.

---

## 6. Landing SAP events in a cloud estate

| Pattern | How it works | When it fits | Watch out |
|---|---|---|---|
| **Long-lived AMQP consumer** (container on ECS/EKS/Fargate or similar) | Persistent AMQP 1.0 connection, binds a durable queue | Default for a team that runs containers. Full control over prefetch, acks, DMQ | You own scaling, connection lifecycle, credential rotation, health checks |
| **REST Delivery Point (RDP)** — broker pushes | The broker POSTs queued messages to an HTTPS endpoint with retries | Serverless consumers; no connection to operate | Endpoint must be reachable and authenticated; per-message HTTP cost; retry/DMQ semantics move into RDP config |
| **Solace ↔ Kafka bridge / connector** | Solace source connector or native bridge into Kafka | Estate is Kafka-centric and wants one streaming plane | Extra hop, second operational surface; ordering and keys need careful mapping |
| **CPI as consumer** | SAP Cloud Integration subscribes and mediates | SAP-side transformation or legacy connectivity genuinely required | Reintroduces the middleware the architecture tries to demote |

**No AWS Lambda event-source mapping exists for Solace/AMQP 1.0.** Lambda's managed pollers cover
SQS, Kinesis, DynamoDB Streams, MSK, self-managed Kafka and Amazon MQ — not Solace. Run your own
consumer or push through an RDP.

---

## 7. Security and operations

**Authorisation model**

- **Client username** — the connecting identity, one per consuming application, never shared.
- **ACL profile** — publish and subscribe **topic exceptions**; where least privilege lives (e.g.
  subscribe to `finance/invoice/>`, publish nothing).
- **Client profile** — capabilities and limits: guaranteed messaging on/off, max flows, max
  connections, queue-creation rights.
- Credentials live in a secrets manager, referenced by name — never in config files or source
  control.

**What to alert on**

- **Spool usage** per VPN and per queue against quota — the classic outage: a stuck consumer fills
  the spool and publishers start failing.
- **Queue depth and oldest-message age** — the lag signal (there are no offsets).
- **Redelivery count and DMQ arrival rate** — poison-message detection.
- **Bind/connect failures and disconnects** — usually credential or ACL drift.
- Enrichment-callback error rate and latency on the consuming side.

**Sizing and cost.** Broker service classes are sized by **connection count, spool size and message
rate** — not per message. Mesh links and cross-region routing add cost.

---

## 8. Anti-patterns

- **Treating AEM as a data lake or event store** — bounded replay, spool quotas.
- **Consuming topics directly instead of via a durable queue** — silent loss on every disconnect.
- **Assuming Event Portal enforces schemas** — it governs at design time; validate at the edge.
- **One catch-all queue subscribed to `>`** — kills the filtering model, couples every consumer to
  every event, makes DMQ triage impossible.
- **Free-text or ID-laden topic levels** nobody can subscribe against — high cardinality is fine,
  *unfilterable* cardinality is not.
- **Ignoring enrichment fan-out** — quietly overloading S/4's API from five consumers.
- **No version level in the topic** — a breaking change then has no migration path.

---

## 9. Hands-on lab (half a day)

Use a free developer broker on Solace Cloud, or `docker run solace/solace-pubsub-standard`.

1. Open **Mission Control**; note the message VPN and AMQP host/port; create a **client username**
   with an ACL profile.
2. Create a durable queue `q.finance.invoice.v1` with subscription `finance/invoice/posted/v1/>`.
   Set `max-redelivery-count = 3`, DMQ-eligible, and create the DMQ.
3. Publish with a `qpid-proton` sender to `topic://finance/invoice/posted/v1/NL/1000` using a
   CloudEvents binary-mode envelope.
4. Consume from the queue. Accept one message, release another, reject a third — observe redelivery,
   then arrival in the DMQ.
5. Publish to `finance/invoice/posted/v2/...` and confirm the v1 queue does not receive it.
6. Add a second consumer; compare exclusive vs non-exclusive queues; vary link credit and watch
   distribution change.
7. Enable **Replay** on the VPN, replay from a timestamp, and note what it does *not* give you
   compared with a Kafka offset rewind.
8. Optionally configure a **REST Delivery Point** and compare its operational shape.

---

## 10. Design-review answers

**How is this different from Kafka?** Solace is a router, Kafka is a log. Solace attracts messages
into queues by hierarchical topic subscription, filtered server-side, with dynamic topics you never
provision. Kafka retains a partitioned log consumers rewind by offset. Solace excels at flexible,
governed distribution to many consumers; Kafka at being a replayable system of record. In an estate
with both: AEM distributes SAP events; anything needing history lands in Kafka or object storage
behind a consumer.

**How do you not lose SAP events?** A durable queue with a topic subscription created *before* the
producer publishes; guaranteed delivery; ack only after the pipeline commits; bounded redelivery into
a DMQ with alerting on DMQ arrivals and queue age; an idempotent consumer keyed on the CloudEvents
`id`.

**What is the hardest part?** The payload, not the protocol. Thin events force an enrichment stage —
with its auth, retries and load on the SAP API — into the middle of the design, and argue for
enriching once centrally.

**Where is the team seam?** The SAP side owns event production, topic semantics and S/4; the cloud
side owns the consumer runtime, IaC, observability and operations. The contract between them is the
topic hierarchy, the envelope and the queue — written down and versioned. Most risk sits in that
seam.

---

## 11. Sources

- **Solace documentation** — the real reference for broker semantics, AMQP addressing, queue
  configuration and replay.
- **SAP Help — Advanced Event Mesh**, and S/4HANA **Enterprise Event Enablement** documentation.
- **CloudEvents 1.0** spec and its AMQP protocol binding.
- **AsyncAPI** — the interchange format Event Portal imports and exports; the natural home for event
  contracts alongside OpenAPI specs.
