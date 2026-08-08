---
title: PySpark & Spark Performance — Architect's Refresher
summary: Why a job is slow — shuffles, skew, AQE, partitioning and joins — and how the same PySpark behaves on Databricks, Glue and EMR.
topic: data-engineering
format: refresher
tags: [pyspark, spark, performance, shuffle, skew, aqe, databricks, glue]
updated: 2026-08-07
---

## Frame

This is a refresher, not a Spark tutorial. It assumes you've shipped PySpark and skips "what is a DataFrame." It targets the questions that actually decide whether a pipeline works at scale: why a job is slow, how shuffles and skew bite, what AQE does for free, and how the *same* PySpark runs on Databricks vs Glue vs EMR. The through-line: one execution engine, many runtimes.

Four things worth holding in your head throughout:

1. **Cost is the shuffle.** Almost every Spark performance answer reduces to "minimize and balance the shuffle." Narrow good, wide expensive. If you can say *why* a stage boundary exists, you sound senior.
2. **The plan is the truth.** "I'd read `explain()` / the Spark UI" is the correct first move for *every* slowness question. Don't guess — name the diagnostic.
3. **Push work down, pull data up late.** Filter and project early; `collect()` / `toPandas()` late and small. The driver is a single JVM — never funnel data through it.
4. **Let the engine optimize.** DataFrame API + Catalyst + AQE beats hand-tuned RDDs and most manual hints in modern Spark (3.x+). Reach for hints only when you can name the reason the optimizer guessed wrong.

Spark version assumed: **Spark 3.x** (AQE on by default since 3.2). Databricks Runtime and Glue 4.0 both ship Spark 3.3+. **Note (2026): Spark 4.0 GA'd May 2025** — the headline behavioural change is **ANSI SQL mode on by default** (stricter errors instead of silent nulls/overflow), plus Spark Connect reaching feature parity; it ships in Databricks Runtime 17.x, while Glue 5.0 is still Spark 3.5. Everything in this guide holds on 4.0; if asked "what's new in Spark 4," lead with *ANSI-by-default*.

---

## 1. Spark execution model

The mental model you must be able to draw on a whiteboard.

**Cluster topology**
- **Driver** — one JVM. Runs your `main`, builds the logical plan, schedules tasks, holds the `SparkContext`/`SparkSession`. Collects results. Single point of failure and a memory bottleneck (this is where `collect()` lands).
- **Executors** — N JVMs across worker nodes. Run tasks, hold cached data, do the actual compute. Each executor has a fixed number of **cores** (task slots) and a memory budget.
- **Cluster manager** — YARN (EMR), Kubernetes, Databricks' own, or Glue's managed allocation. Hands executors to the driver.

**Logical → physical breakdown**
```
Action (e.g. write, count, collect)
  └─ Job          one per action
       └─ Stage   bounded by shuffle (wide) boundaries
            └─ Task   one per partition, the unit of parallelism
```
- An **action** (`count`, `collect`, `write`, `show`, `take`) triggers a **job**.
- A job splits into **stages** at every **shuffle boundary**.
- Each stage runs as **tasks** — one task per partition of that stage. Tasks are what executors actually schedule onto cores. Parallelism = number of tasks that can run concurrently = total executor cores.

**Lazy evaluation & the DAG**
Transformations (`select`, `filter`, `join`, `groupBy`, `withColumn`) build a **DAG of logical operations** and execute *nothing*. Spark only plans-and-runs when an **action** fires. This is why a typo in a transformation can sit silent until the action — and why Catalyst can reorder/fuse the whole chain before running it.
```python
df2 = df.filter(F.col("amount") > 0).select("acct", "amount")  # nothing runs
df2.write.parquet("s3://.../out")                               # NOW it runs
```

**Narrow vs wide transformations**
- **Narrow** — each output partition depends on *one* input partition. No data movement. `select`, `filter`, `withColumn`, `map`, `union`. Pipelined within a stage, cheap.
- **Wide** — output partitions depend on *many* input partitions → data must move across the network → a **shuffle**. `groupBy`/agg, `join` (non-broadcast), `distinct`, `repartition`, `orderBy`, window functions.

**What a shuffle is and why it's expensive**
A shuffle re-partitions data by key across the cluster: every executor writes intermediate "shuffle files" partitioned by the target key, then every reducer task pulls its slice from every mapper. Cost drivers: **disk I/O** (spill to local disk), **network** (all-to-all transfer), **serialization**, and a hard **stage barrier** (the next stage can't start until the shuffle write completes). The default post-shuffle partition count is `spark.sql.shuffle.partitions` (historically 200) — AQE now coalesces this dynamically. "Reduce the shuffle" = the master skill.

---

## 2. DataFrame API over RDD

Why you write DataFrames/Spark SQL and almost never raw RDDs.

- **Catalyst optimizer** — rule + cost-based optimizer over the *logical* DataFrame/SQL plan: predicate pushdown, projection pruning, constant folding, join reordering, then physical-plan selection. RDDs are opaque to it — Spark can't see inside your Python lambda.
- **Tungsten** — the execution backend: off-heap, cache-aware binary layout, and **whole-stage code generation** (fuses an operator chain into one generated Java function, killing per-row virtual calls). DataFrames get this; RDDs don't.
- **Net effect**: DataFrame/Spark SQL = declarative, optimizable, columnar, code-gen'd. RDD = imperative, opaque, row-at-a-time. Use RDDs only for unstructured/custom-partitioning work you can't express in SQL.

**Idiomatic PySpark transformations** (the vocabulary you'll live-code)
```python
from pyspark.sql import functions as F, Window

# select / project + filter (predicate) + derived column
df2 = (
    df.select("acct", "amount", "posting_ts", "company_code")
      .filter((F.col("amount") > 0) & (F.col("company_code") == "DE01"))
      .withColumn("amount_eur", F.col("amount") * F.lit(1.0))
      .withColumn("posting_date", F.to_date("posting_ts"))
)

# groupBy + agg (a shuffle)
agg = (
    df2.groupBy("acct", "posting_date")
       .agg(
           F.sum("amount_eur").alias("net_amount"),
           F.count("*").alias("n_postings"),
           F.countDistinct("company_code").alias("n_cc"),
       )
)

# window: running balance per account (no collapse, unlike groupBy)
w = Window.partitionBy("acct").orderBy("posting_date") \
          .rowsBetween(Window.unboundedPreceding, Window.currentRow)
ranked = df2.withColumn("running_bal", F.sum("amount_eur").over(w))
```
Prefer **built-in `F.*` functions** over Python UDFs always (see §8) — built-ins stay inside Catalyst/Tungsten; Python UDFs break the optimization and pay a serialization tax.

---

## 3. Joins

The single richest performance topic. Know the three strategies and how to read which one Spark picked.

| Strategy | How it works | Shuffle? | Use when |
|---|---|---|---|
| **Broadcast hash join** (BHJ) | Small side shipped whole to every executor; big side stays put, probed locally | No shuffle of big side | One side small enough to fit in executor memory |
| **Shuffle hash join** (SHJ) | Both sides shuffled by key; one side built into a hash map per partition | Yes | Medium tables, one side fits in a partition's memory |
| **Sort-merge join** (SMJ) | Both sides shuffled by key, sorted, merged | Yes (+ sort) | Two large tables; the default for big-vs-big |

**Broadcast hints & thresholds**
- Auto-broadcast threshold: `spark.sql.autoBroadcastJoinThreshold`, default **10 MB**. If Spark's size estimate of one side is under it, Catalyst picks BHJ automatically.
- Force it when you *know* the side is small but stats are missing/wrong:
```python
from pyspark.sql.functions import broadcast
result = big_fact.join(broadcast(small_dim), "dim_key", "left")
```
- Set `spark.sql.autoBroadcastJoinThreshold = -1` to disable auto-broadcast (debugging, or to stop a runaway broadcast OOMing the driver/executors).

**How to recognize a bad join in the plan**
- Run `result.explain("formatted")` (or `mode="cost"`) and look at the physical operator: `BroadcastHashJoin`, `ShuffleHashJoin`, `SortMergeJoin`.
- **Bad sign 1**: a `SortMergeJoin` where one side is tiny → you wanted a broadcast; stats were missing. Fix: `ANALYZE TABLE ... COMPUTE STATISTICS`, or add `broadcast()`.
- **Bad sign 2**: `BroadcastHashJoin` on a side that's actually large → driver OOM or `OutOfMemoryError` collecting the broadcast. Fix: raise/lower threshold, or stop broadcasting.
- **Bad sign 3 (skew)**: SMJ where one task runs 50× longer than its peers in the Spark UI → skewed join key (see §4).
- **Bad sign 4 (fan-out)**: output row count explodes → many-to-many join key; the join is correct Spark-wise but wrong data-wise.

---

## 4. Data skew

When the data isn't evenly distributed across keys, a few partitions do most of the work and the stage waits on them.

**Symptoms**
- In the Spark UI stage view: one or a few tasks with **max duration / shuffle-read bytes** wildly above the median (the classic "99th percentile task = 40 min, median = 30 s").
- Stragglers; executors idle while one chews; sometimes a single-task OOM/spill.

**Isolating hot keys**
```python
(df.groupBy("join_key").count()
   .orderBy(F.desc("count"))
   .show(20))   # find the heavy hitters
```

**Salting** (the manual fix when AQE can't help, e.g. skew on a non-join aggregation, or pre-AQE engines)
Spread one hot key across `N` synthetic sub-keys, then aggregate twice:
```python
N = 16
salted = df.withColumn("salt", (F.rand() * N).cast("int"))
# stage 1: aggregate within (key, salt) — distributes the hot key
partial = salted.groupBy("join_key", "salt").agg(F.sum("amount").alias("p_sum"))
# stage 2: collapse the salt
final = partial.groupBy("join_key").agg(F.sum("p_sum").alias("total"))
```
For a skewed *join*, salt the skewed side's key and replicate the small side across all salt values.

**AQE skew-join handling (the modern default — prefer this)**
With `spark.sql.adaptive.enabled` and `spark.sql.adaptive.skewJoin.enabled` (both default true in 3.2+), AQE detects skewed partitions at runtime from shuffle statistics and **splits** the oversized partition into several, joining each piece independently — no code change. A partition is "skewed" if it exceeds `skewedPartitionFactor` × median **and** `skewedPartitionThresholdInBytes`. The architect answer: "First I'd confirm AQE skew-join is on and the side is shuffled; if AQE can't catch it (e.g. a skewed groupBy, or it's below threshold), I salt."

---

## 5. Partitioning

Two distinct meanings — keep them separate or you'll confuse the interviewer: **in-memory partitions** (units of parallelism at runtime) vs **on-disk partitioning** (directory layout of files).

**repartition vs coalesce** (in-memory)
```python
df.repartition(200)                 # full shuffle, even sizes, can increase or decrease
df.repartition(200, "acct")         # hash-partition by column (e.g. before a write or join)
df.coalesce(10)                     # NO shuffle, only DECREASES, merges adjacent partitions
```
- `repartition` = shuffle, balanced output, costs network. Use to *increase* parallelism or rebalance after a filter that left skewed partitions.
- `coalesce` = no shuffle, cheap, but can leave uneven partitions and reduces upstream parallelism (it pulls the merge up the DAG). Use to *reduce* file count just before writing.

**Partition pruning** (on-disk read optimization)
If data is laid out by `dt=` directories and you filter on `dt`, Spark reads only matching directories — skips the rest at planning time. The single biggest read-side win on a lake. **Dynamic partition pruning (DPP)** extends this to prune the fact table based on a dimension filter at join time.

**partitionBy on write**
```python
(df.write
   .partitionBy("dt", "company_code")     # creates dt=.../company_code=... dirs
   .mode("overwrite")
   .parquet("s3://bucket/gl/"))
```
- Partition on **low-cardinality, frequently-filtered** columns (date, region, source). Never on high-cardinality keys (acct_id) — you'll create millions of tiny dirs.

**Bucketing** (Spark/Hive table feature)
```python
(df.write.bucketBy(64, "acct").sortBy("acct").saveAsTable("gl_bucketed"))
```
Pre-shuffles data into a fixed number of buckets by key on write, so later joins/aggregations on that key can **skip the shuffle**. Powerful for repeated joins on the same key; rigid (fixed bucket count, must match on both sides). On Databricks, **liquid clustering** / Delta `OPTIMIZE ZORDER` is the modern alternative for data skipping.

**The small-files problem & target file sizes**
Too many tiny files → metadata/listing overhead on read, one task per file, S3 request storms. Symptoms: a "read" stage with thousands of tiny tasks. Fixes:
- `coalesce`/`repartition` before write to control output file count.
- Target **~128 MB–1 GB per file** (128 MB is a sane default; Delta auto-optimize targets ~128 MB, larger for big tables).
- On Delta/Databricks: `OPTIMIZE table [ZORDER BY (cols)]` compacts small files; **auto-optimize / optimized writes** do it on write. On Glue/EMR plain Parquet, control it yourself with partition count.

---

## 6. Adaptive Query Execution (AQE)

Spark's runtime re-optimizer. On by default since 3.2 (`spark.sql.adaptive.enabled=true`). It re-plans *during* execution using actual shuffle statistics instead of stale compile-time estimates. Three headline features — name all three:

1. **Coalescing shuffle partitions** — collapses the fixed `spark.sql.shuffle.partitions` (e.g. 200) down to a sensible number based on actual post-shuffle data size, targeting `advisoryPartitionSizeInBytes` (~64 MB default). Kills the "200 mostly-empty partitions" waste after a selective filter.
2. **Skew-join handling** — splits oversized skewed partitions at runtime (see §4).
3. **Dynamic join strategy switch** — if a side turns out smaller than estimated after a shuffle, AQE can convert a planned sort-merge join into a **broadcast join** on the fly (`demoteBroadcastHashJoin` / runtime stats).

Architect framing: "AQE means I trust the optimizer with real runtime stats; I only hand-tune shuffle partitions or hints when AQE is off (older runtime) or when I can name why its estimate is wrong." Glue 4.0 and current Databricks runtimes have AQE on.

---

## 7. Caching / persistence

`cache()` / `persist()` materializes a DataFrame so repeated actions don't recompute the whole DAG.

**When it helps**
- A DataFrame is **reused across multiple actions/branches** (e.g. one cleaned base feeding several aggregations, or iterative ML).
- Recompute cost is high (heavy upstream joins/shuffles) and the result fits in memory.

**When it hurts (the senior nuance)**
- Used **once** → pure overhead; caching costs memory + a materialization pass for no reuse.
- Evicts other data / triggers spill → can make things *slower*.
- Stale cache after source changes — you cached, then think you're querying fresh data.
- In a lazy chain, `cache()` itself is lazy; the first action pays the materialization. People forget this and "the cache didn't help" on the first run.

**Storage levels** (`from pyspark import StorageLevel`)
```python
df.persist(StorageLevel.MEMORY_AND_DISK)   # default for DataFrame.cache(): mem, spill to disk
StorageLevel.MEMORY_ONLY                   # RDD default; recompute on miss, no disk
StorageLevel.DISK_ONLY
StorageLevel.MEMORY_AND_DISK_SER           # serialized: less memory, more CPU
df.unpersist()                             # release it — do this explicitly
```
DataFrame `cache()` = `MEMORY_AND_DISK` (and stored in a compressed columnar form). Always `unpersist()` when done. For data reused across *jobs*, prefer materializing to a Delta/Parquet table over relying on cache.

---

## 8. Common pitfalls & how to debug

The "your job is slow/OOMs — diagnose it" question lives here.

**Driver vs executor OOM**
- **Driver OOM** — almost always `collect()`, `toPandas()`, `take(huge)`, a giant broadcast, or building a massive Python object on the driver. The driver is one JVM; don't funnel data through it.
- **Executor OOM** — partition too big to fit in task memory: skew (§4), a giant `groupBy`/window per key, or too few partitions (each one too large). Fixes: more/balanced partitions, AQE skew handling, salting, raise executor memory only as a last resort.

**Spill**
When a task's working set exceeds memory, Spark spills to local disk. Visible in the Spark UI stage metrics as **"Spill (memory)" / "Spill (disk)."** Some spill is fine; heavy spill = under-partitioned or skewed. Fix by increasing partition count (smaller per-task working set) before throwing memory at it.

**`collect()` / `toPandas()` on the driver**
Both pull the *entire* result to the driver. Fine for a 10-row summary, fatal for a 50 GB DataFrame. Use `.limit(n)` first, `.write` to storage for big outputs, and Arrow-optimized `toPandas()` (`spark.sql.execution.arrow.pyspark.enabled=true`) only on already-small results.

**Python UDF overhead vs pandas/Arrow UDFs vs built-ins** (high-signal answer)
- A plain **Python UDF** serializes each row to a Python worker process, runs your function row-by-row, serializes back. It's **opaque to Catalyst** (no pushdown/codegen) and slow. Avoid.
- **Built-in `F.*` functions** — always first choice; stay in the JVM, fully optimized.
- **Pandas UDFs (vectorized / Arrow UDFs)** — when you genuinely need Python (e.g. a library call), use `@pandas_udf`; data moves in **Arrow batches** and your function operates on a `pd.Series`/`DataFrame`, amortizing the serialization cost. Much faster than row-at-a-time UDFs.
```python
from pyspark.sql.functions import pandas_udf
import pandas as pd

@pandas_udf("double")
def to_eur(amount: pd.Series, rate: pd.Series) -> pd.Series:
    return amount * rate          # vectorized, Arrow batches
df = df.withColumn("eur", to_eur("amount", "fx_rate"))
```

**Exploding wide transformations**
`explode()` on an array, a cross/many-to-many join, or `crossJoin` can multiply row counts by orders of magnitude — the stage after looks fine but the data volume detonates. Check expected output cardinality before exploding.

**Reading `explain()` and the Spark UI**
- `df.explain("formatted")` — read **bottom-up**: scans/filters at the bottom, joins/aggs in the middle, exchange (=shuffle) operators mark stage boundaries. Look for `Exchange`, `*` (codegen), `PushedFilters`, broadcast vs sort-merge.
- **Spark UI → Stages**: task duration distribution (skew), shuffle read/write bytes (shuffle cost), spill columns (memory pressure), number of tasks (parallelism / small files).
- **Spark UI → SQL tab**: the visual DAG with per-operator row counts and time — fastest way to spot the expensive operator.

Diagnosis script you can recite: *"Open the Spark UI for the slow job → find the longest stage → check task-duration distribution (skew?) and shuffle/spill metrics (shuffle-bound? memory-bound?) → cross-reference the SQL plan for the operator (bad join strategy? exploded cardinality? missing partition pruning?) → fix the root cause, re-run, compare."*

---

## 9. Structured Streaming essentials

Same DataFrame API, unbounded input. Know the model even if the role is batch-heavy.

**Micro-batch model**
Structured Streaming treats a stream as an **unbounded table**; the engine runs a sequence of small batch jobs, each processing newly-arrived data and updating results incrementally. (A low-latency **continuous** mode exists but is rarely used; micro-batch is the default and what you should describe.)

**Checkpointing**
A checkpoint location (durable, e.g. S3/DBFS) stores stream **offsets + state** so a restarted query resumes exactly where it left off. Mandatory for fault tolerance and exactly-once.
```python
(stream_df.writeStream
   .format("delta")
   .option("checkpointLocation", "s3://bucket/_checkpoints/gl_stream")
   .outputMode("append")
   .trigger(availableNow=True)        # or processingTime="1 minute"
   .start("s3://bucket/gl_delta"))
```

**Watermarks & late data**
A **watermark** tells Spark how late events may arrive so it can bound state and drop data later than the threshold (otherwise stateful aggregations grow unbounded).
```python
(events.withWatermark("event_ts", "10 minutes")
       .groupBy(F.window("event_ts", "5 minutes"), "acct")
       .agg(F.sum("amount")))
```
Events later than the watermark are dropped from the aggregation. Watermarks also bound state for stream-stream joins.

**Output modes**
- `append` — only new rows; for queries where rows are final (e.g. windowed agg past the watermark). Default-friendly.
- `update` — only rows that changed this batch.
- `complete` — the entire result table every batch; only for aggregations, expensive.

**Triggers**
- `processingTime="1 minute"` — micro-batch every interval.
- `availableNow=True` — process all available data then stop (great for scheduled "incremental batch"; replaced the older `once=True`).
- default (unset) — as fast as possible, back-to-back micro-batches.

**Exactly-once**
Achieved by combining **replayable sources** (Kafka offsets, Auto Loader file tracking) + **checkpointed offsets/state** + **idempotent sinks** (Delta commits transactionally). End-to-end exactly-once requires all three; an arbitrary sink only gives at-least-once.

**Auto Loader (Databricks) vs Kafka source**
- **Auto Loader** (`cloudFiles`) — Databricks-only incremental file ingestion from cloud storage; tracks which files it has seen (via checkpoint, optionally file notification queues), handles schema inference/evolution. The idiomatic Databricks way to stream files landing in S3/ADLS.
```python
(spark.readStream.format("cloudFiles")
   .option("cloudFiles.format", "json")
   .option("cloudFiles.schemaLocation", "s3://.../_schema")
   .load("s3://bucket/landing/"))
```
- **Kafka source** — portable across all runtimes:
```python
(spark.readStream.format("kafka")
   .option("kafka.bootstrap.servers", "broker:9092")
   .option("subscribe", "gl-events")
   .option("startingOffsets", "latest")
   .load())
```

---

## 10. Where it runs — Databricks, AWS Glue, EMR

**The headline for this interview**: it's the *same PySpark / Spark SQL engine* everywhere. Your transformation code ports across runtimes; what differs is packaging, ingestion glue, optimizer extras, and a couple of Glue-specific abstractions.

| Aspect | Databricks | AWS Glue | EMR |
|---|---|---|---|
| Spark | DBR (Spark + Photon C++ engine) | Glue's managed Spark (serverless DPUs) | Open-source Spark on YARN |
| Unit | Notebooks / Jobs / DLT | Glue **jobs** + triggers/workflows | Steps / spark-submit |
| Table format | Delta Lake native; Unity Catalog | Glue Data Catalog (Hive metastore); Delta/Iceberg/Hudi supported | Hive metastore / Glue Catalog |
| Ingestion sugar | Auto Loader, COPY INTO | DynamicFrame readers, crawlers, bookmarks | plain Spark readers |
| Orchestration | Workflows / DLT / external (Airflow) | Glue Workflows, Step Functions, MWAA | Step Functions, MWAA |

**Glue DynamicFrame vs DataFrame** (a near-guaranteed probe)
- A **DynamicFrame** is Glue's wrapper over a DataFrame designed for messy, **schema-on-read** ETL. Its differentiator is the **choice/multiple-type handling**: a column with mixed types isn't forced into one schema — it keeps a "choice" you resolve with `ResolveChoice`. Plus self-describing records, no upfront schema, and transforms like `ApplyMapping`, `Relationalize`, `DropNullFields`.
- A **DataFrame** is standard Spark — strict schema, full Catalyst optimization, the whole `F.*` API.
- **Practical pattern**: read with a DynamicFrame (catalog integration, bookmarks, messy-schema tolerance), convert to DataFrame for the heavy transformation logic, convert back to write.
```python
dyf = glueContext.create_dynamic_frame.from_catalog(database="gl", table_name="raw")
df  = dyf.toDF()                                   # → Spark DataFrame for real work
# ... PySpark transformations with Catalyst ...
from awsglue.dynamicframe import DynamicFrame
out = DynamicFrame.fromDF(df, glueContext, "out")  # → back to DynamicFrame to sink
```
Senior answer: "I do correctness-light, schema-flexible ingest in DynamicFrames, then `toDF()` and do the real transformation work as DataFrames so I get the full Catalyst optimizer."

**Glue job bookmarks**
Glue's built-in **incremental-processing state**: a bookmark persists what a job already processed (by source file / by a key column) so the next run only handles new data — Glue's batch analogue to a streaming checkpoint. Enable per job; must call `job.commit()` at the end to advance the bookmark. Watch out: transformations that don't preserve the bookmark keys, or re-running with bookmarks off, cause reprocessing/duplicates.

For depth on each runtime, see the companion guides:
- **`aws-data-engineering-stack-primer.md`** — Glue, S3, Redshift, Lambda, MWAA/Airflow, Step Functions, the AWS lake stack.
- **`databricks-platform-refresher.md`** — Workspaces, Notebooks, Delta Lake, Unity Catalog, DLT, Photon, jobs/APIs.

---

## Check yourself

1. **"Your Spark job is slow / OOMs — walk me through diagnosis."** → Spark UI → longest stage → task-duration distribution (skew) + shuffle/spill metrics (shuffle- vs memory-bound) → cross-check SQL plan for bad join strategy / exploded cardinality / missing partition pruning → fix root cause → re-run & compare. Distinguish **driver** OOM (`collect`/broadcast) from **executor** OOM (big/skewed partition).
2. **"What is a shuffle and why is it expensive?"** → wide transformation re-partitions data by key across the network; disk spill + all-to-all network + serialization + a hard stage barrier. Default 200 post-shuffle partitions, now AQE-coalesced.
3. **"When is a broadcast join wrong?"** → when the "small" side isn't actually small → broadcasting a large table OOMs the driver/executors and floods the network. Also wrong if it's already cheaply co-partitioned/bucketed. Threshold default 10 MB; `broadcast()` to force, `-1` to disable.
4. **"DynamicFrame vs DataFrame in Glue?"** → DynamicFrame = Glue's schema-on-read wrapper with `ResolveChoice` for mixed types, bookmarks, catalog integration; DataFrame = strict schema + full Catalyst. Ingest as DynamicFrame, `toDF()` for real transformations.
5. **"How do you handle data skew?"** → confirm AQE skew-join is on (auto-splits skewed partitions); isolate hot keys with a `groupBy(key).count()`; salt the hot key (two-phase agg / replicate small side) when AQE can't catch it.
6. **"repartition vs coalesce?"** → repartition = full shuffle, balanced, up or down; coalesce = no shuffle, only down, can leave uneven partitions and reduces upstream parallelism. coalesce before write to cut file count; repartition to rebalance/parallelize.
7. **"How do you fix the small-files problem?"** → target ~128 MB–1 GB files; `coalesce`/`repartition` before write; Delta `OPTIMIZE`/auto-optimize; partition on low-cardinality columns only.
8. **"Why DataFrame over RDD?"** → Catalyst (optimizable logical plan, pushdown, join reordering) + Tungsten (off-heap, whole-stage codegen). RDDs are opaque to both.
9. **"What does AQE give you?"** → coalesce shuffle partitions, skew-join split, dynamic SMJ→broadcast switch — all from real runtime stats. On by default 3.2+.
10. **"Python UDF vs pandas UDF vs built-in?"** → built-ins first (in-JVM, codegen); pandas/Arrow UDFs when you must run Python (vectorized, Arrow batches); plain Python UDFs are row-at-a-time and opaque to Catalyst — avoid.
11. **"How does Structured Streaming guarantee exactly-once?"** → replayable source + checkpointed offsets/state + idempotent/transactional sink (Delta). Watermark to bound late data and state.
12. **"Same pipeline on Databricks and Glue — what changes?"** → the PySpark transformation core is identical; ingestion sugar (Auto Loader vs DynamicFrame/crawlers), incremental state (checkpoint vs bookmark), table format defaults (Delta+Unity Catalog vs Glue Catalog), and Photon on Databricks differ.

---

## Vocabulary

Drop these naturally, don't over-stuff:

- **Stage boundary / exchange** — "that `groupBy` introduces an exchange, so a new stage."
- **Predicate pushdown / projection pruning / partition pruning** — read-side wins Catalyst does for you.
- **Whole-stage codegen** — Tungsten fusing operators into one function.
- **Skew factor / straggler task** — the long-tail task in a skewed stage.
- **Spill (memory/disk)** — working set exceeding task memory.
- **Advisory partition size** — AQE's ~64 MB coalesce target.
- **Broadcast threshold** — the 10 MB auto-broadcast cutoff.
- **Watermark / late data / state store** — streaming bounding.
- **Idempotent sink / transactional commit** — exactly-once plumbing.
- **DPU** (Glue) / **DBU**, **Photon** (Databricks) — the runtime cost/perf units.
- **`ResolveChoice` / job bookmark** — Glue's schema-on-read and incremental-state tells.
- **OPTIMIZE / ZORDER / liquid clustering** — Delta file compaction & data skipping.

---

## Practice drills

Do these hands-on (Databricks Community Edition, a local `pyspark`, or a small Glue job). Narrate the plan as you go.

1. **Read a plan.** Take any two-table join, call `.explain("formatted")`, and identify: the join strategy, where the `Exchange` (shuffle) boundaries are, and which filters were pushed down. Then force the opposite join strategy with `broadcast()` / threshold `-1` and re-read.
2. **Manufacture and fix skew.** Build a DataFrame where 90% of rows share one join key. Join it, observe the straggler task in the Spark UI. Fix it once with AQE skew-join, once with salting. Compare stage timings.
3. **Small-files repro.** Write a DataFrame with `repartition(1000)` to Parquet, note the file count and a slow re-read. Rewrite with `coalesce` to ~target size; compare read time and task count.
4. **UDF vs built-in vs pandas UDF.** Implement the same per-row transform three ways (Python UDF, `F.*` built-ins, `@pandas_udf`); time each on a few million rows. Internalize the gap.
5. **Streaming + checkpoint.** Stand up an Auto Loader (or `rate` source) stream writing to Delta with a checkpoint; kill and restart it; confirm it resumes without duplicates. Add a watermarked windowed aggregation and feed it late data.
6. **Glue round-trip.** In a Glue job: read a catalog table as a DynamicFrame, `ResolveChoice` a mixed-type column, `toDF()`, do a PySpark aggregation, `fromDF()`, write — with **job bookmarks on**. Re-run and confirm only new data is processed.

---

## Things to skip

Don't burn prep time here — low probability for this architect round, or genuinely obsolete:

- **RDD internals / low-level API** — know *why* you don't use them; don't memorize `mapPartitions` signatures.
- **Spark MLlib / GraphX** — not in scope for a data-pipeline architect role.
- **Hand-tuning every `spark.*.*` config** — know the *named* knobs (`shuffle.partitions`, `autoBroadcastJoinThreshold`, AQE flags, executor memory/cores) and that AQE removes most manual tuning. Don't recite the full config reference.
- **Spark Streaming (DStreams)** — legacy; talk **Structured Streaming** only.
- **Continuous-processing mode** — niche; describe micro-batch.
- **Exact, made-up benchmark numbers** — never quote "3.7× faster"; speak in mechanisms and orders of magnitude.
- **Scala/Java Spark syntax** — the role is PySpark; you can mention the JVM underneath but don't drift into Scala.

---

## One-page mental model

When asked *any* performance question, run this loop out loud:

```
1. What action triggered this job? (count/write/collect)
2. Where are the stage boundaries? (= the shuffles = the wide transforms)
3. For the worst stage: is it shuffle-bound, skew-bound, or memory-bound?
     - shuffle-bound  → reduce/broadcast the join, prune partitions, fewer wide ops
     - skew-bound     → AQE skew-join, then salt the hot key
     - memory-bound   → more/balanced partitions before more memory; check spill
4. Is data crossing the driver it shouldn't? (collect/toPandas/big broadcast)
5. Is the read efficient? (partition pruning, file sizes, pushed predicates)
6. Did I trust the engine? (DataFrame not RDD, built-ins not UDFs, AQE on)
```

That's the whole job. Everything above is in service of saying *which* of these six is the bottleneck — and naming the diagnostic (`explain()` / Spark UI) before you guess.

---

