---
title: Polars & Pandas — Data Engineer's Refresher
summary: The Polars expression API, lazy evaluation and Arrow interop, Pandas at the right depth, and when each one wins — for anyone who already thinks in PySpark.
topic: data-engineering
format: refresher
tags: [polars, pandas, numpy, arrow, parquet, lazy-evaluation, python]
updated: 2026-08-07
---

## Frame

This refresher assumes Python, DataFrame semantics, Parquet, columnar storage, and the "declare transformations, let the engine optimize" mindset — ideally from PySpark. It is not about understanding a lakehouse. It is about **opening an editor and writing clean, fast, correct Polars/Pandas/NumPy code**, and being able to say why one tool beats another at a given data size.

The running example throughout is a time-series geospatial one — matching aircraft track samples against a gridded weather forecast — because it exercises the interesting parts: lazy scans over partitioned Parquet, nearest-in-time joins, and a numeric kernel that has to run outside the DataFrame layer.

Three mental models to hold going in:

1. **Polars is "PySpark for one machine."** The **expression API** (`pl.col("x") * 2`), the **lazy plan** with predicate/projection pushdown, the `.collect()` that triggers execution — this is the Spark DataFrame model, minus the cluster. If you can write PySpark, you already think in Polars; what you need is the syntax in your fingers and a clear sense of where the single-node ceiling sits. **This mapping is the highest-leverage idea in the guide.**
2. **Expressions are the unit, not rows.** Both Polars and modern Pandas reward you for describing a *column-level* computation the engine can vectorize and parallelize, and punish you for looping over rows (`iterrows`, `apply` with a Python function). "I don't iterate rows, I build expressions" is the sentence that signals you write fast data code.
3. **Arrow is the shared memory that makes interop cheap.** Polars, Pandas (PyArrow-backed), and NumPy sit on/near the same Arrow columnar buffers, so `to_pandas()` / `from_pandas()` / `to_numpy()` are close to zero-copy. You move between the three tools *within one pipeline* — Polars for the heavy reshape, Pandas for a library that demands it, NumPy for the physics — without paying a serialization tax.

For anyone coming from Spark, Polars is a newer *surface* rather than a new *concept* — and the fastest way to convert that into working knowledge is to build one Polars-first pipeline end to end, with Pandas interop at the edges, a NumPy kernel in the middle, and a partitioned Parquet layout underneath.

---

# Section 1 — Why Polars is fast (and what that buys you)

## 1a. The four reasons, in one breath

| Reason | What it means | Why it matters in the room |
|---|---|---|
| **Rust core** | The engine is compiled Rust, not interpreted Python | No Python-level per-row overhead; memory-safe parallelism |
| **Apache Arrow memory** | Columnar, contiguous, typed buffers | Cache-friendly scans; zero-copy interop with Pandas/NumPy |
| **No GIL bottleneck** | Work happens in Rust threads, outside Python's Global Interpreter Lock | True multicore parallelism on one machine — Pandas is largely single-threaded |
| **SIMD + vectorization** | One CPU instruction over many values | Column math (`col * 2`, comparisons, aggregations) runs wide |

The signature line: *"Polars is a Rust, Arrow-backed, multithreaded DataFrame engine. Because the work runs in Rust outside the GIL, it uses all my cores; because it's Arrow-columnar it's cache-friendly and interops with Pandas/NumPy near-zero-copy; and because it has a lazy query optimizer it pushes filters and column pruning down to the scan. Pandas, by contrast, is single-threaded, row-eager, and NumPy-backed."*

## 1b. Eager vs lazy — the most-probed distinction

- **Eager** (`pl.DataFrame`, `pl.read_parquet`) — runs each operation immediately, like Pandas. Good for exploration and small data.
- **Lazy** (`pl.LazyFrame`, `pl.scan_parquet`) — builds a **query plan** and optimizes it before running anything. `.collect()` triggers execution. This is the Spark model: transformations are lazy, `.collect()` is the action.

The optimizer does **predicate pushdown** (apply filters at the file scan, read fewer rows), **projection pushdown** (read only the columns you actually use), plus common-subexpression elimination, slice pushdown, and more. On Parquet this means you never materialize columns or row-groups you don't need.

```python
import polars as pl

# Lazy: nothing runs until .collect()
lf = (
    pl.scan_parquet("s3://flights/tracks/*.parquet")   # LazyFrame, no data read yet
      .filter(pl.col("cruise_alt_ft") > 30_000)       # pushed down to the scan
      .select("flight_id", "ts", "lat", "lon", "cruise_alt_ft")  # projection pushdown
)

print(lf.explain())   # inspect the optimized physical plan — say "explain" in the interview
df = lf.collect()      # NOW it reads Parquet, already pruned to matching rows/cols
```

`.explain()` is the equivalent of Spark's `.explain()` / `df.queryExecution` — reading the optimized plan and pointing at where the pushdown happened is a strong signal.

## 1c. The streaming engine (larger-than-RAM)

Polars can run a lazy query in **streaming** mode, processing data in batches so the working set need not fit in RAM: `lf.collect(engine="streaming")` (the modern flag; older code uses `collect(streaming=True)`). This is the honest answer to "what if the data doesn't fit in memory?" on a single node. It is **not** distributed compute — see §5.

---

# Section 2 — The Polars expression API

## 2a. Contexts vs expressions — the core idea

An **expression** is a lazy description of a column computation: `pl.col("co2e_kg").sum()`, `pl.col("lat") * 0.0174533`. It does nothing until it runs inside a **context**. The four contexts:

| Context | Purpose | PySpark analogue |
|---|---|---|
| `.select(...)` | Choose/derive columns (output = the expressions) | `df.select(...)` |
| `.with_columns(...)` | Add/replace columns (keep the rest) | `df.withColumn(...)` |
| `.filter(...)` | Keep rows matching a boolean expression | `df.filter(...)` |
| `.group_by(...).agg(...)` | Aggregate per group | `df.groupBy(...).agg(...)` |

The mental shift from Pandas: you rarely index-and-assign. You **chain contexts, each taking expressions**. Because expressions are declarative, Polars runs independent ones in parallel and fuses them.

```python
out = (
    df
    .filter(pl.col("phase") == "cruise")
    .with_columns([
        (pl.col("temp_k") - 273.15).alias("temp_c"),
        (pl.col("co2e_kg") / pl.col("distance_km")).alias("co2e_per_km"),
    ])
    .select("flight_id", "temp_c", "co2e_per_km")
)
```

## 2b. `when / then / otherwise` — conditional columns

The vectorized `if/else`, chainable for multi-branch logic (like SQL `CASE`):

```python
df = df.with_columns(
    pl.when(pl.col("rhi") >= 1.0).then(pl.lit("ISSR"))
      .when(pl.col("rhi") >= 0.8).then(pl.lit("near"))
      .otherwise(pl.lit("dry"))
      .alias("humidity_class")
)
```

## 2c. Window functions with `.over()`

Compute an aggregate *within a partition* without collapsing rows — Spark's `Window.partitionBy`:

```python
df = df.with_columns(
    pl.col("cruise_alt_ft").mean().over("flight_id").alias("mean_alt_per_flight"),
    (pl.col("ts") - pl.col("ts").min().over("flight_id")).alias("t_since_takeoff"),
)
```

## 2d. Reshaping — `explode`, `pivot`, `unpivot`

- **`explode`** — one list-valued cell → many rows (e.g. a flight's list of waypoints into one row per waypoint).
- **`pivot`** — long → wide (values of one column become new columns). Eager-only.
- **`unpivot`** (formerly `melt`) — wide → long. Modern name is `unpivot`; `melt` is deprecated. Say **`unpivot`** to sound current, note it was `melt`.

```python
df.explode("waypoints")
df.pivot(index="flight_id", on="phase", values="fuel_kg", aggregate_function="sum")
df.unpivot(index="flight_id", on=["alt_ft", "temp_k"], variable_name="metric", value_name="value")
```

## 2e. Nulls

Polars separates **null** (missing) from **NaN** (a float value). Key tools: `.is_null()`, `.fill_null(strategy="forward")` or `.fill_null(0)`, `.drop_nulls()`, `.fill_nan(...)`. Aggregations skip nulls by default. Unlike Pandas' historical habit of coercing integer columns to float to hold `NaN`, Polars keeps the dtype and uses a real null bitmap (Arrow validity buffer).

---

# Section 3 — Joins, and `join_asof` (the workhorse)

## 3a. Standard joins

`df.join(other, on="flight_id", how="inner")` — `how` in `inner / left / full / semi / anti / cross`. Multi-key: `on=["icao24", "day"]` or `left_on=.../right_on=...`. Same semantics as PySpark joins.

## 3b. `join_asof` — nearest-in-time matching

**This is the one worth knowing cold.** `join_asof` joins each left row to the **closest** right row by an ordered key (usually time), rather than requiring an exact match. It is exactly how you attach a flight track sample to the **nearest-in-time weather grid cell** without a costly exact-timestamp join that would almost never hit.

```python
# Both frames MUST be sorted on the asof key.
flights = flights.sort("ts")
weather = weather.sort("valid_time")

matched = flights.join_asof(
    weather,
    left_on="ts",
    right_on="valid_time",
    by="grid_cell_id",        # match within the same spatial cell first (like a group key)
    strategy="backward",      # take the most recent weather at or before the flight sample
    tolerance="30m",          # don't match if nearest reading is >30 min away
)
```

- **`strategy`**: `backward` (last value ≤ key — the usual choice for "weather as of now"), `forward` (next value ≥ key), or `nearest`.
- **`by`**: an exact-match grouping key applied *before* the asof search — here the spatial grid cell, so you match time only within the right location.
- **`tolerance`**: reject matches beyond a gap, leaving nulls you can handle explicitly.

The soundbite: *"Flight tracks and weather grids are never on the same clock. I match each track sample to the nearest-in-time reading in its grid cell with `join_asof`, backward strategy, a tolerance to avoid stale matches — Pandas calls the same thing `merge_asof`."*

---

# Section 4 — Pandas at the right depth

You know Pandas; this is about saying the *right* things and avoiding the classic traps.

## 4a. Vectorization vs `apply` / `iterrows`

The single most important Pandas performance fact: **operate on whole columns (Series), never loop rows.**

```python
# Slow — Python-level loop, one call per row
df["co2e_per_km"] = df.apply(lambda r: r["co2e_kg"] / r["distance_km"], axis=1)

# Fast — vectorized, runs in C over the whole array
df["co2e_per_km"] = df["co2e_kg"] / df["distance_km"]
```

Rule of thumb to state: **`iterrows` is almost always wrong; `apply(axis=1)` is a row loop in disguise; reach for vectorized column math, `np.where`, `.map`, or `.groupby(...).transform(...)` first.** Polars removes the temptation entirely — there's no idiomatic row loop.

## 4b. The index, `.loc` / `.iloc`

Pandas' **index** is a first-class row label (Polars has none — a deliberate simplification). `.loc[label]` selects by label, `.iloc[pos]` by integer position. Much Pandas confusion (and the copy-vs-view traps) traces back to the index; be ready to explain `reset_index()` / `set_index()`.

## 4c. `groupby`, `merge`, `concat`, `merge_asof`

- `df.groupby("flight_id")["fuel_kg"].sum()` — split-apply-combine.
- `pd.merge(a, b, on="flight_id", how="left")` — the join.
- `pd.concat([a, b])` — stack frames (axis 0) or columns (axis 1).
- `pd.merge_asof(flights, weather, on="ts", by="grid_cell_id", direction="backward", tolerance=pd.Timedelta("30m"))` — the **Pandas equivalent of Polars `join_asof`**; both sides must be sorted on the key. Naming the pair (`join_asof` ↔ `merge_asof`) shows you know both stacks.

## 4d. Dtypes: nullable and PyArrow-backed

- **Classic NumPy dtypes** — integer columns get coerced to `float64` to hold a missing value (`NaN`), which loses precision and is a common bug.
- **Nullable dtypes** — `Int64`, `boolean`, `string` (capital-I) carry a proper missing-value mask, no float coercion.
- **PyArrow-backed dtypes** — `dtype="int64[pyarrow]"` or `df.convert_dtypes(dtype_backend="pyarrow")` puts Pandas on Arrow memory: real nulls, better strings, and cheap interop with Polars. Modern (Pandas 2.x/3.x) recommended direction; mention it to sound current.

## 4e. Copy-vs-view and `SettingWithCopyWarning`

The classic Pandas footgun: chained indexing (`df[df.a > 0]["b"] = 1`) may write to a temporary copy, silently losing the assignment, and raises `SettingWithCopyWarning`. Fix: single-step `.loc`:

```python
df.loc[df["a"] > 0, "b"] = 1
```

Note that **Pandas 3.0 adopts Copy-on-Write (CoW) as default**, which removes most of this ambiguity (assignments never silently mutate a parent). Knowing CoW is coming/here signals you track the ecosystem. Polars sidesteps the whole class of bug — frames are immutable, operations return new frames.

---

# Section 5 — When each wins (the decision you'll be asked to defend)

| Situation | Reach for | Why |
|---|---|---|
| Data comfortably fits one machine; you want speed + clean code | **Polars** | Multithreaded, lazy optimizer, expression API; fastest single-node option |
| Data bigger than RAM but still one node | **Polars streaming** | Batched execution; `collect(engine="streaming")` |
| Small data, or you need a library that speaks Pandas | **Pandas** | matplotlib, scikit-learn, statsmodels, seaborn, most of the PyData ecosystem take/return Pandas/NumPy |
| Existing Pandas codebase, quick edit | **Pandas** | Don't rewrite working code for a micro-optimization |
| Genuinely distributed / cluster-scale (TBs, many nodes) | **PySpark** | Distributed shuffle across a cluster; Polars is single-node |
| Numeric/physics kernels, linear algebra | **NumPy** | Arrays feed vectorized math, `scipy`, the physics functions |

The honest positioning, said out loud: *"Polars is a single-node columnar engine — think 'PySpark on one big machine.' It's the fastest, cleanest choice up to the memory of a box, and its streaming engine handles larger-than-RAM on that same node. It is **not** a Spark replacement at cluster scale — the moment I need a distributed shuffle across many machines I'm on PySpark, which I've run on Databricks. The good news is the expression mindset is identical: `pl.col` and lazy `.collect()` map straight onto Spark's DataFrame API, so I move between them without changing how I think."*

That answer does three things at once: shows you know Polars, shows you know its ceiling, and cashes in your real Spark/Databricks depth.

---

# Section 6 — Interop: Polars ↔ Pandas ↔ NumPy ↔ Arrow ↔ Parquet

Arrow is the lingua franca; conversions are close to zero-copy.

| Direction | Call |
|---|---|
| Polars → Pandas | `df.to_pandas()` (add `use_pyarrow_extension_array=True` for Arrow-backed, truly zero-copy) |
| Pandas → Polars | `pl.from_pandas(pdf)` |
| Polars → NumPy | `df.to_numpy()` / `series.to_numpy()` |
| Polars ↔ Arrow | `df.to_arrow()` / `pl.from_arrow(tbl)` |
| Parquet (eager / lazy) | `pl.read_parquet(...)` / `pl.scan_parquet(...)`; write `df.write_parquet(...)` |

A realistic handoff — Polars does the heavy reshape, NumPy runs the physics, Pandas hands off to a plotting/ML library:

```python
import numpy as np, polars as pl

# 1) Polars: lazy Parquet scan, prune + join weather, land the feature frame
feat = (
    pl.scan_parquet("s3://silver/flight_weather/*.parquet")
      .filter(pl.col("phase") == "cruise")
      .select("flight_id", "ts", "temp_k", "pressure_pa", "rhi", "co2e_kg", "extra_fuel_kg")
      .collect()
)

# 2) NumPy: pull typed arrays out (near zero-copy) and run the physics kernel
T   = feat["temp_k"].to_numpy()
P   = feat["pressure_pa"].to_numpy()
G   = 1.6e-2                              # contrail factor slope (simplified)
T_crit = -46.0 + 9.43 * np.log(G - 0.053) + 0.72 * np.log(G - 0.053) ** 2  # SAC threshold, °C

# 3) Back into Polars as a computed feature column
feat = feat.with_columns([
    pl.Series("t_crit_c", np.full(len(feat), T_crit)),
    (pl.col("temp_k") - 273.15).alias("temp_c"),
])

# 4) Pandas only at the edge, for a library that wants it (e.g. matplotlib / sklearn)
pdf = feat.to_pandas(use_pyarrow_extension_array=True)
```

The point to make: **you don't pick one tool for the whole job — you pick the right one per stage and pay almost nothing to move between them because they share Arrow memory.**

---

# Section 7 — A worked feature: SAC + ISSR as a Polars expression

This is the payoff for everything above, and a good template for any threshold-on-joined-timeseries feature. The physics, one paragraph: a persistent contrail forms when **(a)** the **Schmidt-Appleman Criterion (SAC)** is met — the mixing of hot, moist exhaust with cold ambient air crosses saturation with respect to water, which needs the ambient temperature below a pressure-dependent critical temperature `T_crit` — **and (b)** the air is **ice-supersaturated (an ISSR)** — relative humidity over ice `RHi ≥ 100%`, so the ice crystals persist instead of subliming. Meet both → persistent (warming) contrail → candidate for an altitude change.

```python
persistent = (
    matched                                   # from the join_asof in §3b
    .with_columns([
        (pl.col("temp_k") - 273.15).alias("temp_c"),
        # SAC: ambient colder than the pressure-dependent critical temperature
        (pl.col("temp_c") < pl.col("t_crit_c")).alias("sac_met"),
        # ISSR: supersaturated with respect to ice
        (pl.col("rhi") >= 1.0).alias("issr"),
    ])
    .with_columns(
        (pl.col("sac_met") & pl.col("issr")).alias("forms_persistent_contrail")
    )
)

# Decide altitude change: weigh avoided warming (CO2e-equivalent) vs the extra fuel burned
decision = (
    persistent
    .filter(pl.col("forms_persistent_contrail"))
    .with_columns(
        (pl.col("avoided_co2e_kg") - pl.col("extra_fuel_kg") * pl.col("co2e_per_fuel_kg"))
        .alias("net_co2e_benefit_kg")
    )
    .with_columns(
        pl.when(pl.col("net_co2e_benefit_kg") > 0)
          .then(pl.lit("recommend_altitude_change"))
          .otherwise(pl.lit("hold"))
          .alias("recommendation")
    )
)
```

Every step is a vectorized expression over columns — no row loops, parallelizable, and lazy-optimizable if you keep it on a `LazyFrame`. That combination is what "clean, fast, correct" actually means here.

---

# Section 8 — FastAPI / Flask (awareness brief)

Both turn up constantly around Python data work, and an ML inference service is usually FastAPI. You don't need to be a web-framework specialist — know the decision.

| | **FastAPI** | **Flask** |
|---|---|---|
| Model | Async (ASGI), `async def` handlers | Sync (WSGI) by default |
| Validation | **Pydantic** models — typed request/response, auto-coerced/validated | Manual, or add-ons (marshmallow) |
| Docs | **Auto-generated OpenAPI + Swagger UI at `/docs`** | None built-in |
| Type hints | Central to the design (drive validation + docs) | Optional |
| Best for | ML inference / data APIs, async I/O, typed contracts | Small simple apps, minimal deps, legacy familiarity |

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class FlightSegment(BaseModel):
    flight_id: str
    temp_k: float
    rhi: float
    cruise_alt_ft: int

@app.post("/predict")
def predict(seg: FlightSegment):          # Pydantic validates & coerces the JSON body
    forms = (seg.temp_k - 273.15) < -46.0 and seg.rhi >= 1.0
    return {"flight_id": seg.flight_id, "forms_persistent_contrail": forms}
```

Why FastAPI for the inference service: *"For an ML inference endpoint I use FastAPI — Pydantic gives me typed request/response validation for free, the async model handles concurrent inference calls, and the auto-generated `/docs` OpenAPI page is the contract I hand the front end. Flask is fine for a tiny sync app, but it makes me hand-roll validation and docs."*

---

# Check yourself

1. **"Why is Polars fast?"**
   → Rust core, Apache Arrow columnar memory, multithreaded outside the GIL, SIMD vectorization, plus a lazy query optimizer with predicate/projection pushdown. Pandas is single-threaded, NumPy-backed, row-eager.
2. **"Lazy vs eager in Polars?"**
   → `scan_*` builds a `LazyFrame` and an optimized plan; `.collect()` runs it (Spark's transformation/action split). Lazy enables pushdown so you read fewer rows/columns from Parquet. Inspect with `.explain()`.
3. **"You have flight tracks and a weather grid on different clocks — how do you join them?"**
   → `join_asof` (Pandas `merge_asof`): sort both, match nearest-in-time with `strategy="backward"`, group by grid cell with `by=`, cap staleness with `tolerance`. (§3b)
4. **"When Polars, when Pandas, when PySpark?"**
   → Polars for fast single-node (streaming for larger-than-RAM); Pandas for the ecosystem/small data/existing code; PySpark for genuinely distributed cluster scale. Same expression mindset across Polars and Spark. (§5)
5. **"Is Polars a Spark replacement?"**
   → No — single-node columnar engine, not a distributed one. It replaces Pandas for speed on one box; PySpark still owns cluster-scale distributed shuffles.
6. **"Why avoid `iterrows` / `apply(axis=1)` in Pandas?"**
   → They're Python-level row loops; vectorized column math runs in C/NumPy over the whole array. Polars has no idiomatic row loop at all. (§4a)
7. **"What's the `SettingWithCopyWarning`?"**
   → Chained indexing may assign to a temporary copy, silently dropping the write; fix with single-step `.loc`. Pandas 3.0 Copy-on-Write removes most of it; Polars is immutable so it can't happen. (§4e)
8. **"How do you move data between Polars, Pandas, and NumPy?"**
   → `to_pandas()`/`from_pandas()`, `to_numpy()`, `to_arrow()`/`from_arrow()` — all near-zero-copy via shared Arrow memory. Pick the tool per stage. (§6)
9. **"Contexts vs expressions in Polars?"**
   → Expressions describe column computations; contexts (`select`, `with_columns`, `filter`, `group_by().agg()`) run them. Independent expressions run in parallel. (§2a)
10. **"FastAPI vs Flask for an ML service?"**
    → FastAPI: async, Pydantic-typed validation, auto OpenAPI `/docs`. Flask: simple sync WSGI. FastAPI for typed, concurrent inference endpoints. (§8)
11. **"What if the data doesn't fit in memory?"**
    → Polars streaming engine (`collect(engine="streaming")`) batches on one node; beyond a node's reach, PySpark. (§1c)
12. **"Nullable / PyArrow dtypes in Pandas — why care?"**
    → Classic NumPy dtypes coerce ints to float to hold `NaN`; nullable (`Int64`) and PyArrow-backed dtypes carry a real null mask and interop cheaply with Polars. (§4d)

---

# Vocabulary

- *"Expression API — `pl.col`, chained contexts."*
- *"Lazy `scan_parquet` → `LazyFrame` → `.collect()`."*
- *"Predicate and projection pushdown."* — the optimizer signal.
- *"`.explain()` the query plan."*
- *"Arrow-backed columnar, multithreaded outside the GIL."*
- *"Streaming engine for larger-than-RAM."*
- *"`join_asof` / `merge_asof`, backward strategy, tolerance, `by` key."*
- *"`when / then / otherwise`."* and *"`.over()` window."*
- *"`unpivot` (formerly `melt`)."* — shows you're current.
- *"Vectorize, don't `iterrows`."*
- *"Copy-on-Write / `SettingWithCopyWarning`."*
- *"PyArrow-backed nullable dtypes."*
- *"Zero-copy interop via Arrow."*
- *"Pydantic-typed FastAPI, auto `/docs`."*
- *"Polars is PySpark for one machine — same mindset, no cluster."*

---

# Things to skip

- **Memorizing Polars benchmark multiples vs Pandas.** "Multithreaded, columnar, materially faster" is enough; invented numbers get caught.
- **Rust internals / writing a Polars plugin.** You're a *user* of the engine; know why it's fast, not how to extend its core.
- **Every Pandas method.** Know the shape (vectorize, index, groupby/merge, dtypes, copy-vs-view) — don't recite the API.
- **Deep async/ASGI theory or a full web-framework build.** Awareness-level FastAPI/Flask is the right depth alongside a data stack.
- **Dask / Modin / Ray.** One sentence is enough — other ways to scale Pandas out; Polars single-node plus PySpark for distributed covers most of the ground.
- **The deprecated `melt` / `streaming=True` spellings as your default.** Know they exist for old code; *say* `unpivot` and `engine="streaming"`.

---

## What transfers from Spark, and what doesn't

Most of Polars is Spark knowledge with different syntax — but the transfer is uneven, and the uneven parts are worth knowing before you rely on them:

| Spark / Python experience | Polars/Pandas equivalent | How well it transfers |
|---|---|---|
| PySpark DataFrame API, lazy transformations, `.explain()` | Polars expression API + lazy `LazyFrame` + `.collect()` — same model, one node | **Cleanly** — the mental model is identical |
| Spark predicate/column pruning on Parquet | Polars predicate/projection pushdown via `scan_parquet` | **Cleanly** — same optimization concept |
| Parquet lakehouse layout (bronze/silver/gold) | Polars `scan_parquet` over a Parquet-partitioned layout | **Cleanly** |
| Time-based / point-in-time joins in Spark | `join_asof` / `merge_asof` | **Mostly** — the `strategy` / `by` / `tolerance` parameters have no direct Spark analogue and repay reading the docs |
| Pandas for analysis/feature work | Vectorization, groupby/merge, dtypes, copy-vs-view, PyArrow backend | **Cleanly**, though copy-vs-view semantics catch out people arriving from Spark's immutability |
| NumPy numeric work | Numeric kernels, array interop with Polars | **Cleanly** — Arrow makes the handoff near zero-copy |
| Distributed-scale intuition | Single-node ceilings, the streaming engine | **Poorly** — the one that genuinely does not carry over |

That last row is the important one. Spark experience tells you nothing useful about where a single machine falls over, and the instinct to reach for more partitions has no equivalent here. Polars' answer to larger-than-RAM is the streaming engine, not parallelism — and knowing when to stop using Polars altogether and go back to a cluster is the judgement that takes longest to build.
