---
title: Kafka → AI/ML & MCP Integration Patterns — Architect's Guide
summary: The four ways to put a model next to a stream, how Kafka feeds a feature store, and where MCP fits as an assistive tool layer.
topic: streaming
format: guide
tags: [kafka, mcp, inference, feature-store, flink, streaming-ml, agents]
updated: 2026-08-07
---

## Frame

Connecting real-time streams to model inference pipelines, feature stores and
MCP servers is a design problem with a surprisingly small solution space — but
the patterns are rarely written down together, so teams tend to rediscover them
one at a time. This guide organises them into a pattern language you can teach in
an architecture review: the ways to place a model next to a stream, how the
feature store fits, and where a tool-access protocol like MCP belongs.

Three mental models to hold going in:

1. **There are only a handful of ways to put a model next to a stream.** Once
   you can name them — inference-in-stream, sidecar/microservice inference,
   async external call, and offline scoring written back — every "how would you
   do real-time AI?" question becomes a selection problem, not an open-ended
   one. Section 2 is that menu.
2. **The feature store exists to solve *one* problem: train/serve skew.** The
   features a model saw in training must match the features it sees at inference.
   Kafka is the natural backbone for the *online* side of that. If you can
   explain online vs offline features and how Kafka feeds both, you've covered
   80% of the feature-store conversation.
3. **MCP is a *tool-access protocol*, and assistive beats autonomous.** This is
   both the responsible-AI position and, on a streaming platform, the correct
   architecture. A copilot or DLQ-triage agent **proposes**; an engineer reviews,
   approves, applies; nothing activates without explicit confirmation;
   everything is audited behind a kill-switch. That constraint is a design
   decision worth defending, not a limitation to apologise for.

---

# Section 1 — The two halves of "real-time AI" on a stream

Split every conversation into:

- **Inference path** — applying a *trained* model to live events to produce a
  prediction/score/embedding/decision in (near) real time. "Score this
  transaction for fraud as it arrives."
- **Feature/training path** — turning streams into the *features* models learn
  from and serve on, keeping online and offline consistent. "Compute the
  customer's 1-hour spend so both training and serving see the same number."

Architects who blur these two sound junior. Keep them separate and you can
reason about latency, consistency, and failure independently.

---

# Section 2 — Inference patterns (the menu)

The core design choice: **where does the model run relative to the stream
processor?** Four patterns, with the trade-off that picks each.

| Pattern | How | Wins when | Cost / risk |
|---|---|---|---|
| **Inference-in-stream (embedded/UDF)** | Model called *inside* the stream processor — a Flink UDF / in-SQL inference function | Lowest latency, simplest topology, small/medium models | Couples model lifecycle to the job; big models bloat the operator |
| **Sidecar / microservice inference** | Stream calls a model-serving service (KServe, Seldon, SageMaker/Vertex endpoint, Triton) | Independent model deploy/scale, GPU serving, polyglot models | Network hop; service availability now in the data path |
| **Async external call** | Stream issues async I/O to an inference API; results stitched back | High-latency models, third-party LLM APIs, batchable calls | Ordering/timeout handling; backpressure management |
| **Offline scoring → write-back** | Batch/ML platform scores, writes results back to a Kafka topic the stream joins | Heavy models, no hard latency need, precomputed scores | Staleness; not "real-time" inference, it's served lookups |

**In-SQL inference functions** are the cleanest expression of the
*inference-in-stream* pattern: *"a Flink SQL statement calls an inference
function in-line, so scoring happens in the stream with no extra service in the
data path. When the model is large or GPU-bound, move it to a served endpoint and
call it async — same SQL, the function just points at a sidecar."* Being able to
say that, and say why you would switch, is the whole menu in one sentence.

## 2a. The decision rule

- **Small/medium, low-latency, deterministic** → inference-in-stream (UDF /
  in-SQL function).
- **Large / GPU / independently versioned** → served endpoint, called sync
  (low latency) or async (tolerant latency).
- **LLM / third-party API / expensive** → async with timeouts, batching, and a
  fallback path.
- **No real-time need** → score offline, write results to a topic, join as a
  lookup/temporal dimension (ties to the Flink joins in guide #1).

## 2b. Embeddings & RAG over a stream

Modern angle worth having ready: stream → **embed** (an embedding model as a
UDF/sidecar) → write vectors to a vector store / topic → retrieval for RAG.
The discipline that makes this work: retrieval-augmented, evaluated, and
human-in-the-loop — in that order.

---

# Section 3 — Feature stores

## 3a. The one problem they solve: train/serve skew

A model trained on "customer's average order value over 30 days" must, at
serving time, get that *same* feature computed the *same* way. If training uses a
SQL batch job and serving uses hand-written app code, they drift — and the model
silently degrades. A feature store is the shared definition + storage so both
sides agree.

## 3b. Online vs offline features

| | Offline store | Online store |
|---|---|---|
| **Purpose** | Training data, batch scoring | Low-latency serving at inference |
| **Storage** | Data lake / warehouse (Parquet, Delta, BigQuery) | Key-value (Redis, DynamoDB, Cassandra) |
| **Access** | High-throughput, high-latency OK | Single-key, millisecond lookups |
| **Kafka's role** | Source events land → batch features | **Stream computes features → upserts online store** |

The Kafka story: **streaming feature computation.** A Flink job consumes raw
events, computes windowed/aggregated features (1-hour spend, rolling counts —
exactly the windowing from guide #1), and **upserts them to the online store**
(and/or a compacted topic) for millisecond serving, while the same definitions
populate the offline store for training. *"Kafka + Flink is how I keep the online
feature fresh and consistent with the offline definition — same windowed
aggregation feeds both, so there's no train/serve skew."*

## 3c. The tools worth knowing by name

**Feast** (open-source, the common reference), **Tecton**, and the cloud-native
ones (SageMaker / Vertex feature stores). Feast is the best mental model to hold,
since its concepts are the ones the others rename. Worth keeping distinct: the
*Kafka/Flink feature-computation* side that feeds a store is a different skill
from operating a managed feature platform, and experience in one does not imply
the other.

---

# Section 4 — MCP (Model Context Protocol) in a streaming platform

## 4a. What MCP actually is

**MCP is an open protocol for giving an LLM/agent controlled access to tools,
data, and context** — a standard way to expose "here are the actions and
resources you may use" to a model, so the model can call them in a structured,
auditable way. Think of it as a **typed, governed tool-API layer between an
agent and your systems**. (You use MCP servers daily — Atlassian, Slack,
Datadog, Drive are MCP servers in this very environment; that's a credible
real-world reference.)

In a Kafka context, MCP servers expose **streaming operations as tools**: "list
topics," "inspect a schema," "explain this DLQ message," "draft a Flink SQL
transform," "show consumer lag." An agent (or a human via a copilot) calls those
tools to *reason about and assist with* the platform.

## 4b. The MCP layer, named as a pattern

A streaming platform's AI-assist layer is, concretely, a set of MCP-exposed tools:

- **NL→Flink SQL copilot** — natural-language intent → a *proposed* Flink SQL
  transform the engineer reviews and applies.
- **In-SQL inference functions** — models callable from SQL (the
  inference-in-stream pattern, Section 2).
- **DLQ triage** — an agent reads dead-letter messages over MCP, *proposes* a
  classification/fix; a human approves.
- **Streaming agents over MCP** — agents that observe stream/operational state
  through MCP tools.

The architecture sentence: *"expose streaming operations as MCP tools, so an
assistive agent can inspect topics, schemas, and DLQs and propose
transforms — but every action is a proposal an engineer approves; nothing
mutates the platform without explicit human confirmation, and every step is
audited with a kill-switch."*

## 4c. The responsible-AI guardrail (critical)

Three constraints that should be architectural, not aspirational:

- **Assistive, human-in-the-loop.** Propose → review → approve → apply. An agent
  that makes production changes autonomously is a different risk class, and
  should be designed as one deliberately rather than arrived at by drift.
- **Audited, reversible, kill-switched.** Every agent action logged; a
  kill-switch stops it.
- **Scoped to what it can prove.** Agent output is a proposal until something
  verifies it — the verification step is the design, not an afterthought.

For any responsible-AI review this framing is the point of the exercise, not a
concession extracted during it.

## 4d. MCP design considerations to discuss

- **Least privilege per tool** — each MCP tool exposes the *minimum* capability;
  read-only tools vs mutating tools clearly separated, mutating ones gated.
- **Auth & tenancy** — who the agent acts as, scoped credentials, audit trail.
- **Determinism & idempotency** — proposed actions should be reviewable and
  safely re-appliable.
- **Observability** — agent actions as first-class events (you can even stream
  agent decisions back into Kafka for audit — a neat, on-brand detail).

---

# Section 5 — End-to-end reference architecture (draw this on the whiteboard)

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

The story it tells: streams in → governed by contracts → transformed/enriched in
Flink with in-stream or sidecar inference → features served fresh and
skew-free → everything inspectable and assistable via a *governed, human-in-the-
loop* MCP layer. That is the whole of AI/ML integration design on a streaming
platform, drawn as one picture.

---

# Section 6 — Check yourself

1. *"How would you score events in real time?"* → the four-pattern menu
   (Section 2); pick inference-in-stream for small/low-latency, sidecar/async for
   large/LLM; name the latency trade-off.
2. *"How do you avoid train/serve skew?"* → shared feature definitions; Kafka +
   Flink computes the online feature with the same windowing that feeds the
   offline store (Section 3).
3. *"What is MCP and why use it here?"* → governed tool-access protocol; exposes
   streaming ops as tools for an assistive agent; cite the MCP servers you use
   daily (Section 4a).
4. *"Is the AI making changes autonomously?"* → no — propose/review/approve/
   apply, audited, kill-switched; the responsible-AI framing (Section 4c). This
   is the single most important answer to get right.
5. *"Online vs offline features?"* → serving (KV, ms lookups) vs training
   (lake/warehouse); Kafka feeds both (Section 3b).
6. *"Where would you NOT use real-time inference?"* → heavy models with no
   latency need → score offline, write back, join as a lookup (Section 2a) —
   knowing when *not* to is senior signal.
7. *"How do you make agent actions safe in production?"* → least-privilege
   tools, mutating actions gated, full audit, idempotent re-apply, kill-switch
   (Section 4d).

---

## One-paragraph self-test

If you can, without notes, (a) name the four inference patterns and the
trade-off that selects each, (b) explain train/serve skew and how Kafka+Flink
feeds online and offline features consistently, (c) define MCP as a governed
tool-access layer and name the tools it should expose, and (d) state the
assistive / human-in-the-loop / audited / kill-switched framing crisply — you
have the whole of streaming-plus-ML integration design. The patterns are few; the
discipline is in choosing between them deliberately and defending the choice.
