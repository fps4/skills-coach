---
title: Model Serving Patterns — Primer
summary: Batch vs real-time inference, the serving frameworks, safe rollout, autoscaling, batching, and knowing when a model is quietly breaking.
topic: ml-ai
format: primer
tags: [model-serving, inference, latency, autoscaling, canary, monitoring, mlops]
updated: 2026-08-07
---

## Frame

Model serving is the production half of ML — the part where a trained model has to
answer requests reliably, cheaply, and within a latency budget. The hard part is
never "can you wrap a model in a web service" — it is how you choose a serving
pattern, roll out a new model version safely, keep p99 latency inside an SLO, and
know when the model is quietly breaking. This guide is organized around those
four decisions.

Three mental models to hold going in:

1. **Serving is a latency/throughput/cost problem before it's an ML problem.**
   The model is a function; the hard parts are the SLO on the request path, the
   cost of the hardware it runs on, and safely swapping one version for another
   without hurting users. Frame answers around those, not around model
   architecture.
2. **Batch and real-time are different products, not a config flag.** Batch
   scoring (precompute predictions on a schedule) and online serving (answer a
   live request) have different failure modes, cost profiles, and freshness
   guarantees. A lot of "real-time" requirements are actually satisfiable with
   precomputed batch predictions plus a cache — knowing when is senior judgment.
3. **The rollout is where models actually fail in production.** Offline metrics
   don't catch everything; the safe path is to expose a new model version to a
   sliver of traffic (shadow, canary, A/B), watch guardrail metrics, and only then
   ramp. Being fluent in shadow/canary/blue-green/A/B *at the model layer* is a
   strong signal.

Why this matters: ranking, pricing and recommendation systems are
latency-sensitive, high-QPS, and constantly re-trained — which makes serving
architecture, rollout safety, and drift monitoring core concerns rather than
peripheral ones.

---

# Section 1 — Batch vs real-time inference

## 1a. Batch (offline) inference

Precompute predictions on a schedule and store them for later lookup.

- **Pattern** — a scheduled job scores a large set of entities (all users, all
  hotels) and writes results to a table / key-value store; the serving path just
  reads the precomputed value.
- **Latency at request time** — a key lookup (fast) because the model already ran.
- **Freshness** — as stale as your last batch run (hourly, nightly).
- **Cost** — efficient: score in bulk on cheap batch compute, amortize.
- **When** — predictions don't depend on live request context and don't need to
  be fresher than your batch cadence. Classic: "daily recommendations per user,"
  "churn score per customer."

## 1b. Real-time (online) inference

Run the model on the request, at request time.

- **Pattern** — a serving service loads the model in memory; a request comes in,
  features are fetched (often from an online feature store), the model runs, a
  prediction is returned.
- **Latency at request time** — the actual model inference is on the critical
  path; budget is typically tens of milliseconds.
- **Freshness** — always current; uses live request/session features.
- **Cost** — higher: you pay for always-on serving capacity sized to peak QPS.
- **When** — the prediction depends on request context (query, session,
  live inventory), or the entity space is too large to precompute, or freshness
  matters more than the batch cadence allows.

## 1c. The hybrid most systems actually use

- **Precompute + cache** — batch-score the heavy part, serve from cache, fall back
  to real-time on cache miss.
- **Two-stage retrieval + ranking** — cheap candidate generation (often
  precomputed / ANN retrieval), then a real-time re-ranker on the small candidate
  set. This is the standard marketplace search/recsys shape: you don't run the
  expensive model over the whole catalog per request, only over the top-k
  candidates.

Worth being able to say: *"The first question I ask isn't 'batch or online' — it's 'does
the prediction depend on the live request, and how fresh does it need to be?' A
lot of nominally real-time asks are satisfied by precomputed batch predictions
plus a re-ranker on the candidates, which is far cheaper at the same user-facing
latency."*

---

# Section 2 — Low-latency serving fundamentals

The levers that keep p99 inside an SLO:

- **Keep the model in memory** — load once at startup, not per request.
- **Fetch features fast** — an online feature store or cache; feature fetch is
  often a bigger latency cost than the model itself.
- **Batch on the server** — coalesce concurrent requests into one padded batch to
  use the hardware efficiently (Section 6).
- **Right hardware** — CPU for small models / low QPS; GPU (or accelerators) for
  large models / high throughput (Section 7).
- **Optimize the model** — quantization, distillation, ONNX/TensorRT compilation,
  operator fusion — smaller/faster model, same-ish accuracy.
- **Cache predictions** — for repeated identical inputs.
- **Tail-latency discipline** — measure p99/p99.9, not the mean; the mean hides
  the requests that actually hurt users. Timeouts, hedged requests, and load
  shedding protect the tail.

---

# Section 3 — Model registry and versioning

Before you serve, you need to know *which* model you're serving and be able to go
back.

- **Model registry** — a catalog of trained models, their versions, lineage
  (which data/code/run produced them), stage (staging/production/archived), and
  metadata (metrics, signatures). MLflow Model Registry, Unity Catalog models,
  SageMaker Model Registry, Vertex Model Registry.
- **Versioning** — every model is an immutable version; serving points at a
  version (or an alias like `@production`). Promoting a new model = repointing the
  alias, which makes rollback a one-line revert.
- **Why it matters for serving** — safe rollout (Section 4) needs the ability to
  run version N and N+1 side by side and to roll back instantly. The registry is
  what makes "which version served this prediction" auditable — essential for
  debugging and for regulated/marketplace-fairness contexts.

Say: *"A model version is an immutable artifact with lineage; serving references
an alias, not a file. That makes canary and instant rollback a repointing
operation, and it makes 'which model produced this decision' answerable — which
matters when a marketplace decision gets challenged."*

---

# Section 4 — Deployment / rollout strategies (model layer)

The heart of safe serving. These are the same ideas as service deployment, applied
to model versions.

| Strategy | What it does | Use when |
|---|---|---|
| **Shadow / mirror** | Send a copy of live traffic to the new model; **discard its responses** (users still get the old model). Compare predictions/latency offline. | Validate a new model on real traffic with **zero user risk** before it serves anyone. |
| **Canary** | Route a small % of real traffic to the new model, watch metrics, ramp gradually (1% → 5% → 25% → 100%). | Catch regressions with limited blast radius; the default safe ramp. |
| **Blue-green** | Two full environments; flip all traffic from old (blue) to new (green) at once; keep blue warm for instant rollback. | Fast cutover with a clean rollback lever; less granular than canary. |
| **A/B test** | Split traffic between versions and measure a **business** metric with statistical rigor to decide which is better. | You care whether the new model is *better for users/marketplace*, not just non-broken. |

Key distinctions to voice:

- **Shadow vs canary** — shadow costs you compute (you run both models) but risks
  nothing (responses discarded); canary exposes real users but at small scale.
  Shadow answers "does it work / is it fast?"; canary answers "does it hurt anyone
  when it actually serves?"
- **Canary vs A/B** — canary is an *operational safety* ramp (is it broken?); A/B
  is a *product decision* experiment (is it better?), with proper randomization and
  statistics. They compose: canary to prove safe, then A/B to prove better. (See
  the online-experimentation primer in this folder for the A/B statistics.)
- **Blue-green** — simplest rollback story, but all-or-nothing exposure; fine for
  low-risk swaps, weaker than canary for catching gradual regressions.

Worth being able to say: *"For a new ranking model I'd shadow it first to confirm latency
and sane predictions on real traffic at zero user risk, canary it to a few percent
watching guardrail metrics, then run a proper A/B to prove it lifts the business
metric before full ramp — with the registry alias giving me instant rollback at
every step."*

---

# Section 5 — Autoscaling

- **Horizontal autoscaling** — add/remove serving replicas based on load (QPS,
  CPU/GPU utilization, request-queue depth, or latency). The default for online
  serving.
- **Scale-to-zero** — spin down to zero replicas when idle (serverless serving,
  KServe, cloud endpoints), trading cold-start latency for cost. Good for spiky /
  low-traffic models, bad for latency-critical always-on paths.
- **The cold-start problem** — a new replica must load the model (and warm caches)
  before it can serve; big models make cold starts slow, which fights aggressive
  scale-down. Mitigate with warm pools / min replicas.
- **GPU autoscaling caveat** — GPUs are expensive and slower to provision; you
  scale GPU serving more conservatively and lean harder on batching to raise
  per-GPU throughput.

Architect framing: *"Autoscale on the signal that reflects the SLO — usually
queue depth or latency, not just CPU — and keep a minimum replica floor for
latency-critical models so scale-to-zero cold starts don't blow the p99."*

---

# Section 6 — Batching and micro-batching

- **Server-side dynamic batching** — the server holds incoming requests for a few
  milliseconds and groups them into one batch to run through the model together.
  Dramatically raises throughput (especially on GPU, which loves big batches) at
  the cost of a little added latency per request.
- **The trade-off** — bigger `max_batch_size` / longer `batch_timeout` = higher
  throughput, higher latency. You tune the batch window against the latency SLO.
- **Micro-batching** — the streaming-inference version: accumulate a small window
  of events and score them together (also how Spark Structured Streaming works).
- **Why it matters** — on a GPU, per-request inference wastes the hardware;
  batching is often the single biggest throughput win. Frameworks like Triton and
  Ray Serve, and TorchServe, do dynamic batching for you.

Say: *"Dynamic batching is the lever that makes GPU serving economical — you trade
a few milliseconds of batch-window latency for a large throughput gain. I'd set
the batch window from the latency budget backwards."*

---

# Section 7 — CPU vs GPU (and accelerators)

| | CPU | GPU / accelerator |
|---|---|---|
| **Good for** | Small models (trees, small nets, classic ML), low-to-moderate QPS | Large models (deep nets, transformers, LLMs), high throughput via batching |
| **Cost** | Cheap, plentiful, easy to scale | Expensive, scarcer, slower to provision |
| **Batching** | Helps less | Essential — GPUs need big batches to be efficient |
| **Latency** | Fine for small models | Wins on large models, but only well-utilized with batching |

Rule of thumb: **default to CPU; move to GPU when the model is large enough that
CPU can't hit the latency/throughput target, and only if batching keeps the GPU
well-utilized.** A lightly-loaded GPU is expensive idle silicon. For LLMs and large
deep models, GPU (with specialized serving stacks) is usually mandatory.

---

# Section 8 — The serving frameworks

What each is for and when to reach for it.

| Framework | What it is | Reach for it when |
|---|---|---|
| **FastAPI / custom** | Roll your own HTTP service around the model (FastAPI/Flask + the model in-process) | Simple single model, full control, small scale; you accept building batching/versioning/metrics yourself |
| **BentoML** | Python-first model-serving framework: package model + code + deps into a "Bento", get a service with batching, adaptive batching, and easy containerization | You want a fast path from Python model to a production service without hand-rolling the plumbing; good developer ergonomics |
| **Ray Serve** | Model serving on Ray; Python-native, composes multiple models/steps into a graph, scales across a cluster | Multi-model pipelines / ensembles, Python-heavy logic, or you're already on Ray; good for composing retrieval + ranking |
| **KServe** | Kubernetes-native model serving (CRDs) with standard inference protocol, autoscaling, scale-to-zero, canary built in | You're on Kubernetes and want a standardized, autoscaling, multi-framework serving layer with rollout primitives |
| **NVIDIA Triton Inference Server** | High-performance multi-framework (TensorRT/ONNX/PyTorch/TF) server with dynamic batching, concurrent model execution, GPU-optimized | Maximum GPU throughput, multiple models on shared GPUs, tight latency at high QPS |
| **TorchServe** | PyTorch's own model server (dynamic batching, versioning) | You're PyTorch-centric and want a straightforward server without the Triton complexity |
| **SageMaker endpoints** (AWS) | Managed real-time / serverless / async / batch-transform endpoints | On AWS, want managed infra, autoscaling, and built-in shadow/canary without running Kubernetes |
| **Vertex AI endpoints** (GCP) | Managed online prediction endpoints with traffic splitting | On GCP, want managed serving with built-in traffic-split rollout |

How to choose, condensed:

- **Just ship one model, simple** → FastAPI or BentoML.
- **Multi-model pipeline / Python composition** → Ray Serve.
- **Kubernetes standard + autoscaling + rollout** → KServe (often *fronting*
  Triton or TorchServe as the runtime).
- **Squeeze GPU throughput / many models per GPU** → Triton.
- **PyTorch, keep it simple** → TorchServe.
- **Don't want to run infra, on a cloud** → SageMaker / Vertex managed endpoints.

A common production stack is **KServe on Kubernetes with Triton as the model
runtime** — KServe gives the autoscaling and canary primitives, Triton gives the
GPU-efficient batched inference. Naming that combination signals you've seen real
serving infra.

---

# Section 9 — Serving-side monitoring

You don't just deploy — you watch. Three layers:

## 9a. Operational SLOs

- **Latency** — p50/p95/**p99**/p99.9, per model version; alert on SLO breach.
- **Throughput / QPS**, **error rate**, **saturation** (GPU/CPU utilization, queue
  depth). Standard service SRE, applied to the model service.

## 9b. Model / data quality

- **Data drift** — the distribution of *input features* in production drifts from
  training (e.g. a new market, seasonality, an upstream change). Detected with
  distribution distances (PSI, KL divergence, KS test) per feature.
- **Concept drift** — the relationship between features and the label changes
  (the world changed, not just the inputs); shows up as degrading online metrics
  even when inputs look stable.
- **Prediction drift** — the distribution of the model's *outputs* shifts; an early
  proxy when labels are delayed.
- **Performance** — the real metric (accuracy/AUC/business KPI) once labels arrive;
  often delayed, so drift signals are your early warning.

## 9c. Feature-serving skew (ties to the feature-platform primer)

The values the model sees at serving time must match what it saw at training time.
Monitor for **training/serving skew** at the serving boundary — log served feature
values and compare their distribution to the training distribution. A stale online
feature store or a diverging feature definition shows up here before it shows up in
degraded metrics. (See the feature-platforms primer for the mechanism.)

Worth being able to say: *"Serving monitoring is two stacks: the SRE stack — p99 latency,
error rate, saturation — and the ML stack — data drift, concept drift, and
feature-serving skew. Labels are usually delayed, so drift and skew signals are
the early warning; degraded business metrics are the confirmation you never want
to wait for."*

---

# Key points to be able to explain

1. **"Batch vs real-time inference — how do you choose?"** → Does the prediction
   need live request context and how fresh must it be? If not, precompute in batch
   and serve from a cache; a lot of "real-time" is candidate-generation (batch/ANN)
   plus a real-time re-ranker on the top-k.
2. **"Walk me through safely rolling out a new model."** → Shadow (zero user risk,
   check latency/sanity) → canary (small % real traffic, watch guardrails) → A/B
   (prove it's better) → full ramp; registry alias gives instant rollback
   throughout.
3. **"Shadow vs canary vs blue-green vs A/B?"** → Shadow = mirror traffic,
   discard responses; canary = small % real exposure ramped up; blue-green = full
   cutover with warm rollback; A/B = statistical product comparison. Safety ramps
   vs product decision.
4. **"How do you keep p99 latency down?"** → Model in memory, fast feature fetch,
   dynamic batching, right hardware, model optimization (quantize/distill/
   compile), min-replica floor to dodge cold starts, tail discipline (timeouts,
   hedging).
5. **"When GPU vs CPU?"** → CPU by default; GPU when the model is too large for
   CPU to hit the target and batching keeps the GPU utilized. An idle GPU is
   expensive.
6. **"Which serving framework and why?"** → Map to the need: FastAPI/BentoML for
   simple, Ray Serve for multi-model pipelines, KServe for K8s + autoscaling +
   rollout, Triton for GPU throughput, managed endpoints to avoid infra. KServe-
   over-Triton is a common real stack.
7. **"How do you know a served model is degrading?"** → Two stacks: SRE SLOs and
   ML drift (data/concept/prediction drift + feature-serving skew). Drift/skew are
   the early warning because labels lag.

---

# Further reading

- **Chip Huyen, *Designing Machine Learning Systems*** — the batch/online split,
  serving, and monitoring chapters are the canonical practitioner reference.
- **KServe docs** — inference protocol, autoscaling, canary rollout on Kubernetes.
- **NVIDIA Triton docs** — dynamic batching, concurrent model execution, model
  repository.
- **BentoML and Ray Serve docs** — for the Python-first and multi-model-pipeline
  patterns respectively.
- **MLflow Model Registry / SageMaker / Vertex model-registry docs** — versioning,
  aliases, and stage transitions.
- **"Monitoring ML models in production"** (Evidently AI docs / blog) — data and
  concept drift detection in practice.

---

