---
title: Model Serving Patterns
summary: Batch versus real-time inference, model registries, rollout strategies, autoscaling, batching, hardware, serving frameworks and serving-side monitoring.
---

## Frame

Model serving is the production half of ML — where a trained model has to answer requests
reliably, cheaply and within a latency budget. The hard questions are not "can you wrap a model in
a web service" but "which serving pattern, how to roll out a new version safely, how to keep p99
latency inside an SLO, and how to know when the model is quietly breaking."

Three mental models:

1. **Serving is a latency/throughput/cost problem before it is an ML problem.** The model is a
   function; the hard parts are the SLO on the request path, the cost of the hardware, and swapping
   one version for another without hurting users.
2. **Batch and real-time are different products, not a config flag.** Batch scoring (precompute
   predictions on a schedule) and online serving (answer a live request) have different failure
   modes, cost profiles and freshness guarantees. Many "real-time" requirements are satisfiable
   with precomputed predictions plus a cache.
3. **The rollout is where models fail in production.** Offline metrics do not catch everything; the
   safe path exposes a new version to a sliver of traffic (shadow, canary, A/B), watches guardrail
   metrics, and only then ramps.

---

## 1. Batch vs real-time inference

### 1a. Batch (offline) inference

Precompute predictions on a schedule and store them for lookup.

- **Pattern** — a scheduled job scores a large set of entities (all users, all items) and writes
  results to a table or key-value store; the serving path reads the precomputed value.
- **Latency at request time** — a key lookup, because the model already ran.
- **Freshness** — as stale as the last batch run (hourly, nightly).
- **Cost** — efficient: bulk scoring on cheap batch compute.
- **When** — predictions do not depend on live request context and need not be fresher than the
  batch cadence: "daily recommendations per user", "churn score per customer".

### 1b. Real-time (online) inference

Run the model on the request.

- **Pattern** — a service holds the model in memory; per request it fetches features (often from an
  online feature store), runs the model and returns a prediction.
- **Latency at request time** — inference is on the critical path; the budget is typically tens of
  milliseconds.
- **Freshness** — always current; uses live request and session features.
- **Cost** — higher: always-on capacity sized to peak QPS.
- **When** — the prediction depends on request context (query, session, live inventory), the
  entity space is too large to precompute, or freshness matters more than the batch cadence allows.

### 1c. The hybrids most systems use

- **Precompute + cache** — batch-score the heavy part, serve from cache, fall back to real-time on a
  cache miss.
- **Two-stage retrieval + ranking** — cheap candidate generation (often precomputed or ANN
  retrieval), then a real-time re-ranker on the small candidate set. The standard search and
  recommender shape: the expensive model never runs over the whole catalogue per request, only over
  the top-k.

The first question is therefore not "batch or online" but "does the prediction depend on the live
request, and how fresh must it be?"

---

## 2. Low-latency serving fundamentals

The levers that keep p99 inside an SLO:

- **Keep the model in memory** — load once at startup, not per request.
- **Fetch features fast** — an online feature store or cache; feature fetch is often a bigger
  latency cost than the model itself.
- **Batch on the server** — coalesce concurrent requests into one batch (section 6).
- **Right hardware** — CPU for small models and low QPS; GPU or accelerators for large models and
  high throughput (section 7).
- **Optimize the model** — quantization, distillation, ONNX/TensorRT compilation, operator fusion.
- **Cache predictions** — for repeated identical inputs.
- **Tail-latency discipline** — measure p99/p99.9, not the mean; the mean hides the requests that
  hurt users. Timeouts, hedged requests (a duplicate to a second replica when the first is slow) and
  load shedding protect the tail.

---

## 3. Model registry and versioning

- **Model registry** — a catalogue of trained models with versions, lineage (which data, code and
  run produced them), stage (staging/production/archived) and metadata (metrics, signatures).
  MLflow Model Registry, Unity Catalog models, SageMaker Model Registry, Vertex Model Registry.
- **Versioning** — every model is an immutable version; serving points at a version or an alias
  such as `@production`. Promoting a new model is repointing the alias, so rollback is a one-line
  revert.
- **Why it matters for serving** — safe rollout needs versions N and N+1 side by side and instant
  rollback. The registry also makes "which version served this prediction" auditable — essential
  for debugging and whenever a model-driven decision is challenged.

```python
model_uri = "models:/ranker@production"
client.set_registered_model_alias("ranker", "production", version=7)
```

---

## 4. Rollout strategies at the model layer

| Strategy | What it does | Use when |
|---|---|---|
| **Shadow / mirror** | Send a copy of live traffic to the new model; **discard its responses** (users still get the old model). Compare predictions and latency offline. | Validate on real traffic with **zero user risk** before it serves anyone. |
| **Canary** | Route a small % of real traffic to the new model, watch metrics, ramp gradually (1% → 5% → 25% → 100%). | Catch regressions with limited blast radius; the default safe ramp. |
| **Blue-green** | Two full environments; flip all traffic from old (blue) to new (green) at once; keep blue warm for instant rollback. | Fast cutover with a clean rollback lever; less granular than canary. |
| **A/B test** | Split traffic between versions and measure a **business** metric with statistical rigour. | You care whether the new model is *better*, not just non-broken. |

Distinctions:

- **Shadow vs canary** — shadow costs compute (both models run) but risks nothing; canary exposes
  real users at small scale. Shadow answers "does it work, is it fast?"; canary answers "does it hurt
  anyone when it actually serves?"
- **Canary vs A/B** — canary is an *operational safety* ramp (is it broken?); A/B is a *product
  decision* experiment (is it better?), with proper randomization and statistics. They compose:
  canary to prove safe, then A/B to prove better. See
  [Online Experimentation](./online-experimentation.md) for the statistics.
- **Blue-green** — simplest rollback story, but all-or-nothing exposure; weaker than canary for
  catching gradual regressions.

A typical safe sequence for a new ranking model: shadow (latency and sanity on real traffic) →
canary (a few percent, watching guardrails) → A/B (prove the business lift) → full ramp, with the
registry alias as the rollback lever at every step.

---

## 5. Autoscaling

- **Horizontal autoscaling** — add or remove replicas on load (QPS, CPU/GPU utilization, queue
  depth, latency). Scale on the signal that reflects the SLO — usually queue depth or latency, not
  CPU alone.
- **Scale-to-zero** — spin down to zero replicas when idle (serverless serving, KServe, cloud
  endpoints), trading cold-start latency for cost. Good for spiky, low-traffic models; bad for
  latency-critical always-on paths.
- **Cold start** — a new replica must load the model and warm caches before it can serve; large
  models make cold starts slow, which fights aggressive scale-down. Mitigate with warm pools or a
  minimum replica floor.
- **GPU caveat** — GPUs are expensive and slower to provision; GPU serving scales more
  conservatively and leans harder on batching to raise per-GPU throughput.

---

## 6. Batching and micro-batching

- **Server-side dynamic batching** — the server holds incoming requests for a few milliseconds and
  runs them through the model as one batch. Large throughput gains, especially on GPU, for a little
  added latency per request.
- **The trade-off** — a larger max batch size or longer batch timeout raises throughput *and*
  latency, so the batch window is set backwards from the latency budget.
- **Micro-batching** — the streaming-inference version: accumulate a small window of events and
  score them together (also how Spark Structured Streaming works).
- **Why it matters** — per-request inference wastes a GPU; batching is often the single biggest
  throughput win. Triton, Ray Serve and TorchServe do dynamic batching for you.

```
dynamic_batching {
  preferred_batch_size: [ 8, 16 ]
  max_queue_delay_microseconds: 2000
}
```

---

## 7. CPU vs GPU

| | CPU | GPU / accelerator |
|---|---|---|
| **Good for** | Small models (trees, small nets, classic ML), low-to-moderate QPS | Large models (deep nets, transformers, LLMs), high throughput via batching |
| **Cost** | Cheap, plentiful, easy to scale | Expensive, scarcer, slower to provision |
| **Batching** | Helps less | Essential — GPUs need big batches to be efficient |
| **Latency** | Fine for small models | Wins on large models, but only well-utilized with batching |

Rule of thumb: **default to CPU; move to GPU when the model is too large for CPU to hit the
latency/throughput target, and only if batching keeps the GPU well utilized.** A lightly loaded GPU
is expensive idle silicon. For LLMs and large deep models, GPU with a specialized serving stack is
usually mandatory.

---

## 8. Serving frameworks

| Framework | What it is | Reach for it when |
|---|---|---|
| **FastAPI / custom** | Your own HTTP service with the model in-process | One simple model, full control; you build batching, versioning and metrics yourself |
| **BentoML** | Python-first framework that packages model + code + dependencies into a deployable unit with adaptive batching | A fast path from a Python model to a production service |
| **Ray Serve** | Python-native serving on Ray; composes several models and steps into a graph across a cluster | Multi-model pipelines and ensembles, e.g. retrieval + ranking |
| **KServe** | Kubernetes-native serving (CRDs) with a standard inference protocol, autoscaling, scale-to-zero and canary built in | A standardized, autoscaling, multi-framework serving layer on Kubernetes |
| **NVIDIA Triton Inference Server** | High-performance multi-framework server (TensorRT/ONNX/PyTorch/TF) with dynamic batching and concurrent model execution | Maximum GPU throughput, many models per GPU, tight latency at high QPS |
| **TorchServe** | PyTorch's own model server (dynamic batching, versioning) | PyTorch-centric, without Triton's complexity |
| **SageMaker endpoints** (AWS) | Managed real-time / serverless / async / batch-transform endpoints | Managed infra, autoscaling and traffic shifting without running Kubernetes |
| **Vertex AI endpoints** (GCP) | Managed online prediction with traffic splitting | The same, on GCP |

Condensed: one simple model → FastAPI or BentoML; multi-model Python composition → Ray Serve;
Kubernetes standard + autoscaling + rollout → KServe; squeeze GPU throughput → Triton; PyTorch,
simple → TorchServe; no infrastructure to run → managed endpoints.

A common production stack is **KServe on Kubernetes with Triton as the runtime** — KServe supplies
autoscaling and canary primitives, Triton the GPU-efficient batched inference.

---

## 9. Serving-side monitoring

### 9a. Operational SLOs

- **Latency** — p50/p95/**p99**/p99.9 per model version; alert on SLO breach.
- **Throughput**, **error rate**, **saturation** (GPU/CPU utilization, queue depth). Standard SRE,
  applied to the model service.

### 9b. Model and data quality

- **Data drift** — the distribution of *input features* in production moves away from training (a
  new market, seasonality, an upstream change). Detected per feature with PSI, KL divergence or a KS
  test.
- **Concept drift** — the relationship between features and label changes (the world changed, not
  just the inputs); shows up as degrading online metrics even when inputs look stable.
- **Prediction drift** — the distribution of the model's *outputs* shifts; an early proxy when
  labels are delayed.
- **Performance** — the real metric once labels arrive; often delayed, so drift signals are the
  early warning.

### 9c. Feature-serving skew

The values the model sees at serving time must match what it saw in training. Log served feature
values and compare their distribution with the training distribution; a stale online store or a
diverging feature definition shows up here before it shows up in degraded metrics. See
[Feature Platforms](./feature-platforms.md) for the mechanism.

Serving monitoring is two stacks: the SRE stack (latency, errors, saturation) and the ML stack (data,
concept and prediction drift, plus skew). Labels lag, so drift and skew are the early warning;
degraded business metrics are the confirmation you never want to wait for.

---

## Review questions

1. **Batch vs real-time — how do you choose?** Does the prediction need live request context, and
   how fresh must it be? If not, precompute and serve from a cache; much "real-time" is batch/ANN
   candidate generation plus a real-time re-ranker.
2. **How do you roll out a new model safely?** Shadow → canary → A/B → full ramp, with a registry
   alias for instant rollback.
3. **How do you keep p99 down?** Model in memory, fast feature fetch, dynamic batching, right
   hardware, model optimization, a minimum replica floor, tail discipline.
4. **GPU or CPU?** CPU by default; GPU when the model is too large for CPU and batching keeps the GPU
   busy.
5. **How do you know a served model is degrading?** SRE SLOs plus drift and skew monitoring.

---

## Further reading

- Chip Huyen, *Designing Machine Learning Systems* — batch/online, serving and monitoring chapters.
- KServe docs — inference protocol, autoscaling, canary rollout.
- NVIDIA Triton docs — dynamic batching, concurrent model execution, model repository.
- BentoML and Ray Serve docs.
- MLflow Model Registry / SageMaker / Vertex registry docs — versions, aliases, stages.
- Evidently AI docs — data and concept drift detection in practice.
