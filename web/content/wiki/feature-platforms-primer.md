---
title: Feature Platforms — Primer
summary: Offline vs online stores, training/serving skew, point-in-time correctness, and when a feature store is worth its operational cost.
topic: ml-ai
format: primer
tags: [feature-store, feast, ml-platform, point-in-time, training-serving-skew]
updated: 2026-08-07
---

## Frame

A "feature platform" (or feature store) is the piece of ML infrastructure that
sits between your data lake and your models. Its job is narrow but important:
**compute a feature once, serve it consistently to both training and online
inference, and let teams reuse it instead of re-deriving it.** At marketplace
scale — thousands of models across ranking, pricing and recommendations — the
interesting questions are not "what is a feature store" but "when is it worth the
operational cost, and how do you get point-in-time correctness right."

Three mental models to hold going in:

1. **A feature store is two stores plus a definition layer.** An *offline store*
   (big, historical, columnar — for building training sets and batch scoring) and
   an *online store* (small, low-latency key-value — for real-time inference),
   with a single feature *definition* that feeds both. The whole value
   proposition is that both stores agree on how a feature is computed.
2. **The problem it exists to solve is training/serving skew.** If your training
   pipeline computes `avg_price_last_7d` one way (a Spark job over the lake) and
   your serving path computes it another way (a hand-written service reading
   Redis), the two drift and the model silently underperforms. A feature store
   makes the definition the single source of truth.
3. **Point-in-time correctness is the hard technical core.** Building a training
   set means joining labels to the feature values *as they were at the moment of
   the event* — not "as they are now." Get this wrong and you leak future
   information into training (label leakage), your offline metrics look great, and
   production is a disappointment. This "time-travel join" is what a good feature
   store does for you.

Why this matters: marketplace and Data & AI work is feature-heavy
(ranking, pricing, availability, personalization), latency-sensitive on the
serving side, and reuse-hungry across many teams. Being able to reason about the
offline/online split, skew, and point-in-time joins is table stakes.

---

# Section 1 — What a feature platform actually does

A feature platform provides four things:

| Capability | What it means |
|---|---|
| **Definition / registry** | A declarative place where a feature (and its source, entity, and freshness) is defined once and versioned |
| **Offline store** | Historical feature values for training-set generation and batch scoring; big, columnar, cheap (data warehouse / lake) |
| **Online store** | Latest feature values for real-time inference; low-latency key-value lookup (Redis, DynamoDB, etc.) |
| **Materialization** | The job that computes features and pushes them from source → offline and offline → online |

The registry is the governance surface: it's where "feature reuse" and "who owns
this feature" live. The two stores are the serving surface. Materialization is the
plumbing that keeps them in sync.

Say it this way in the room: *"A feature store isn't a database — it's a
contract. The contract says: this feature is computed exactly this way, it's
available here for training and here for serving, and it's fresh to within this
SLA."*

---

# Section 2 — Offline store vs online store

The single most-probed distinction.

## 2a. Offline store

- **Purpose** — generate training datasets and run batch scoring.
- **Access pattern** — large scans, joins across many entities and time ranges.
- **Backing tech** — the data warehouse / lakehouse: BigQuery, Snowflake,
  Redshift, Delta/Parquet on S3, or plain files for local dev.
- **Latency** — seconds-to-minutes is fine; you're building a dataset, not
  answering a request.
- **Retention** — long history, because you need *past* feature values for
  point-in-time joins.

## 2b. Online store

- **Purpose** — serve the *current* feature values for a single entity (or a
  small batch) at inference time.
- **Access pattern** — key lookup: "give me the features for user 123 and
  hotel 456, now, in single-digit milliseconds."
- **Backing tech** — a low-latency key-value store: Redis, DynamoDB, Cassandra,
  Bigtable; SQLite for local dev.
- **Latency** — single-digit to low-tens of milliseconds; it's on the request
  path.
- **Retention** — only the latest value per entity/key (no history).

## 2c. Why two stores and not one

Different shapes of query. A columnar warehouse is great for "scan a billion rows
and join by time" and terrible at "one key lookup in 2 ms." A key-value store is
the reverse. The feature store's job is to keep the *same feature definition*
flowing into both so the value a model sees at training time and at serving time
is computed identically.

---

# Section 3 — Training/serving skew

**Training/serving skew** is when the feature values a model was trained on differ
from the values it sees in production. It's the most common cause of "great
offline metrics, disappointing production."

Three sources of skew:

1. **Definition skew** — the feature is computed differently in the training
   pipeline vs the serving pipeline (two codebases, two teams). This is the one a
   feature store directly kills: one definition, both paths.
2. **Time skew** — the training set uses feature values from the wrong point in
   time (see Section 4), so the model learns from information it won't have at
   serving time.
3. **Freshness/materialization skew** — the online store is stale (materialization
   lagging), so serving sees older values than training assumed.

The architect's line: *"A feature store removes definition skew by construction —
same transformation feeds offline and online. It gives you the tooling to avoid
time skew via point-in-time joins. Freshness skew you still have to monitor —
it's an SLO on the materialization job."*

---

# Section 4 — Point-in-time correctness (time-travel joins)

This is the conceptual heart of the whole topic.

## 4a. The problem

You have labels: "on 2026-03-01 14:00, user X booked hotel Y." You want to train
on the features *as they were at 2026-03-01 14:00* — the user's booking count, the
hotel's average price over the prior week, etc. — **not** as they are today. If
you join "current" feature values onto a historical label, you leak the future
into training. The model sees information it could not possibly have at prediction
time, learns to rely on it, and collapses in production.

## 4b. The join

A point-in-time (a.k.a. "as-of" or time-travel) join takes, for each label event
at time `t`, the *most recent feature value with a timestamp ≤ t*. Conceptually:

```
for each (entity, event_timestamp) in labels:
    for each feature:
        pick the feature row where
            feature.entity == label.entity
            and feature.event_timestamp <= label.event_timestamp
        order by feature.event_timestamp desc
        take the first (latest-but-not-future) row
```

This is exactly the temporal / as-of join from streaming SQL, applied to
training-set generation. A feature store implements it for you when you ask for a
"historical" / "training" dataset — you hand it a spine of `(entity_id,
event_timestamp)` and it returns point-in-time-correct features.

## 4c. Why it's easy to get wrong by hand

Hand-rolled training pipelines usually do a plain join on entity id and grab
current values, or grab "the value on that calendar day" without respecting the
intra-day timestamp. Both leak. The value of the store is that the point-in-time
join is the *default*, not something you have to remember to do correctly.

Worth being able to say: *"The reason I'd reach for a feature store on a ranking
or pricing problem isn't the online serving — it's that point-in-time-correct
training-set generation is the default. That single thing prevents a whole class
of label-leakage bugs that make offline metrics lie to you."*

---

# Section 5 — The core object model (entities, feature views, on-demand features)

Most feature stores (Feast, Tecton, the cloud ones) share a vocabulary:

| Concept | What it is |
|---|---|
| **Entity** | The thing a feature describes and is keyed by — a user, a hotel, a search. Has a join key (e.g. `user_id`). |
| **Data source** | Where raw feature data lives — a warehouse table, a Parquet file, a stream. |
| **Feature view** | A named group of features for an entity, tied to a source, with a schema and a freshness/TTL. The unit of definition and materialization. |
| **Feature service** | A named bundle of features (often spanning several feature views) that a specific model consumes — the model's contract. |
| **On-demand (request-time) feature** | A feature computed at request time from request inputs (and optionally other features) — e.g. `distance(user_location, hotel_location)`. Not precomputed because it depends on request data. |

**On-demand features** matter for marketplace/search: some features can only be
computed when the request arrives (query-dependent, session-dependent, or a
transform of live inputs). A good feature store lets you define these as a
transformation applied consistently in both training and serving — again killing
skew for the request-time slice.

---

# Section 6 — Materialization

**Materialization** is the process of computing feature values and loading them
into the stores.

- **Source → offline store** — a batch or streaming job derives feature values
  from raw data and lands them in the offline store (with event timestamps, so
  point-in-time joins work).
- **Offline → online store** — a materialization job pushes the *latest* value per
  entity into the online store so serving can read it fast.
- **Streaming materialization** — for fresh features (e.g. "clicks in the last 5
  minutes"), a stream processor updates the online store continuously; the offline
  store gets the same values for training consistency.

The key operational metric is **freshness**: how far behind the online store is
vs reality. That's an SLO you own. Stale materialization is one of the three skew
sources (Section 3).

Batch materialization is a scheduled job ("materialize yesterday's features every
night"); streaming materialization is a running pipeline. Large-scale
marketplace features usually need both — slow-moving profile features batched,
fast-moving behavioral/availability features streamed.

---

# Section 7 — Feast, concretely (the open-source reference)

Feast is the open-source feature store worth knowing hands-on because it's the
clearest illustration of the concepts and it's provider-neutral. It is a
*framework and a registry*, not a database — it orchestrates *your* offline and
online stores.

## 7a. Architecture

- **Registry** — a catalog of feature definitions (a file, or a database-backed
  registry). The source of truth for what features exist.
- **Offline store** — pluggable: file (Parquet), BigQuery, Snowflake, Redshift,
  Spark. Used for training-set generation (`get_historical_features`) and batch
  materialization source.
- **Online store** — pluggable: SQLite (local), Redis, DynamoDB, Datastore,
  Postgres. Used for `get_online_features`.
- **Provider** — the glue that ties the SDK to a cloud (local, GCP, AWS).
- **SDK / CLI** — the Python SDK and `feast` CLI to `apply`, `materialize`, and
  query.

Feast does **not** compute your features from scratch — you point it at sources
where the feature values already exist (or land them there via your own
pipelines). It handles the registry, the point-in-time join, and moving values
into the online store.

## 7b. `feature_store.yaml`

The config that wires up the stores:

```yaml
project: marketplace
registry: data/registry.db
provider: local
offline_store:
  type: file          # or bigquery / snowflake.offline / redshift / spark
online_store:
  type: sqlite         # or redis / dynamodb / datastore
  path: data/online_store.db
entity_key_serialization_version: 3
```

Swapping `offline_store.type` to `bigquery` and `online_store.type` to `redis` is
the whole change from local dev to a cloud deployment — the feature definitions
don't change. That portability is the point.

## 7c. Defining features

```python
from feast import Entity, FeatureView, Field, FileSource
from feast.types import Float32, Int64
from datetime import timedelta

hotel = Entity(name="hotel", join_keys=["hotel_id"])

hotel_stats_source = FileSource(
    path="data/hotel_stats.parquet",
    timestamp_field="event_timestamp",
)

hotel_stats = FeatureView(
    name="hotel_stats",
    entities=[hotel],
    ttl=timedelta(days=7),
    schema=[
        Field(name="avg_price_7d", dtype=Float32),
        Field(name="bookings_7d", dtype=Int64),
    ],
    source=hotel_stats_source,
)
```

An **on-demand feature view** transforms request data and/or other features at
request time:

```python
from feast import on_demand_feature_view, RequestSource

request = RequestSource(schema=[Field(name="query_price", dtype=Float32)])

@on_demand_feature_view(
    sources=[hotel_stats, request],
    schema=[Field(name="price_gap", dtype=Float32)],
)
def price_gap(inputs):
    import pandas as pd
    df = pd.DataFrame()
    df["price_gap"] = inputs["query_price"] - inputs["avg_price_7d"]
    return df
```

## 7d. The three verbs: apply, materialize, get

```bash
# 1. Register definitions into the registry
feast apply

# 2. Push feature values into the online store (batch materialization)
feast materialize-incremental $(date -u +"%Y-%m-%dT%H:%M:%S")
```

Training-set generation (offline, point-in-time correct):

```python
from feast import FeatureStore
store = FeatureStore(repo_path=".")

training_df = store.get_historical_features(
    entity_df=labels_df,   # spine: hotel_id + event_timestamp + label
    features=[
        "hotel_stats:avg_price_7d",
        "hotel_stats:bookings_7d",
    ],
).to_df()
```

Online serving (low-latency, latest values):

```python
features = store.get_online_features(
    features=["hotel_stats:avg_price_7d", "hotel_stats:bookings_7d"],
    entity_rows=[{"hotel_id": 456}],
).to_dict()
```

`get_historical_features` does the point-in-time join against the offline store;
`get_online_features` does the key lookup against the online store. Same feature
definitions behind both — that's how Feast kills definition skew.

## 7e. Offline and online store options

| Offline store | Online store |
|---|---|
| File (Parquet) — local/dev | SQLite — local/dev |
| BigQuery — GCP warehouses | Redis — general low-latency default |
| Snowflake | DynamoDB — AWS, serverless scale |
| Redshift — AWS | Datastore / Bigtable — GCP |
| Spark | Postgres |

Choice is driven by where your data already lives (offline) and your latency /
ops posture (online). Redis is the common online default; DynamoDB when you want
serverless and are on AWS.

---

# Section 8 — The managed / commercial alternatives

Know these by name and by what they add over Feast:

| Product | What it is | Notable |
|---|---|---|
| **Tecton** | Managed, enterprise feature platform (founded by the Uber Michelangelo team) | Adds managed *feature computation* (not just orchestration) — streaming feature pipelines, transformations, strong online SLAs. Feast is the OSS project it originally stewarded. |
| **Databricks Feature Store / Feature Engineering in Unity Catalog** | Feature tables governed in Unity Catalog, integrated with MLflow | Lineage from feature → model; online tables for serving; native if you're already on Databricks. |
| **Vertex AI Feature Store** (GCP) | Managed feature serving on BigQuery + online serving | Point-in-time serving off BigQuery; the newer version leans on BigQuery as the offline source directly. |
| **SageMaker Feature Store** (AWS) | Managed offline (S3) + online store | Tight AWS/SageMaker integration; offline in S3/Glue, online key-value. |

The distinction to voice: **Feast orchestrates stores you already run; the
managed platforms (especially Tecton) also *compute* the features** — they own the
transformation and streaming pipelines, not just the registry and the point-in-
time join. That's the main "build vs buy" axis.

---

# Section 9 — When a feature store is (and isn't) worth it

The senior judgment call, and a very likely probe.

**Worth it when:**

- **Many models reuse the same features** — the reuse and governance payoff scales
  with the number of consumers. One team, one model, three features: not worth it.
- **You have real-time inference** with features derived from historical/streaming
  data — the offline/online split and skew problem are real and painful to
  hand-roll.
- **Point-in-time correctness matters** and you've been bitten by leakage — the
  as-of join is the thing you don't want to re-implement per pipeline.
- **Multiple teams** need to share and discover features without re-deriving them —
  the registry becomes the governance and discovery surface.

**Not worth it when:**

- **Batch-only, single-model** — if you train and score in the same batch pipeline
  over the same warehouse, there's no online store to keep in sync and no skew to
  fix. A well-written SQL/Spark job with a correct as-of join is enough.
- **Small team, few features** — the operational cost (running Redis/Dynamo,
  materialization jobs, another system to monitor) outweighs the benefit.
- **Features are trivial request-time transforms** — compute them in the serving
  code; a store adds latency and moving parts for no reuse gain.

The architect's line: *"A feature store earns its keep on reuse and on the
online/offline skew problem. If I have one batch model I'd skip it and just write
a point-in-time-correct training query. The moment I have real-time serving plus
several teams wanting the same features, the store pays for itself — mostly by
removing skew bugs and duplicated feature logic, not by being a faster
database."*

---

# Key points to be able to explain

1. **"Offline vs online store — why both?"** → Different query shapes: columnar
   scans/joins for training-set generation vs single-key millisecond lookups for
   serving. Same feature definition feeds both to prevent skew.
2. **"What is training/serving skew and how does a feature store help?"** →
   Feature values differing between training and production. The store kills
   *definition* skew by construction (one transformation, both paths), enables
   avoiding *time* skew via point-in-time joins; *freshness* skew stays an SLO on
   materialization.
3. **"Explain point-in-time correctness."** → For each label at time t, take the
   latest feature value with timestamp ≤ t, never a future value. Prevents label
   leakage. It's an as-of join and it's the store's default for training-set
   generation.
4. **"Entities, feature views, on-demand features?"** → Entity = the keyed thing;
   feature view = a group of features + source + TTL; on-demand = computed at
   request time from request inputs, defined once so it's consistent in training
   and serving.
5. **"When would you NOT use a feature store?"** → Batch-only single model, small
   team, trivial features. The cost (extra systems, materialization jobs) beats
   the benefit until you have reuse and real-time serving.
6. **"Feast vs Tecton?"** → Feast orchestrates stores you already run (registry +
   point-in-time join + materialization). Tecton also computes the features
   (managed streaming transformation pipelines, stronger online SLAs). Build-vs-
   buy on whether you want to own feature computation.
7. **"How do you keep the online store fresh?"** → Batch materialization for
   slow-moving features, streaming materialization for fast ones; freshness is an
   explicit SLO you monitor because staleness is a skew source.

---

# Further reading

- **Feast docs** — docs.feast.dev; the "Quickstart" and "Point-in-time joins"
  pages map directly to Sections 4 and 7.
- **Uber Michelangelo** — the engineering blog post that named the offline/online
  feature-store pattern; Tecton is its commercial descendant.
- **Databricks Feature Engineering in Unity Catalog** — for the lineage-integrated,
  governed take (ties to the Databricks refresher in this folder).
- **"Feature Stores for ML" (featurestore.org)** — vendor-neutral comparison of
  the landscape.
- Google's *"Data preparation and feature engineering"* and the classic
  *"Hidden Technical Debt in Machine Learning Systems"* paper — for why skew and
  reuse debt matter at scale.

---

