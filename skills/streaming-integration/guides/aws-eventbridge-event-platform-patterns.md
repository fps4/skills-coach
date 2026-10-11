---
title: AWS EventBridge Event Platform Patterns
summary: EventBridge in its own terms — buses, rules and patterns, the pieces people forget, reliability design with SQS and Lambda, platform-team concerns, and where EventBridge is not Kafka.
---

# AWS EventBridge — event platform patterns

A vocabulary and design guide for someone who knows SNS/SQS/Lambda and has a Kafka-shaped
streaming background. Most concepts are familiar; the point is to discuss them in **EventBridge's
own terms**, and to know where EventBridge is not Kafka.

---

## 1. The primitives

**Event bus.** A router, not a log: it matches incoming events against rules, delivers them, and
keeps nothing. Three kinds:

- **Default bus** — receives AWS service events (EC2 state changes, CodePipeline…) automatically.
- **Custom bus** — what you create for your own domain events. This is the platform.
- **Partner bus** — SaaS providers (Salesforce, Zendesk, Auth0, Datadog…) push events onto a bus you
  own.

**Event.** JSON with a fixed envelope; the envelope fields are what rules match on.

```json
{
  "version": "0",
  "id": "6a7e...",
  "detail-type": "AssistanceRequested",
  "source": "com.example.roadside",
  "account": "111122223333",
  "time": "2026-08-13T09:12:00Z",
  "region": "eu-west-1",
  "resources": [],
  "detail": { "memberId": "...", "location": {...}, "vehicle": {...} }
}
```

`source` + `detail-type` is the routing key and the public contract of the platform, so design it
deliberately: a reverse-DNS-style source (`com.example.roadside`, `com.example.membership`) plus
past-tense PascalCase event names (`AssistanceRequested`, `MembershipRenewed`).

**Rule.** An event pattern plus up to 5 targets. Content-based filtering happens in the bus,
*before* delivery, so consumers do not pay to receive and discard.

```json
{
  "source": ["com.example.roadside"],
  "detail-type": ["AssistanceRequested"],
  "detail": {
    "priority": ["high", "critical"],
    "vehicle": { "type": [{ "anything-but": "bicycle" }] },
    "estimatedDelayMinutes": [{ "numeric": [">", 30] }]
  }
}
```

Matchers worth knowing by name: `prefix`, `suffix`, `anything-but`, `numeric`, `exists`, `cidr`,
`equals-ignore-case`, and `$or`.

**Target.** Lambda, SQS, SNS, Step Functions, Kinesis, API Gateway, an HTTP endpoint via API
Destinations, another event bus (including cross-account), and more. Each target can have its own
**input transformer** to reshape the event before delivery.

## 2. The pieces people forget

- **Schema Registry + Schema Discovery.** EventBridge infers OpenAPI/JSON Schema from events on a
  bus and generates typed code bindings. Discovery suits brownfield; anything published as a platform
  contract gets a hand-authored, versioned, registered schema.
- **Archive + Replay.** An archive retains matching events for N days (or indefinitely); replay
  re-emits a time range onto the bus's rules. The nearest thing to a retained log — but it is
  administrative replay onto rules, not a consumer seeking an offset.
- **EventBridge Pipes.** Point-to-point: one source (SQS, Kinesis, DynamoDB Streams, MSK, MQ) →
  optional filter → optional enrichment (Lambda, Step Functions, API Destination) → one target.
  Replaces glue Lambdas that only move and lightly transform.
- **EventBridge Scheduler.** The successor to cron rules: one-time and recurring schedules at scale,
  with time zones, flexible windows and a retry/DLQ policy. Prefer it to `rate()`/`cron()` rules.
- **API Destinations.** Managed outbound HTTP to third parties, with a connection holding the auth
  (OAuth client credentials, API key, basic) and built-in rate limiting — no token-refreshing
  Lambdas.
- **Global endpoints.** Multi-region failover for a bus with managed replication. Rarely needed;
  the answer to a regional-resilience question.

## 3. Reliability design

**Delivery semantics.** EventBridge is **at-least-once**, with **no ordering guarantee**. Every
consumer must be idempotent.

**Idempotency in practice.** Write a deterministic business key (or the event `id`) to a DynamoDB
table with a conditional put and a TTL; duplicates short-circuit. For Lambda, the Powertools
idempotency utility implements exactly this.

**Retries and DLQs — two layers, a classic confusion:**

1. **Bus → target delivery failure.** EventBridge retries with exponential backoff for up to 24
   hours (`maximumRetryAttempts` / `maximumEventAge`), then sends to the **rule target's DLQ** (an
   SQS queue). *This DLQ holds undelivered events, not failed business logic.*
2. **Inside the consumer.** With SQS → Lambda, the queue's `RedrivePolicy` (`maxReceiveCount`)
   moves poison messages to the queue's own DLQ after N failed processing attempts. With Lambda as a
   direct target, async invocation retries twice and then uses Lambda's own destination/DLQ.

A well-designed platform has both, and the runbook tells them apart.

**Why bus → SQS → Lambda usually beats bus → Lambda.** The queue gives buffering against downstream
slowness, a visible backlog metric, concurrency control, batching, per-message retry counts, a real
DLQ with redrive, and the ability to pause consumption without losing events. Direct invocation is
fine for low-volume, fire-and-forget work.

**Partial batch failures.** With an SQS event source mapping, enable `ReportBatchItemFailures` and
return `batchItemFailures`, so only the failed message ids return to the queue. Without it, one bad
message in a batch of ten re-drives all ten and can loop forever. Set the queue's **visibility
timeout to at least 6× the Lambda timeout**.

**Ordering.** If you genuinely need ordering, EventBridge is the wrong primitive. Use SQS FIFO with a
`MessageGroupId` per entity (groups still process in parallel), or Kinesis/MSK with a partition key.
Often better: remove the requirement — version the entity, ignore stale events, make handlers
commutative.

**Throughput and quotas.** PutEvents is a soft, region-dependent quota (thousands per second,
raisable). Payload limit is 256 KB — beyond that use the **claim-check pattern**: body in S3,
pointer in the event.

## 4. Observability and cost

- **Metrics:** `Invocations`, `FailedInvocations`, `ThrottledRules`, `DeadLetterInvocations`,
  `MatchedEvents`, plus SQS `ApproximateAgeOfOldestMessage` (the single best backlog alarm) and
  `ApproximateNumberOfMessagesVisible` on every DLQ.
- **Alarm on DLQ depth > 0.** Non-negotiable: a silent DLQ is a silent data-loss incident.
- **Tracing.** X-Ray or a vendor APM across bus → queue → Lambda; propagate a correlation id in
  `detail` (or a custom envelope field) so one business transaction is traceable across hops.
- **Cost model.** About $1 per million custom events published; **rules, matching and delivery to
  AWS targets are not separately charged**; archive/replay and Schema Discovery are. Kafka/MSK is
  priced on provisioned brokers — cheaper at sustained high volume, far more expensive at low,
  bursty volume. That cost curve is a legitimate architecture argument.

## 5. Platform-team concerns

- **Bus topology.** One central bus; one bus per bounded context; or a hub fanning out to domain
  buses cross-account. Per-domain buses give clean ownership and IAM boundaries; a central bus gives
  one place to discover everything. Common compromise: **domain-owned buses plus cross-account rules
  forwarding to a central observability/archive bus.**
- **Multi-account.** A rule can target a bus in another account; the target bus's resource policy
  allows `events:PutEvents` from the source account — event sharing without shared credentials.
- **Event contracts as a product.** Registered schemas, semantic versioning, additive-only changes
  within a major version, a deprecation window, generated bindings for consumers — the same
  discipline as Kafka Schema Registry compatibility modes.
- **Self-service.** The platform deliverable is the **module**, not the bus: a Terraform module or
  CDK construct that gives a product team a rule, queue, DLQ, alarms, dashboard and least-privilege
  IAM in one call.
- **Guardrails.** Enforce at synth/plan time: every queue and rule has a DLQ, every event a
  registered schema, no wildcard `source` patterns in production — via CDK Aspects or OPA/Sentinel
  on Terraform plans.

## 6. Choosing between the primitives

| Need | Use |
|---|---|
| Route one event to many different consumers, with content-based filtering, across accounts and SaaS | **EventBridge** |
| Simple fan-out of the same message to a few subscribers, low latency, high throughput | **SNS** (cheaper, simpler; SNS FIFO if ordering is needed) |
| Durable buffering, backpressure, per-message retry and DLQ, work queue | **SQS** |
| Ordered, replayable log; stream processing; high sustained throughput; independent consumers re-reading history | **Kafka / MSK / Confluent** |
| Ordered, replayable, AWS-native, shard-based analytics ingestion | **Kinesis Data Streams** |
| Orchestrating a multi-step business process with state, retries and compensation | **Step Functions** (orchestration rather than choreography) |

**How EventBridge is not Kafka:** no partitions, consumer groups or offsets; no consumer-driven
replay; no retained log by default (archive is separate and administrative); no stream processing;
no ordering guarantee; a 256 KB payload cap. In return: zero infrastructure, native AWS and SaaS
event sources, content-based routing in the bus, and pay-per-event pricing that is very cheap at low
and bursty volume.

The mature architecture usually runs both: **EventBridge for routing and integration events;
Kafka/MSK for high-volume streams and anything that needs a replayable log.**

## Related guides

- [Confluent Platform, Connectors and Schema Governance](./confluent-platform-and-connectors.md) and
  [Kafka for Real-Time AI/ML and MCP](./kafka-ai-ml-mcp-integration.md) — the Kafka side.
- [SAP Advanced Event Mesh (Solace)](./sap-advanced-event-mesh.md) — a broker-based event backbone
  that can feed such a platform.
