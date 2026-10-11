---
title: Kafka for Real-Time AI/ML and MCP
summary: Patterns for putting models next to streams — the four inference placements, feature stores and train/serve skew, and an assistive, human-approved MCP tool layer over a streaming platform.
---

## Frame

Three mental models:

1. **There are only a handful of ways to put a model next to a stream** — inference-in-stream,
   sidecar/microservice inference, async external call, and offline scoring written back. Once named,
   every "how would you do real-time AI?" question becomes a selection problem (Section 2).
2. **A feature store exists to solve one problem: train/serve skew.** The features a model saw in
   training must match the features it sees at inference. Kafka is the natural backbone for the
   online side.
3. **MCP is a tool-access protocol, and the AI over a production platform should be assistive, not
   autonomous.** Copilots and triage agents **propose**; an engineer reviews, approves and applies;
   nothing activates without explicit confirmation; everything is audited with a kill-switch.

---

# Section 1 — The two halves of real-time AI

- **Inference path** — applying a *trained* model to live events to produce a score, embedding or
  decision in near real time. "Score this transaction for fraud as it arrives."
- **Feature path** — turning streams into the features models learn from and serve on, keeping
  online and offline consistent. "Compute the customer's one-hour spend so training and serving see
  the same number."

Keep them separate to reason about latency, consistency and failure independently.

---

# Section 2 — Inference patterns

The core design choice: **where does the model run relative to the stream processor?**

| Pattern | How | Wins when | Cost / risk |
|---|---|---|---|
| **Inference-in-stream (embedded/UDF)** | Model called inside the stream processor — a Flink UDF or in-SQL inference function | Lowest latency, simplest topology, small/medium models | Couples model lifecycle to the job; big models bloat the operator |
| **Sidecar / microservice inference** | Stream calls a model-serving service (KServe, Seldon, SageMaker/Vertex endpoint, Triton) | Independent model deploy and scale, GPU serving, polyglot models | Network hop; the service's availability is now in the data path |
| **Async external call** | Stream issues async I/O to an inference API and stitches results back | Slow models, third-party LLM APIs, batchable calls | Ordering, timeout and backpressure handling |
| **Offline scoring → write-back** | A batch/ML platform scores and writes results to a topic the stream joins | Heavy models, no hard latency need | Staleness; served lookups, not real-time inference |

A useful migration path: start with an in-SQL inference function; when the model grows large or
GPU-bound, point the same function at a served endpoint called async — the same SQL statement, a
different implementation behind the function.

## 2a. The decision rule

- **Small/medium, low-latency, deterministic** → inference-in-stream.
- **Large / GPU / independently versioned** → served endpoint, called sync (low latency) or async.
- **LLM / third-party / expensive** → always async, with timeouts, batching and a fallback path; it is
  the least reliable hop and must not stall the pipeline.
- **No real-time need** → score offline, write results to a topic, join as a lookup or temporal
  dimension. Knowing when *not* to stream is the senior answer.

## 2b. Embeddings and RAG over a stream

Stream → **embed** (an embedding model as a UDF or sidecar) → vectors to a vector store or topic →
retrieval at query time. The index stays as fresh as the topic. Keep it retrieval-augmented,
evaluated and human-in-the-loop.

---

# Section 3 — Feature stores

## 3a. Train/serve skew

A model trained on "customer's average order value over 30 days" must get that *same* feature,
computed the *same* way, at serving time. If training uses a batch SQL job and serving uses
hand-written application code, they drift and the model silently degrades. A feature store is the
shared definition plus storage so both sides agree.

## 3b. Online vs offline

| | Offline store | Online store |
|---|---|---|
| **Purpose** | Training data, batch scoring | Low-latency serving at inference |
| **Storage** | Lake / warehouse (Parquet, Delta, BigQuery) | Key-value (Redis, DynamoDB, Cassandra) |
| **Access** | High throughput, latency tolerated | Single-key, millisecond lookups |
| **Kafka's role** | Source events land → batch features | **Stream computes features → upserts online store** |

**Streaming feature computation:** a Flink job consumes raw events, computes windowed aggregates
(one-hour spend, rolling counts) and upserts them to the online store (and/or a compacted topic),
while the same definitions populate the offline store — so there is no skew.

## 3c. Tools

**Feast** (open source, the common reference model), **Tecton**, and the SageMaker and Vertex feature
stores.

---

# Section 4 — MCP in a streaming platform

## 4a. What MCP is

**The Model Context Protocol is an open protocol for giving an LLM or agent controlled, structured,
auditable access to tools, data and context** — a typed, governed tool-API layer between an agent and
your systems.

On a streaming platform, MCP servers expose **streaming operations as tools**: list topics, inspect a
schema, explain a DLQ message, draft a Flink SQL transform, show consumer lag. An agent (or a human
through a copilot) calls them to reason about and assist with the platform.

## 4b. Typical assistive tools

- **NL → Flink SQL copilot** — natural-language intent becomes a *proposed* transform an engineer
  reviews and applies.
- **In-SQL inference functions** — models callable from SQL (inference-in-stream).
- **DLQ triage** — an agent reads dead-letter messages over MCP and *proposes* a classification or
  fix; a human approves before anything is replayed or changed.
- **Streaming agents** — agents that observe stream and operational state through MCP tools.

## 4c. Assistive, not autonomous

- **Human-in-the-loop:** propose → review → approve → apply. Autonomous production changes are the
  wrong architecture.
- **Audited, reversible, kill-switched:** every agent action logged; a kill-switch stops agent
  activity at once.

## 4d. Design considerations

- **Least privilege per tool** — each tool exposes the minimum capability; read-only and mutating
  tools separated, mutating ones gated behind approval.
- **Auth and tenancy** — decide who the agent acts as, give it scoped credentials, keep an audit trail
  of every call made on someone's behalf.
- **Idempotency** — proposed actions are reviewable and safely re-appliable; a retry or second
  approval cannot apply them twice.
- **Observability** — agent actions as first-class events, even streamed back into Kafka, so the
  audit trail is observable like any other data.

---

# Section 5 — Reference architecture

```
 Sources ──REST/Connect──▶ Kafka topics ──▶ Flink SQL ──▶ Kafka topics ──▶ sinks
                              │                  │  │                         │
                              │            (in-SQL          ┌──────────┐      │
                              │           inference UDF)──▶  │ model     │     │
                              │                  │           │ endpoint  │     │
                              │                  ▼           └──────────┘      │
                              │           feature compute ──▶ online store ──▶ serving
                              │                                                │
                              ▼                                                ▼
                          Schema Registry (contracts)                       DLQ
                              ▲                                                │
                              │                                                ▼
                    ┌─────────┴───────────  MCP tool layer  ──────────────────┐
                    │  inspect topics/schemas · NL→Flink SQL · DLQ triage      │
                    │  (assistive · human-approved · audited · kill-switch)    │
                    └──────────────────── agent / copilot ────────────────────┘
```

Streams in → governed by Schema Registry contracts → transformed and enriched in Flink with
in-stream or sidecar inference → features served fresh and skew-free → sinks and a DLQ — all
inspectable and assistable through a governed, human-approved MCP layer.

See also [Flink SQL on Confluent](./confluent-flink-sql.md) for windowing and joins.

---

## Self-test

Without notes: (a) name the four inference patterns and the trade-off that selects each; (b) explain
train/serve skew and how Kafka + Flink feed online and offline features consistently; (c) define MCP
as a governed tool-access layer and list the tools a streaming platform would expose; (d) state the
assistive, human-approved, audited, kill-switched design and why it is the right architecture.
