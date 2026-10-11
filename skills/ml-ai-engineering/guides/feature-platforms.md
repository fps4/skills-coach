---
title: Feature Platforms
summary: What a feature store is, offline versus online stores, training/serving skew, point-in-time correctness, and Feast made concrete.
---

## Frame

A feature platform (or feature store) is the piece of ML infrastructure between the data lake and
the models. Its job is narrow but important: **compute a feature once, serve it consistently to
both training and online inference, and let teams reuse it instead of re-deriving it.** At scale —
many models doing ranking, pricing, recommendations — the interesting questions are not "what is a
feature store" but "when is it worth the operational cost, and how do you get point-in-time
correctness right."

Three mental models:

1. **A feature store is two stores plus a definition layer.** An *offline store* (big, historical,
   columnar — for building training sets and batch scoring) and an *online store* (small,
   low-latency key-value — for real-time inference), with a single feature *definition* that feeds
   both. The whole value proposition is that both stores agree on how a feature is computed.
2. **The problem it exists to solve is training/serving skew.** If the training pipeline computes
   `avg_price_last_7d` one way (a Spark job over the lake) and the serving path computes it another
   way (a hand-written service reading Redis), the two drift and the model silently underperforms.
   A feature store makes the definition the single source of truth.
3. **Point-in-time correctness is the hard technical core.** Building a training set means joining
   labels to the feature values *as they were at the moment of the event* — not as they are now.
   Get this wrong and you leak future information into training (label leakage): offline metrics
   look great and production disappoints.

---

## 1. What a feature platform does

| Capability | What it means |
|---|---|
| **Definition / registry** | A declarative place where a feature (and its source, entity, and freshness) is defined once and versioned |
| **Offline store** | Historical feature values for training-set generation and batch scoring; big, columnar, cheap (warehouse / lake) |
| **Online store** | Latest feature values for real-time inference; low-latency key-value lookup (Redis, DynamoDB, etc.) |
| **Materialization** | The job that computes features and pushes them from source → offline and offline → online |

The registry is the governance surface: it is where feature reuse and ownership live. The two
stores are the serving surface. Materialization is the plumbing that keeps them in sync.

A feature store is best understood not as a database but as a **contract**: this feature is
computed exactly this way, it is available here for training and here for serving, and it is fresh
to within this SLA.

---

## 2. Offline store vs online store

### 2a. Offline store

- **Purpose** — generate training datasets and run batch scoring.
- **Access pattern** — large scans, joins across many entities and time ranges.
- **Backing tech** — the warehouse / lakehouse: BigQuery, Snowflake, Redshift, Delta/Parquet on S3,
  or plain files for local development.
- **Latency** — seconds to minutes is fine; you are building a dataset, not answering a request.
- **Retention** — long history, because point-in-time joins need *past* feature values.

### 2b. Online store

- **Purpose** — serve the *current* feature values for a single entity (or a small batch) at
  inference time.
- **Access pattern** — key lookup: "the features for user 123 and listing 456, now, in single-digit
  milliseconds."
- **Backing tech** — a low-latency key-value store: Redis, DynamoDB, Cassandra, Bigtable; SQLite
  for local development.
- **Latency** — single-digit to low-tens of milliseconds; it is on the request path.
- **Retention** — only the latest value per entity/key.

### 2c. Why two stores and not one

Different shapes of query. A columnar warehouse is great at "scan a billion rows and join by time"
and terrible at "one key lookup in 2 ms". A key-value store is the reverse. The feature store keeps
the *same feature definition* flowing into both, so the value a model sees at training time and at
serving time is computed identically.

---

## 3. Training/serving skew

**Training/serving skew** is when the feature values a model was trained on differ from the values
it sees in production. It is the most common cause of "great offline metrics, disappointing
production."

Three sources:

1. **Definition skew** — the feature is computed differently in the training pipeline and the
   serving pipeline (two codebases, two teams). A feature store removes it directly: one
   definition, both paths.
2. **Time skew** — the training set uses feature values from the wrong point in time (section 4),
   so the model learns from information it will not have at serving time.
3. **Freshness / materialization skew** — the online store is stale (materialization lagging), so
   serving sees older values than training assumed.

A feature store removes definition skew by construction and gives you the tooling to avoid time
skew through point-in-time joins. Freshness skew remains: it is an SLO on the materialization job
that someone has to monitor.

---

## 4. Point-in-time correctness (time-travel joins)

The conceptual heart of the topic.

### 4a. The problem

You have labels: "on 2026-03-01 14:00, user X booked listing Y." You want to train on the features
*as they were at 2026-03-01 14:00* — the user's booking count, the listing's average price over the
prior week — **not** as they are today. Joining current values onto a historical label leaks the
future into training. The model learns to rely on information it could not have at prediction time
and collapses in production.

### 4b. The join

A point-in-time (as-of, time-travel) join takes, for each label event at time `t`, the *most recent
feature value with a timestamp ≤ t*:

```
for each (entity, event_timestamp) in labels:
    for each feature:
        pick the feature row where
            feature.entity == label.entity
            and feature.event_timestamp <= label.event_timestamp
        order by feature.event_timestamp desc
        take the first (latest-but-not-future) row
```

This is the temporal / as-of join from streaming SQL, applied to training-set generation. A feature
store implements it when you ask for a historical / training dataset: you hand it a *spine* of
`(entity_id, event_timestamp)` and it returns point-in-time-correct features.

### 4c. Why it is easy to get wrong by hand

Hand-rolled training pipelines usually do a plain join on entity id and grab current values, or take
"the value on that calendar day" without respecting the intra-day timestamp. Both leak. The value of
the store is that the point-in-time join is the *default*, not something to remember. On a ranking
or pricing problem that alone — not the online serving — is often the strongest reason to adopt
one: it prevents a whole class of leakage bugs that make offline metrics lie.

---

## 5. The core object model

Most feature stores (Feast, Tecton, the cloud ones) share a vocabulary:

| Concept | What it is |
|---|---|
| **Entity** | The thing a feature describes and is keyed by — a user, a listing, a search. Has a join key (e.g. `user_id`). |
| **Data source** | Where raw feature data lives — a warehouse table, a Parquet file, a stream. |
| **Feature view** | A named group of features for an entity, tied to a source, with a schema and a freshness/TTL. The unit of definition and materialization. |
| **Feature service** | A named bundle of features (often spanning several feature views) that one model consumes — the model's contract. |
| **On-demand (request-time) feature** | Computed at request time from request inputs (and optionally other features) — e.g. `distance(user_location, listing_location)`. Not precomputed because it depends on request data. |

On-demand features matter for search and marketplaces: some features can only be computed when the
request arrives (query-dependent, session-dependent, or a transform of live inputs). Defining them
as a transformation applied identically in training and serving removes skew for the request-time
slice too.

---

## 6. Materialization

**Materialization** computes feature values and loads them into the stores.

- **Source → offline store** — a batch or streaming job derives feature values from raw data and
  lands them in the offline store *with event timestamps*, so point-in-time joins work.
- **Offline → online store** — a job pushes the *latest* value per entity into the online store so
  serving can read it fast.
- **Streaming materialization** — for fresh features ("clicks in the last 5 minutes"), a stream
  processor updates the online store continuously; the offline store gets the same values for
  training consistency.

The key operational metric is **freshness**: how far behind reality the online store is. That is an
SLO you own, because stale materialization is one of the three skew sources.

Batch materialization is a scheduled job; streaming materialization is a running pipeline. Large
systems usually need both — slow-moving profile features batched, fast-moving behavioural or
availability features streamed.

---

## 7. Feast, concretely

Feast is the open-source, provider-neutral feature store and the clearest illustration of the
concepts. It is a *framework and a registry*, not a database — it orchestrates *your* offline and
online stores.

### 7a. Architecture

- **Registry** — a catalogue of feature definitions (a file or a database-backed registry).
- **Offline store** — pluggable: file (Parquet), BigQuery, Snowflake, Redshift, Spark. Used for
  training-set generation (`get_historical_features`) and as the batch materialization source.
- **Online store** — pluggable: SQLite (local), Redis, DynamoDB, Datastore, Postgres. Used for
  `get_online_features`.
- **Provider** — the glue between the SDK and an environment (local, GCP, AWS).
- **SDK / CLI** — the Python SDK and `feast` CLI to `apply`, `materialize` and query.

Feast does **not** compute features from scratch — you point it at sources where the values already
exist (or land them there with your own pipelines). It handles the registry, the point-in-time join,
and moving values into the online store.

### 7b. `feature_store.yaml`

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

Swapping `offline_store.type` to `bigquery` and `online_store.type` to `redis` is the whole change
from local development to a cloud deployment — the feature definitions do not change.

### 7c. Defining features

```python
from feast import Entity, FeatureView, Field, FileSource
from feast.types import Float32, Int64
from datetime import timedelta

listing = Entity(name="listing", join_keys=["listing_id"])

listing_stats_source = FileSource(
    path="data/listing_stats.parquet",
    timestamp_field="event_timestamp",
)

listing_stats = FeatureView(
    name="listing_stats",
    entities=[listing],
    ttl=timedelta(days=7),
    schema=[
        Field(name="avg_price_7d", dtype=Float32),
        Field(name="bookings_7d", dtype=Int64),
    ],
    source=listing_stats_source,
)
```

An **on-demand feature view** transforms request data and/or other features at request time:

```python
from feast import on_demand_feature_view, RequestSource

request = RequestSource(schema=[Field(name="query_price", dtype=Float32)])

@on_demand_feature_view(
    sources=[listing_stats, request],
    schema=[Field(name="price_gap", dtype=Float32)],
)
def price_gap(inputs):
    import pandas as pd
    df = pd.DataFrame()
    df["price_gap"] = inputs["query_price"] - inputs["avg_price_7d"]
    return df
```

### 7d. The three verbs: apply, materialize, get

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
    entity_df=labels_df,   # spine: listing_id + event_timestamp + label
    features=[
        "listing_stats:avg_price_7d",
        "listing_stats:bookings_7d",
    ],
).to_df()
```

Online serving (low latency, latest values):

```python
features = store.get_online_features(
    features=["listing_stats:avg_price_7d", "listing_stats:bookings_7d"],
    entity_rows=[{"listing_id": 456}],
).to_dict()
```

`get_historical_features` does the point-in-time join against the offline store;
`get_online_features` does the key lookup against the online store. The same definitions sit behind
both — that is how Feast removes definition skew.

### 7e. Store options

| Offline store | Online store |
|---|---|
| File (Parquet) — local/dev | SQLite — local/dev |
| BigQuery — GCP warehouses | Redis — general low-latency default |
| Snowflake | DynamoDB — AWS, serverless scale |
| Redshift — AWS | Datastore / Bigtable — GCP |
| Spark | Postgres |

The offline choice follows where the data already lives; the online choice follows latency and
operational posture. Redis is the common online default; DynamoDB when you want serverless on AWS.

---

## 8. Managed and commercial alternatives

| Product | What it is | Notable |
|---|---|---|
| **Tecton** | Managed, enterprise feature platform | Adds managed *feature computation* (not just orchestration) — streaming feature pipelines, transformations, strong online SLAs. |
| **Databricks Feature Engineering in Unity Catalog** | Feature tables governed in Unity Catalog, integrated with MLflow | Lineage from feature to model; online tables for serving; native if already on Databricks. |
| **Vertex AI Feature Store** (GCP) | Managed feature serving on BigQuery + online serving | The newer version uses BigQuery as the offline source directly. |
| **SageMaker Feature Store** (AWS) | Managed offline (S3) + online store | Tight SageMaker integration; offline in S3/Glue, online key-value. |

The main build-versus-buy axis: **Feast orchestrates stores you already run; managed platforms
(especially Tecton) also compute the features** — they own the transformation and streaming
pipelines, not just the registry and the point-in-time join.

---

## 9. When a feature store is (and isn't) worth it

**Worth it when:**

- **Many models reuse the same features** — the reuse and governance payoff scales with the number
  of consumers.
- **There is real-time inference** with features derived from historical or streaming data — the
  offline/online split and skew problem are real and painful to hand-roll.
- **Point-in-time correctness matters** and leakage has already bitten.
- **Several teams** need to share and discover features without re-deriving them.

**Not worth it when:**

- **Batch-only, single model** — training and scoring in the same batch pipeline over the same
  warehouse leaves no online store to sync and no skew to fix. A well-written SQL/Spark job with a
  correct as-of join is enough.
- **Small team, few features** — the operational cost (running Redis/DynamoDB, materialization
  jobs, another system to monitor) outweighs the benefit.
- **Features are trivial request-time transforms** — compute them in the serving code.

A feature store earns its keep on reuse and on the online/offline skew problem — by removing skew
bugs and duplicated feature logic, not by being a faster database.

---

## Review questions

1. **Offline vs online store — why both?** Different query shapes: columnar scans and joins for
   training sets versus single-key millisecond lookups for serving. One definition feeds both.
2. **What is training/serving skew and how does a feature store help?** Feature values differ
   between training and production. The store removes *definition* skew by construction, enables
   avoiding *time* skew through point-in-time joins; *freshness* skew stays an SLO.
3. **Point-in-time correctness?** For each label at time t, take the latest feature value with
   timestamp ≤ t, never a future one — an as-of join that prevents label leakage.
4. **When would you not use a feature store?** Batch-only single model, small team, trivial
   features.
5. **Feast vs Tecton?** Feast orchestrates (registry, point-in-time join, materialization); Tecton
   also computes features.
6. **How do you keep the online store fresh?** Batch materialization for slow-moving features,
   streaming for fast ones; freshness is an explicit, monitored SLO.

---

## Further reading

- **Feast docs** — docs.feast.dev; the Quickstart and "Point-in-time joins" pages map to sections 4
  and 7.
- **Uber Michelangelo** engineering blog post — named the offline/online feature-store pattern.
- **Databricks Feature Engineering in Unity Catalog** — the lineage-integrated, governed take.
- **featurestore.org** — vendor-neutral comparison of the landscape.
- *"Hidden Technical Debt in Machine Learning Systems"* (Sculley et al.) — why skew and reuse debt
  matter at scale.
- Related: [Model Serving Patterns](./model-serving-patterns.md) for how features are fetched on the
  request path and how skew is monitored there.
