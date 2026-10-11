---
title: Flink SQL on Confluent
summary: Stateful stream processing in Flink SQL — changelog semantics, event time and watermarks, windowing TVFs, the four join types, deduplication, UDFs and operations on the managed Confluent service.
---

## Frame

Three mental models:

1. **Streaming SQL is batch SQL plus time and state.** Every hard Flink SQL question — windows,
   joins, deduplication, late data — reduces to two: *when is a row complete?* and *how much must be
   remembered?* Answer those and the rest derives.
2. **Confluent Flink is managed, SQL-first and Kafka-native.** On Confluent Cloud you write Flink SQL
   against tables that *are* Kafka topics, with Schema Registry as the catalog. You do not manage a
   JobManager/TaskManager topology or tune RocksDB. Your leverage is in SQL semantics and data
   contracts, not operations.
3. **ksqlDB → Flink is Confluent's stated direction.** Flink is the strategic stream-processing
   layer; ksqlDB is in maintenance. The concepts (streams vs tables, windowed aggregation, push
   queries) carry over almost one-to-one.

See also [Confluent Platform, Connectors and Schema Governance](./confluent-platform-and-connectors.md).

---

# Section 1 — Where Flink sits

## 1a. The two Flink surfaces

- **Apache Flink** — the open-source distributed stream processor: DataStream API (low level),
  Table API and Flink SQL. You deploy and tune JobManagers and TaskManagers, state backends
  (RocksDB), checkpoints to object storage and parallelism yourself.
- **Confluent Cloud for Apache Flink** — a **fully managed, serverless** offering, used almost
  entirely through Flink SQL (plus a Table API). No cluster to size; you submit **statements** that
  run as managed long-lived jobs.

On the managed service the unit of work is a **statement**, not a cluster. A statement is a
long-running job; deploying it is the deployment. That changes CI/CD, versioning and cost: billing is
per-statement CFU consumption, not per-cluster capacity.

## 1b. Flink vs the alternatives

| Engine | What it is | When it wins |
|---|---|---|
| **Flink SQL** | SQL-first, exactly-once, true event time, unified batch and stream | Complex joins, stateful processing, event-time windowing |
| **ksqlDB** | Kafka-native streaming SQL, simpler model | Lightweight Kafka-to-Kafka transforms; in maintenance at Confluent |
| **Kafka Streams** | JVM **library** embedded in your app | Stream processing inside one microservice with no extra infrastructure |
| **Spark Structured Streaming** | Micro-batch streaming on Spark | Already on Spark/Databricks; tolerant of micro-batch latency; unified with batch ETL |

- **vs ksqlDB** — same streams-vs-tables model; Flink adds interval, temporal and lookup joins, real
  event-time windowing with watermarks, Java/Python UDFs, and unified batch and stream.
- **vs Kafka Streams** — Streams is a library you embed and operate (you own scaling and
  rebalancing); Flink is a platform with managed state and a SQL front door. Streams when the logic
  belongs to one service team; Flink for shared, governed pipelines.
- **vs Spark Structured Streaming** — Spark is micro-batch at heart; Flink processes
  record-at-a-time with first-class event time and watermarks — the cleaner model for sub-second,
  ordered, stateful joins.

## 1c. The Confluent Flink object model

- **Catalog → Database → Table** maps to **Environment → Kafka cluster → Topic**. A Flink table is a
  Kafka topic with a schema. Nothing is loaded: querying reads the topic; inserting writes it.
- **Statement** — a running SQL job (e.g. `INSERT INTO … SELECT …`), long-lived, consuming CFUs.
- **Schema Registry** is the source of truth for column types; evolve a schema and its
  compatibility rules apply.

---

# Section 2 — Streams vs tables, and changelog semantics

## 2a. Append streams vs changelog (updating) streams

- **Append-only stream** — every row is a new fact; nothing is retracted. A filter or projection
  over a topic is append-only and maps cleanly onto a plain Kafka topic.
- **Updating (changelog) stream** — rows can be inserted, updated and deleted. A non-windowed
  `GROUP BY` produces an updating result: as events arrive the running total changes, emitting
  retract (`-`) then update (`+`) rows.

You cannot write an updating stream into a plain topic and expect append-only consumers to be
correct; you need an **upsert** sink (keyed, compacted topic) where the latest value per key wins.
Confluent models this as the table's changelog mode (`append` vs `upsert`/`retract`). This is the
most common "why is my output wrong or duplicated?" gotcha. The first design question on any Flink
job: **is my result append-only or updating?** That decides the sink.

## 2b. Stream-table duality

A table is the current state implied by replaying a stream; a stream is the changelog of a table.

---

# Section 3 — Time and watermarks

## 3a. Three notions of time

- **Event time** — when the event happened (a timestamp in the record). Reproducible on replay; the
  correct basis for analytics.
- **Processing time** — when Flink processes it. Simple, but non-deterministic and wrong under
  replay or backfill.
- **Ingestion time** — when it entered Kafka. A middle ground, rarely the right answer.

Default to event time whenever results must be reproducible on replay.

## 3b. Watermarks

A **watermark** asserts that *no more events with timestamp ≤ T are expected* — how an unbounded
stream decides a window is complete and can emit.

```sql
CREATE TABLE orders (
  order_id   STRING,
  amount     DECIMAL(10,2),
  event_time TIMESTAMP(3),
  WATERMARK FOR event_time AS event_time - INTERVAL '5' SECOND
) WITH ('changelog.mode' = 'append');
```

The watermark trails the maximum event time seen by 5 seconds: wait up to 5 s for stragglers;
anything later is late.

The trade-off is **latency vs completeness**. A larger out-of-orderness bound catches more late
events but adds latency and buffered state. Set it from the observed p99 lateness of the source,
not a guess.

## 3c. Late data — three options

1. **Drop it** (default) — events past the watermark are discarded.
2. **Allowed lateness / side output** — keep updating a window for a grace period, or route late
   events to a side output for reconciliation.
3. **Reprocess** — replay the topic with a wider watermark.

Each has a cost; naming it is the point.

---

# Section 4 — Windowing

Flink uses **windowing table-valued functions (TVFs)** — `TUMBLE`, `HOP`, `CUMULATE`, `SESSION` —
which add `window_start` and `window_end` columns to group by, replacing the older grouped-window
syntax.

## 4a. Tumbling (fixed, non-overlapping)

Each event in exactly one bucket. "Revenue per minute."

```sql
SELECT window_start, window_end, SUM(amount) AS revenue
FROM TABLE(
  TUMBLE(TABLE orders, DESCRIPTOR(event_time), INTERVAL '1' MINUTE)
)
GROUP BY window_start, window_end;
```

## 4b. Hopping (fixed size, overlapping)

A fixed window that advances by a smaller slide; each event lands in several windows. "Five-minute
revenue, refreshed every minute."

```sql
SELECT window_start, window_end, SUM(amount) AS revenue
FROM TABLE(
  HOP(TABLE orders, DESCRIPTOR(event_time), INTERVAL '1' MINUTE, INTERVAL '5' MINUTE)
)
GROUP BY window_start, window_end;
```

Slide first, then size.

## 4c. Cumulating (growing to a maximum)

Windows that grow by a step up to a maximum — "running total since start of day, emitted every
hour."

## 4d. Session (gap-based)

Windows bounded by an **inactivity gap** — "a session ends after 30 minutes of no activity." Length
is data-driven.

Choosing a window type is a question about how the metric is consumed: tumbling for reporting
buckets, hopping for smoothed rolling metrics, cumulating for intraday running totals, session for
activity-bounded grouping.

---

# Section 5 — Joins

A naive streaming join must remember everything forever, so every join type is really an answer to
*how much state, bounded how?*

## 5a. Regular join

`a JOIN b ON …` with no time bound. Both sides are held in state **indefinitely**, so any future row
can match any past row. Correct, but state grows unbounded; production needs **state TTL**. Use only
when both sides are small or slow-changing.

## 5b. Interval join

A stream-stream join constrained to a time range between the two event times, so state is
reclaimed once outside it. The bounded, scalable default.

```sql
SELECT o.order_id, s.shipment_id
FROM orders o JOIN shipments s
  ON o.order_id = s.order_id
 AND s.event_time BETWEEN o.event_time AND o.event_time + INTERVAL '1' HOUR;
```

## 5c. Temporal join (as-of)

Joins each event to the **version of a table valid at the event's time** — the FX rate or price as
it was at order time.

```sql
SELECT o.order_id, o.amount * r.rate AS amount_usd
FROM orders o
JOIN currency_rates FOR SYSTEM_TIME AS OF o.event_time AS r
  ON o.currency = r.currency;
```

Correct under replay (it uses the rate as of the event, not now), and how you enrich against a
slowly-changing dimension fed by CDC.

## 5d. Lookup join

Queries an external system (a JDBC database, a key-value store) per event instead of holding the
dimension in Flink state. The trade-off: **state in Flink (temporal join — replayable, fast) vs
lookup (fresh, but an external dependency with latency, source load, and no replayability).**

| Join type | State | Use when |
|---|---|---|
| Regular | Unbounded (needs TTL) | Both sides small or slow |
| Interval | Bounded by time range | Two streams correlated within a time bound |
| Temporal (as-of) | Versioned dimension | Enrich with the value valid at event time |
| Lookup | None in Flink (external) | Dimension lives in a database; freshness over replayability |

---

# Section 6 — Stateful processing, deduplication, Top-N

## 6a. What "stateful" means

Any operator that remembers across events: aggregations, joins, dedup, pattern matching. The
managed service checkpoints state for exactly-once — you do not tune RocksDB — but you own the
**logical** state size, which drives cost and latency. Keep it **bounded**: time windows, TTL, and
keys of finite cardinality.

## 6b. Deduplication

Keep the first (or last) row per key by event time with `ROW_NUMBER()`:

```sql
SELECT * FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY event_time) AS rn
  FROM orders
) WHERE rn = 1;
```

This turns an at-least-once source into a clean stream; keeping the first row stays append-only.

## 6c. Top-N

`ROW_NUMBER() OVER (PARTITION BY … ORDER BY metric DESC)` with `rn <= N` gives streaming Top-N — an
**updating** result that needs an upsert sink. Over a window TVF it becomes "top 5 products per
hour".

---

# Section 7 — UDFs and custom functions

## 7a. Function taxonomy

| Kind | Input → output | Example |
|---|---|---|
| **Scalar (UDF)** | one row → one value | normalise a phone number, mask an email |
| **Table (UDTF)** | one row → many rows | explode a JSON array into rows |
| **Aggregate (UDAF)** | many rows → one value | custom weighted average or percentile |
| **Process / async** | advanced lifecycle, async I/O | async enrichment against an external API |

## 7b. A scalar UDF (Java)

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

On Confluent Cloud a custom function is packaged as a JAR, uploaded as an artifact, and registered
in SQL:

```sql
CREATE FUNCTION mask_email AS 'com.example.MaskEmail'
  USING JAR 'confluent-artifact://<artifact-id>';

SELECT order_id, mask_email(customer_email) AS email FROM orders;
```

Managed Flink supports Java and Python UDFs. A masking UDF also tells a governance story: PII
redacted in-stream.

## 7c. Design points

- **Determinism** — UDFs must be deterministic for replay correctness. One that calls `now()` or a
  remote API breaks reproducibility; use async or lookup patterns for I/O.
- **Types** — argument and return types map onto Flink's type system; wrong type hints give runtime
  surprises.
- **Where logic belongs** — keep SQL declarative; reach for a UDF only when SQL cannot express the
  logic cleanly; I/O-heavy enrichment belongs in a separate lookup or async job.

---

# Section 8 — A minimal end-to-end exercise

To make the concepts concrete, build:

1. a source table with an event-time column and a watermark (Section 3b);
2. one stateful statement — a `TUMBLE` or `HOP` aggregation, or an interval/temporal join;
3. one scalar UDF used inside that statement;
4. a sink topic whose type (append or upsert) matches the changelog mode of the result — and be able
   to say why.

---

# Section 9 — Operations, cost and CI/CD

- **Cost** — statements consume **CFUs** (Confluent Flink Units); long-running stateful jobs and big
  joins cost more. Cost discipline is bounded state (windows, TTL), early column pruning and avoiding
  unbounded regular joins.
- **Exactly-once boundary** — checkpointed state gives exactly-once *within* Flink; end to end it
  also needs idempotent or transactional sinks.
- **Schema evolution** — tables are Schema Registry-backed, so statement correctness depends on
  compatibility modes; a breaking change can fail a running statement.
- **Statements as code** — source-controlled, reviewed, promoted dev → prod.
- **Reprocessing / backfill** — replay from an earlier offset with a wider watermark; event-time
  design is what makes this safe.

---

## Self-test

Without notes: (a) explain append vs updating streams and what each implies for the sink; (b) set a
watermark and justify the bound; (c) pick and write a window TVF for a given metric; (d) choose
between regular, interval, temporal and lookup joins and say how each bounds (or does not bound)
state; (e) write and register a scalar UDF; (f) state where exactly-once ends.
