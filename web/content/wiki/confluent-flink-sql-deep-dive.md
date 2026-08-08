---
title: Confluent Flink SQL — Architect's Deep Dive
summary: Stateful operations, windowing, watermarks, the four join kinds, and custom UDFs — streaming SQL as batch SQL plus time and state.
topic: streaming
format: deep-dive
tags: [flink, confluent, streaming-sql, windowing, watermarks, udf, ksqldb]
updated: 2026-08-07
---

## Frame

Flink SQL is the deepest surface in the Confluent stack, and the one where
adjacent experience — Kafka Streams, ksqlDB, Spark Structured Streaming —
transfers in concept but not in syntax or failure modes. This guide does two
jobs:

1. **Make it runnable.** Enough Flink SQL to deploy one stateful/windowed
   statement plus one custom UDF end to end, rather than reading about them.
2. **Make it explainable.** Equip you to reason out loud about state, time,
   watermarks, joins, and the failure modes — which is what separates
   understanding the model from having copied a windowing snippet.

Three mental models to hold going in:

1. **Streaming SQL is batch SQL plus *time and state*.** Every hard question
   in Flink SQL — windows, joins, deduplication, late data — is really a
   question about *when is a row complete?* and *how much do I have to
   remember?* If you can always answer those two, you can derive the rest.
2. **Confluent Flink is managed, SQL-first, and Kafka-native.** On Confluent
   Cloud you write Flink **SQL** against tables that *are* Kafka topics, with
   Schema Registry as the catalog. You are not managing a Flink cluster, a
   JobManager/TaskManager topology, or RocksDB tuning — Confluent runs the
   engine. Your leverage is in the SQL semantics and the data contracts, not
   ops. This matters: most Flink lore online is about operating the engine, and
   on the managed surface almost none of it applies.
3. **ksqlDB → Flink is Confluent's own stated direction.** Confluent has
   positioned **Flink as the strategic stream-processing layer**, with ksqlDB
   in maintenance. Your ksqlDB production experience is *transferable
   credibility*, not a dead end — the concepts (streams vs tables, windowed
   aggregation, push queries) map almost one-to-one. ksqlDB production
   experience is *transferable credibility*, not a dead end.

The organizing order below follows the way the problem actually decomposes:
stateful operations, then windowing, then joins, then custom Flink functions.

---

# Section 1 — Where Flink sits in Confluent

## 1a. The two Flink surfaces (say both names)

- **Apache Flink** — the open-source distributed stream processor: DataStream
  API (Java/Scala, low-level), Table API, and Flink SQL. You'd deploy and tune
  a JobManager + TaskManagers, configure state backends (RocksDB), checkpoints
  to S3/GCS, and parallelism yourself.
- **Confluent Cloud for Apache Flink** — a **fully managed, serverless** Flink
  offering. You interact almost entirely through **Flink SQL** (and a Table API
  surface). No cluster to size; you submit **statements** that run as managed
  long-lived jobs. Tables map to Kafka topics; the catalog is your **environment
  → Kafka cluster → topic**, with schemas from **Schema Registry**.

Architect framing: *"On Confluent Cloud the unit of work is a Flink SQL
**statement**, not a cluster. A statement is a long-running job; deploying it is
the deployment. That changes how you think about CI/CD, versioning, and cost —
it's per-statement CFU consumption, not per-cluster capacity."*

## 1b. Flink vs the alternatives you've actually run

| Engine | What it is | When it wins |
|---|---|---|
| **Confluent Flink SQL** | Managed, SQL-first, exactly-once, true event-time, unified batch+stream | The COE default — complex joins, true stateful processing, windowing on event time, broad connector reach |
| **ksqlDB** | Kafka-native streaming SQL, simpler model | Lightweight Kafka-to-Kafka transforms; now maintenance-mode at Confluent |
| **Kafka Streams** | JVM **library** embedded in your app, not a service | You want stream processing *inside* a microservice with no extra infra |
| **Spark Structured Streaming** | Micro-batch (mostly) streaming on Spark | Already on Spark/Databricks; tolerant of micro-batch latency; unified with batch ETL |

Honest distinctions to voice:
- **vs ksqlDB** — same streams-vs-tables mental model; Flink adds far richer
  joins (interval, temporal, lookup), real event-time windowing with
  watermarks, UDFs in Java/Python, and unified batch+stream. *"ksqlDB got me
  90% of the Kafka-to-Kafka transforms; Flink is what I reach for when joins
  and event-time correctness get hard."*
- **vs Kafka Streams** — Streams is a *library* you embed and operate inside an
  app (you own scaling, rebalancing); Flink is a *platform* with managed state
  and a SQL front door. Architect's call: Streams when the logic belongs to one
  service team; Flink when it's a shared COE-governed pipeline.
- **vs Spark Structured Streaming** — Spark is micro-batch at heart (continuous
  mode is limited); Flink is true record-at-a-time with first-class event-time
  and watermarks. For sub-second, ordered, stateful joins, Flink is the cleaner
  model.

## 1c. The Confluent Flink object model

- **Catalog → Database → Table.** In Confluent Cloud these map to **Environment
  → Kafka cluster → Topic**. A Flink **table is a Kafka topic** with a schema.
  You don't "load" data — querying a table reads the topic; inserting writes it.
- **Statement** — a running SQL job (e.g. an `INSERT INTO … SELECT …`). It's
  long-lived and consumes compute (CFUs).
- **Schema Registry** is the catalog's source of truth for column types. Create
  a table and Confluent registers/uses a subject; evolve the schema and
  compatibility rules apply (ties directly to your Schema Registry governance
  story in guide #3).

---

# Section 2 — Streams vs tables, and changelog semantics

This is the conceptual spine. Get it right and everything downstream follows.

## 2a. Append streams vs changelog (updating) streams

Flink SQL results are one of two kinds:

- **Append-only stream** — every row is a new fact; nothing is ever retracted.
  A filter/projection over a Kafka topic is append-only. Maps to a Kafka topic
  cleanly.
- **Updating (changelog) stream** — rows can be **inserted, updated, deleted**.
  A non-windowed `GROUP BY` aggregation produces an updating result: as new
  events arrive, the running total changes, emitting *retract* (`-`) then
  *update* (`+`) rows internally.

Why an architect cares: **you cannot naively write an updating stream into a
normal Kafka topic** and expect downstream append-only consumers to be correct —
you need an **upsert** sink (keyed, compacted topic) so the latest value per key
wins. Confluent Flink models this with the **changelog mode** of a table
(`append` vs `upsert`/`retract`). This is the single most common "why is my
output wrong / duplicated?" gotcha. Say: *"The first design question on any
Flink job is: is my result append-only or updating? That decides the sink topic
config — plain topic vs compacted upsert topic — and whether downstream can be
append consumers."*

## 2b. The dynamic-table duality

A Kafka topic ↔ a Flink table is the **stream-table duality**: a table is the
current state implied by replaying the stream; a stream is the changelog of the
table. ksqlDB taught you this (`STREAM` vs `TABLE`); the Flink version is the
same idea with sharper changelog semantics.

---

# Section 3 — Time and watermarks (the foundation of stateful streaming)

If you only deeply master one section, make it this one — it underpins windows,
joins, and "why is my result late / wrong."

## 3a. Three notions of time

- **Event time** — when the event actually happened (a timestamp *in* the
  record). The only correct basis for analytics; immune to reprocessing and
  delays.
- **Processing time** — when Flink happens to process it. Simple, but
  non-deterministic and wrong under replay/backfill.
- **Ingestion time** — when it entered Kafka. A middle ground, rarely the right
  answer.

Architect rule: **default to event time.** *"If results must be reproducible on
replay — and in a regulated COE they must — you window on event time, full
stop."*

## 3b. Watermarks — "event time has advanced to T"

A **watermark** is Flink's assertion that *no more events with timestamp ≤ T are
expected*. It's how an unbounded stream decides a window is **complete** and can
emit. Watermarks are generated with a bounded-out-of-orderness allowance:

```sql
CREATE TABLE orders (
  order_id   STRING,
  amount     DECIMAL(10,2),
  event_time TIMESTAMP(3),
  WATERMARK FOR event_time AS event_time - INTERVAL '5' SECOND
) WITH ('changelog.mode' = 'append');
```

This says: *"emit a watermark 5 seconds behind the max event time seen — I'll
wait up to 5s for stragglers; anything later is 'late'."*

The trade-off to articulate: **latency vs completeness.** A larger
out-of-orderness bound = more correct (catches late events) but higher latency
and more buffered state. *"Watermark delay is the dial between freshness and
completeness; I set it from the p99 lateness I observe in the source, not a
guess."*

## 3c. Late data — three options

1. **Drop it** (default) — late events past the watermark are discarded.
2. **Allowed lateness / side output** — keep updating a window for a grace
   period, or route late events to a side channel for reconciliation.
3. **Reprocess** — replay the topic with a wider watermark for backfill.

Knowing these three, and naming the *cost* of each, is what "expert" sounds
like.

---

# Section 4 — Windowing

Confluent Flink uses **Windowing Table-Valued Functions (TVFs)** —
`TUMBLE`, `HOP`, `CUMULATE`, `SESSION` — rather than the older grouped-window
syntax. Know the TVF form; it's the current Confluent idiom.

## 4a. Tumbling (fixed, non-overlapping)

Fixed-size, contiguous, no overlap. "Revenue per 1-minute bucket."

```sql
SELECT window_start, window_end, SUM(amount) AS revenue
FROM TABLE(
  TUMBLE(TABLE orders, DESCRIPTOR(event_time), INTERVAL '1' MINUTE)
)
GROUP BY window_start, window_end;
```

## 4b. Hopping / sliding (fixed size, overlapping)

Fixed window that advances by a smaller slide — overlapping. "5-minute revenue,
updated every 1 minute." Each event lands in multiple windows.

```sql
SELECT window_start, window_end, SUM(amount) AS revenue
FROM TABLE(
  HOP(TABLE orders, DESCRIPTOR(event_time), INTERVAL '1' MINUTE, INTERVAL '5' MINUTE)
)
GROUP BY window_start, window_end;
```

(Slide first, then size: hop every 1 minute over a 5-minute window.)

## 4c. Cumulating (growing windows to a max)

Windows that grow by a step up to a max size — ideal for "running total since
start of day, emitted every hour." A dashboard-friendly pattern unique to the
TVF set.

## 4d. Session (gap-based, dynamic size)

Windows defined by **inactivity gaps**, not fixed size — "a user session ends
after 30 minutes of no activity." Window length is data-driven.

Architect framing for the room: *"Tumbling for non-overlapping reporting
buckets; hopping for smoothed rolling metrics; cumulating for intraday running
totals; session for activity-bounded grouping like user sessions or device
bursts. The choice is a business question about how the metric is consumed, not
a technical one."*

---

# Section 5 — Joins (where Flink earns its keep)

Joining unbounded streams is the hard part and the strongest "expert" signal.
The key realization: **a naive join must remember everything forever** — so
every streaming join is really a question about *how much state, bounded how?*

## 5a. Regular (stateful) join

Standard `a JOIN b ON …` with no time bound. Both sides are materialized as
state **indefinitely** — any future row on either side can match any past row.
Correct, but **state grows unbounded**; needs **state TTL** to be safe in
production. Use only when both sides are small/slow-changing.

## 5b. Interval join (time-bounded)

Join constrained to a time window between the two event times — state can be
**reclaimed** once outside the interval. The bounded, scalable default for
stream-stream joins.

```sql
SELECT o.order_id, s.shipment_id
FROM orders o JOIN shipments s
  ON o.order_id = s.order_id
 AND s.event_time BETWEEN o.event_time AND o.event_time + INTERVAL '1' HOUR;
```

*"Orders join shipments that occur within an hour."* The interval bound is what
makes the state finite — call that out explicitly.

## 5c. Temporal join (versioned / as-of join)

Join a stream to the **version of a table that was valid at the event's time** —
the classic "enrich each order with the FX rate / price as it was *at order
time*." Uses `FOR SYSTEM_TIME AS OF`:

```sql
SELECT o.order_id, o.amount * r.rate AS amount_usd
FROM orders o
JOIN currency_rates FOR SYSTEM_TIME AS OF o.event_time AS r
  ON o.currency = r.currency;
```

This is the join that demonstrates real command — it's correct under replay
(uses the rate as-of the event, not "now") and it's how you'd enrich against a
slowly-changing dimension fed by CDC. Have this example ready.

## 5d. Lookup join (enrich against an external table)

Join a stream to an external system (a JDBC DB, a key-value store) on demand —
"look up customer profile from Postgres per event." Trades a per-event lookup
for not holding the dimension in Flink state. The architecture trade-off:
**state-in-Flink (temporal join, replayable, fast) vs lookup (fresh, external
dependency, latency + load on the source).** Naming that trade-off explicitly is
what turns a syntax choice into an architecture choice.

| Join type | State | Use when |
|---|---|---|
| Regular | Unbounded (needs TTL) | Both sides small/slow |
| Interval | Bounded by time window | Two streams correlated within a time bound |
| Temporal (as-of) | Versioned dimension | Enrich with value valid *at event time* (FX, price) |
| Lookup | None in Flink (external) | Dimension lives in a DB; want freshness over replayability |

---

# Section 6 — Stateful processing, deduplication, Top-N

## 6a. What "stateful" actually means here

Any operator that must **remember across events** is stateful: aggregations,
joins, dedup, pattern matching. On Confluent Cloud, Flink manages this state and
checkpoints it for **exactly-once** — you don't tune RocksDB, but you *do* own
the **logical** state size, which drives cost and latency. The architect's job:
keep state **bounded** (time windows, TTL, keys with finite cardinality).

## 6b. Deduplication

Idiomatic Flink dedup keeps the **first (or last) row per key** by event time
using `ROW_NUMBER()`:

```sql
SELECT * FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY event_time) AS rn
  FROM orders
) WHERE rn = 1;
```

This is exactly the "exactly-once / idempotent ingest" pattern — dedup an
at-least-once source into a clean stream. Tie it to a real problem: *"upstream
delivers at-least-once; I dedup on the business key by earliest event time
before it hits the gold topic."*

## 6c. Top-N and windowed Top-N

`ROW_NUMBER() OVER (PARTITION BY … ORDER BY metric DESC)` with `rn <= N` gives
streaming Top-N (an *updating* result — note the changelog mode). Windowed
Top-N (over a window TVF) gives "top 5 products per hour" — a common dashboard
ask.

---

# Section 7 — UDFs and custom Flink functions

Custom functions are where Flink SQL stops being declarative and starts being
code you own. Author at least one, and be able to explain the function taxonomy.

## 7a. The function taxonomy

| Kind | Input → Output | Example |
|---|---|---|
| **Scalar (UDF)** | one row → one value | normalize a phone number, custom hash, parse a code |
| **Table (UDTF)** | one row → many rows | explode a JSON array into rows |
| **Aggregate (UDAF)** | many rows → one value | a custom weighted average / percentile |
| **(Process / async)** | advanced lifecycle/async I/O | async enrichment against an external API |

## 7b. A scalar UDF — the demo-grade example (Java)

```java
import org.apache.flink.table.functions.ScalarFunction;

public class MaskEmail extends ScalarFunction {
    public String eval(String email) {
        if (email == null) return null;
        int at = email.indexOf('@');
        if (at <= 1) return "***";
        return email.charAt(0) + "***" + email.substring(at);
    }
}
```

On **Confluent Cloud for Flink**, a custom function is packaged as a JAR and
registered as a **User-Defined Function artifact**, then created in SQL:

```sql
CREATE FUNCTION mask_email AS 'com.example.MaskEmail'
  USING JAR 'confluent-artifact://<artifact-id>';

SELECT order_id, mask_email(customer_email) AS email FROM orders;
```

Confluent Flink supports UDFs in **Java** and **Python**. For the demo, a Java
scalar UDF (masking/PII-redaction, or unit normalization) is the lowest-risk,
highest-signal choice — it's a one-class JAR and it tells a *governance* story
(PII masking in-stream) that resonates with an IBM responsible-AI/COE audience.

## 7c. What to be ready to discuss

- **Determinism** — UDFs should be deterministic for replay correctness; a UDF
  that calls `now()` or a remote API breaks reproducibility (use async/lookup
  patterns instead for I/O).
- **Serialization & types** — argument/return types map to Flink's type system;
  get the type hints right or you get runtime surprises.
- **Where logic belongs** — a UDF vs pushing logic to SQL vs a separate
  enrichment job. The architect's instinct: keep SQL declarative, reach for a
  UDF only when SQL can't express it cleanly.

---

# Section 8 — Building the runnable demo

Reading this guide will not make Flink SQL stick; deploying one statement will.
The minimum bar worth building, which exercises every earlier section at once:

1. **A source topic + table** with an event-time column and a watermark
   (Section 3b), fed by any REST→Kafka path.
2. **One stateful/windowed statement** — pick a `TUMBLE` or `HOP` aggregation
   (Section 4) **or** a temporal/interval join (Section 5). A windowed revenue
   or count-by-key aggregation is the simplest credible choice.
3. **One custom UDF** (Section 7b) used inside that statement — PII masking is
   the recommended pick.
4. **An upsert/append sink topic** chosen correctly for the changelog mode of
   your result (Section 2a) — and *be able to explain why* you chose append vs
   upsert.

What you end up with is a deployed Flink statement doing a windowed aggregation
with a custom UDF, reading and writing Kafka topics governed by Schema Registry —
small, but it exercises watermarks, state, changelog mode and function
registration in one artefact.

**One boundary worth keeping straight:** building this demonstrates
*architecture-level command made concrete*, which is a genuinely different thing
from years of running enterprise Flink in production. Managed Flink hides the
operational surface — JobManager topology, RocksDB tuning, checkpoint recovery —
so the demo teaches you the semantics and none of the operations.

---

# Section 9 — Operations, cost, and CI/CD (architect-level awareness)

Even though Confluent runs the engine, an architect owns the *consequences*:

- **Cost model** — Flink statements consume **CFUs** (Confluent Flink units);
  long-running stateful jobs and big joins cost more. Cost discipline = bounded
  state (windows, TTL), pruning columns early, avoiding unbounded regular joins.
- **State & exactly-once** — managed checkpointing gives exactly-once *within*
  Flink; end-to-end exactly-once needs idempotent/transactional sinks. Know the
  boundary.
- **Schema evolution** — because tables are Schema-Registry-backed, statement
  correctness depends on compatibility modes (guide #3). A breaking schema
  change can fail a running statement.
- **Versioning statements** — treat SQL statements as code: source-controlled,
  reviewed, promoted dev→prod. This is the CI/CD story for a COE and ties to
  your `maestro` spec-driven, PR-only delivery model.
- **Reprocessing / backfill** — replay from an earlier offset with a wider
  watermark; event-time design is what makes this safe.

---

# Section 10 — Check yourself

1. *"How do you decide window type?"* → consumption-driven: tumbling for
   reporting buckets, hopping for rolling metrics, cumulating for intraday
   running totals, session for activity gaps (Section 4).
2. *"How do you join two streams without blowing up state?"* → interval or
   temporal join to bound state; name regular-join TTL as the fallback; lookup
   join when the dimension should stay external (Section 5).
3. *"What's a watermark and how do you set it?"* → "event time has advanced to
   T"; set the out-of-orderness bound from observed p99 lateness; it's the
   latency-vs-completeness dial (Section 3).
4. *"Append vs upsert result — how do you know, and why does it matter?"* →
   windowed/dedup/first-row = append; non-windowed GROUP BY / Top-N = updating →
   compacted upsert sink (Section 2a).
5. *"Walk me through a UDF you'd write."* → the masking scalar UDF; determinism
   and type-hints caveats; package-as-JAR + `CREATE FUNCTION` on Confluent Cloud
   (Section 7).
6. *"ksqlDB or Flink?"* → Flink is Confluent's strategic direction; ksqlDB for
   simple Kafka-to-Kafka; voice the migration path from your ksqlDB production
   experience (Section 1).
7. *"Exactly-once — really?"* → exactly-once within Flink via checkpointed
   state; end-to-end needs idempotent/transactional sinks (Section 9).

---

## One-paragraph self-test

If you can, without notes, (a) explain append vs updating streams and what each
implies for the sink topic, (b) set a watermark and justify the bound, (c) pick
and write a window TVF for a given metric, (d) choose between interval, temporal,
and lookup joins and say why each bounds (or doesn't bound) state, (e) author
and register a scalar UDF on Confluent Cloud, and (f) honestly frame your Flink
depth against your ksqlDB/Streams/Spark production years — you are at the
"expert enough to architect and defend it" bar this role needs. The remaining
delta is the **runnable demo** in Section 8; finish that before submitting.
