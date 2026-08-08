---
title: LLMOps and LLM Evaluation — Primer
summary: Evaluating GenAI systems — LLM-as-judge, RAG and agent eval, guardrails, tracing, and using the eval harness as a deploy gate.
topic: ml-ai
format: primer
tags: [llmops, evaluation, llm-as-judge, rag, guardrails, tracing, genai]
updated: 2026-08-07
---

## Frame

Evaluating LLM systems is genuinely different from evaluating classic ML, and
that's the whole point of this topic. There's usually no single ground-truth label,
outputs are free text, "correct" is fuzzy, and the same prompt can give different
answers on different runs. The question that matters is not "have you used an
LLM" — it is "how do you keep a non-deterministic, free-text system from
regressing in production, and how do you gate deploys on quality rather than
vibes."

Three mental models to hold going in:

1. **You can't ship LLM features on vibes — you need an eval harness.** The
   discipline that makes GenAI shippable is the same one that made classic software
   shippable: an automated test suite (here, an *eval set*) that runs in CI and
   gates the deploy. A prompt change, a model swap, a retrieval change — all go
   through the harness before they reach users. This is the single most important
   idea in the guide.
2. **Offline eval and online eval answer different questions.** Offline (a fixed
   eval set, run in CI) answers "did this change regress?" cheaply and repeatably.
   Online (real traffic, real signals) answers "is it actually good for users?"
   You need both; offline is the gate, online is the truth.
3. **LLM-as-judge is powerful and dangerous.** Using a strong model to score
   another model's output scales evaluation past what humans can label — but judges
   are biased, gameable, and non-deterministic. Knowing *how* they fail (and how to
   calibrate them against human labels) is the senior signal, not just knowing they
   exist.

Why this matters: most consumer and Data & AI products now ship GenAI surfaces
(search assistants, summarization, agentic tools). Defining an eval strategy,
gating deploys on it, and observing quality in production is the difference
between shipping those responsibly and shipping them hopefully.

---

# Section 1 — Why LLM eval is different

Classic ML eval has labels and a metric (accuracy, AUC). LLM systems break several
of those assumptions:

- **No single ground truth** — many valid answers; "correct" is a range, not a
  point.
- **Free-text output** — exact-match and BLEU/ROUGE-style overlap metrics correlate
  poorly with actual quality.
- **Non-determinism** — temperature and model updates mean the same input yields
  different outputs; you evaluate distributions/tendencies, not fixed outputs.
- **Multi-dimensional quality** — correctness, faithfulness, relevance, tone,
  safety, format, latency, cost — all at once, and they trade off.
- **The system, not the model** — a RAG or agent pipeline's quality depends on
  retrieval, tools, and prompts as much as the base model; you evaluate the
  *system*.

So LLM eval is a *portfolio* of methods (offline sets, judges, task metrics, online
signals), not one number — and the harness that runs them is the deliverable.

---

# Section 2 — Offline eval sets

The foundation: a curated, versioned dataset of inputs (and where possible,
references or rubrics) that you run the system against repeatedly.

- **What's in it** — representative inputs, edge cases, known-hard cases, past
  failures (regression cases), and adversarial cases. Grows over time: every
  production bug becomes a new eval case.
- **Where cases come from** — hand-written by experts, sampled and curated from
  production logs, synthetically generated (then human-reviewed), and derived from
  past incidents.
- **How it's used** — run the system over the set, score each output (by metric,
  reference, or judge), aggregate, and compare against the previous baseline. This
  is the unit test suite of the LLM world.
- **Golden set discipline** — keep a smaller, high-trust "golden" subset with
  human-verified expectations for the highest-stakes checks; version it so a change
  in scores means a change in the *system*, not the test.

Say: *"The core asset is a versioned eval set that grows from production failures.
Every incident becomes a regression case, so the same mistake can't ship twice.
That's what turns 'the model feels worse' into a number I can gate on."*

---

# Section 3 — Reference-based vs reference-free metrics

Two families:

- **Reference-based** — compare the output to a known good answer. Works when you
  *have* references: exact match / F1 for extractive tasks, semantic similarity
  (embedding cosine) for looser matches, and judge-scored "does the output match
  the reference." Precise but expensive to curate and brittle when many answers are
  valid.
- **Reference-free** — score the output *without* a gold answer, using a rubric or
  the input/context. Examples: "is this answer grounded in the provided context?",
  "is it relevant to the question?", "is it well-formed / safe?". Scales to open-
  ended tasks where references don't exist, usually via an LLM judge or heuristics.

Most production LLM eval leans reference-free (because references are scarce for
open-ended generation), with a smaller reference-based golden set for the cases
where you can pin down the right answer.

---

# Section 4 — LLM-as-judge (and its pitfalls)

Using a strong LLM to *score* outputs against a rubric. It's how you evaluate
free-text quality at scale.

## 4a. The patterns

- **Pointwise scoring** — judge rates one output on a rubric (1–5, or pass/fail on
  criteria like "faithful", "relevant", "complete").
- **Pairwise comparison** — judge picks the better of two outputs (A vs B). More
  reliable than absolute scores because relative judgments are easier and more
  stable; the basis for model/prompt comparisons.
- **Reference-guided** — judge compares the output to a reference answer.

## 4b. The pitfalls (know these cold)

- **Position bias** — judges favor the first (or second) option in pairwise; fix by
  randomizing order and/or scoring both orders and averaging.
- **Verbosity / length bias** — judges tend to prefer longer, more elaborate
  answers regardless of correctness.
- **Self-preference / self-enhancement bias** — a judge tends to prefer outputs
  from the same model family as itself.
- **Non-determinism** — the judge is itself an LLM; scores vary run to run.
- **Rubric sensitivity** — vague rubrics give noisy scores; the judge prompt is
  itself a thing you must engineer and version.
- **Gameability** — optimizing a system *against* a judge can produce outputs that
  score well and are actually worse (Goodhart's law).

## 4c. The discipline that makes judges trustworthy

- **Calibrate against human labels** — measure judge-vs-human agreement on a sample
  (e.g. Cohen's kappa); a judge you haven't validated against humans is an opinion,
  not a metric.
- **Prefer pairwise over absolute** for comparisons; **randomize position**; **use
  a strong judge model** and an explicit, versioned rubric; consider **multiple
  judges** or ensembling for high-stakes decisions.

Worth being able to say: *"LLM-as-judge is how you scale free-text eval, but a judge is only
a metric once I've calibrated it against human labels and controlled for position
and verbosity bias. Otherwise I'm gating deploys on an unvalidated opinion — and
teams optimize straight into the judge's blind spots."*

---

# Section 5 — RAG-specific evaluation

Retrieval-augmented generation has a distinctive failure surface: the answer can be
wrong because *retrieval* failed, because *generation* ignored good context, or
both. So you evaluate the two stages separately as well as end to end. The standard
triad (the "RAG triad"):

| Dimension | Question it answers | Failure it catches |
|---|---|---|
| **Faithfulness / groundedness** | Is the answer supported by the retrieved context (no hallucination)? | Model made something up despite having context |
| **Context relevance** | Is the retrieved context actually relevant to the question? | Retrieval pulled the wrong / noisy documents |
| **Answer relevance** | Does the answer actually address the question? | Grounded but off-topic / non-responsive |

Reading the triad:

- **Bad retrieval** → low context relevance → the ceiling on the answer is already
  capped; fix retrieval (chunking, embeddings, reranking), not the prompt.
- **Good context but low faithfulness** → the model is hallucinating past the
  evidence; fix the generation prompt / add citation constraints / a groundedness
  guardrail.
- **Faithful and grounded but low answer relevance** → it's answering the wrong
  question; fix query understanding / prompt.

Plus retrieval-quality metrics borrowed from IR: **precision@k, recall@k, MRR,
nDCG** on whether the right documents were retrieved (needs relevance labels).
Frameworks like Ragas compute the triad (often judge-based) so you can attribute a
bad answer to the failing stage.

Say: *"The value of the RAG triad is attribution — faithfulness, context
relevance, and answer relevance tell me whether a bad answer is a retrieval bug or
a generation bug, so I fix the right stage instead of blindly rewriting prompts."*

---

# Section 6 — Tool-use and agent evaluation

Agentic systems (the model calls tools, takes multi-step actions) add another eval
layer beyond text quality.

- **Tool-call correctness** — did the model call the *right tool* with the *right
  arguments*? Checkable structurally (the tool name and parameters), often against
  an expected call.
- **Tool-chain / trajectory validation** — for multi-step tasks, did it take a
  sensible sequence of steps (the trajectory), or wander/loop? Evaluate the path,
  not just the endpoint.
- **Task success / goal completion** — the end-to-end metric: did the agent
  actually accomplish the task? Often the only metric that ultimately matters, and
  usually the hardest to score (needs a checkable end state or a judge).
- **Efficiency** — steps taken, tokens/cost spent, latency; a correct-but-20-step
  path is a regression against a correct-3-step path.
- **Robustness** — behavior on tool errors, missing data, ambiguous instructions;
  does it recover or fail loudly?

The two-level framing: **process metrics** (right tools, sane trajectory,
efficiency) diagnose *why*; the **outcome metric** (task success) decides *whether*.
You want both, because a system can reach the right answer by a fragile path that
breaks on the next case.

Worth being able to say: *"For agents I evaluate on two levels: the outcome — did it complete
the task, on a checkable end state — and the process — did it call the right tools
with the right args and take an efficient trajectory. Outcome tells me if it works;
process tells me if it'll keep working."*

---

# Section 7 — Online quality signals

Offline eval is the gate; online signals are the truth. In production you infer
quality from behavior and lightweight checks:

- **Explicit feedback** — thumbs up/down, ratings, "was this helpful."
- **Implicit signals** — did the user accept/copy the answer, retry, rephrase,
  abandon, or escalate to a human? Retries and escalations are strong negative
  signals.
- **Task/business outcomes** — for a booking assistant, did the session convert;
  for a summarizer, was the summary acted on.
- **Online judges / sampled grading** — run an LLM judge (or human review) on a
  sample of live traffic to track a quality metric continuously.
- **Guardrail/violation rates** — how often safety filters, groundedness checks, or
  format validators fire in production.

These feed back into the eval set (Section 2): sampled production failures become
new offline cases, closing the loop.

---

# Section 8 — Guardrails

Runtime checks that sit *around* the model to enforce quality and safety on every
request — distinct from eval (which measures), guardrails *act*.

- **Input guardrails** — prompt-injection detection, PII detection/redaction,
  off-topic / out-of-scope rejection, jailbreak filters.
- **Output guardrails** — groundedness/faithfulness checks (is the answer supported
  by context?), toxicity/safety filters, format/schema validation (valid JSON,
  required fields), policy compliance, PII leak checks.
- **Actions on violation** — block, regenerate, fall back to a safe response, route
  to a human, or strip the offending content.
- **Where they run** — synchronously on the request path (adds latency, so they
  must be cheap/fast) or asynchronously for monitoring.

Guardrails and eval connect: the *violation rate* of a guardrail is itself an
online quality metric, and guardrail behavior should be in the offline eval set too.

---

# Section 9 — Regression and CI gating of prompts (the eval harness as deploy gate)

The central operational idea — tie everything back to this.

- **Prompts, models, and retrieval configs are code** — versioned, reviewed, and
  tested. A prompt edit is a code change and goes through CI.
- **The eval harness runs in CI** — on every change (prompt, model version,
  retrieval params, agent tools), run the eval set and compute the metrics.
- **Gate on the result** — block the merge/deploy if a primary metric regresses
  beyond a threshold or a guardrail check fails. This is exactly a test gate, with
  eval scores instead of pass/fail asserts.
- **Handle non-determinism** — run multiple samples, use thresholds/tolerances not
  exact matches, and compare against a baseline rather than an absolute bar.
- **Regression cases** — every production incident adds a case; the gate prevents
  the same failure from shipping twice.
- **A/B in production after the gate** — offline gate proves "no regression," then
  an online experiment proves "actually better" (ties to the online-experimentation
  primer).

Say: *"The thing that makes GenAI shippable is treating the eval set as a deploy
gate. Prompts and model versions are code; every change runs the eval harness in
CI; a merge is blocked if a primary metric regresses or a guardrail fails. Offline
eval gates the deploy, an online A/B confirms the win. Without that gate you're
shipping on vibes and finding regressions in production."*

---

# Section 10 — Cost, latency SLOs, and observability/tracing

## 10a. Cost and latency as first-class metrics

LLM systems have real per-request cost (tokens) and latency (often seconds, and
higher for agents/RAG with multiple model calls). Treat both as SLOs alongside
quality:

- **Cost** — tokens in/out per request, cost per session/task, cost per successful
  outcome. Watch agent loops and long contexts especially.
- **Latency** — p50/p95/**p99**, time-to-first-token (for streaming UX), and total
  time for multi-step agents. A quality win that doubles latency may be a net loss.
- **The three-way trade-off** — quality vs cost vs latency. A bigger model or more
  retrieval or more agent steps buys quality at cost/latency; the eval harness
  should report all three so the trade-off is explicit.

## 10b. Observability and tracing

Because a single request fans out into many steps (retrieval, multiple model calls,
tool calls), you need **traces and spans** to debug:

- **Trace** — the full record of one request/session end to end.
- **Span** — one step within it (a retrieval, one LLM call, one tool call) with its
  inputs, outputs, tokens, latency, and cost.
- **Why** — when an answer is bad, tracing lets you see *which step* failed (bad
  retrieval? bad generation? wrong tool call?) — the same attribution logic as the
  RAG triad, at the infra level. Traces also feed the eval set and the online
  monitors.

Tracing/observability tools (Langfuse, LangSmith, and OpenTelemetry-based
GenAI tracing) capture these traces; the point isn't the tool, it's that you can't
operate an LLM system you can't trace.

## 10c. Red-teaming

Proactively adversarial testing — deliberately trying to break the system:
prompt injection, jailbreaks, eliciting harmful/unsafe/off-brand output, PII
extraction, and hallucination-inducing inputs. Findings become guardrails and eval
cases. For a marketplace with a public-facing assistant, red-teaming for injection
and misuse is table stakes before launch.

---

# Section 11 — Frameworks (named neutrally)

Know what each is for; the concepts matter more than the tool.

| Tool | What it's for |
|---|---|
| **Ragas** | RAG-specific metrics — faithfulness, context relevance, answer relevance (the triad), largely judge-based |
| **DeepEval** | Pytest-style LLM eval framework — assertions/metrics you run like unit tests in CI (good fit for the deploy-gate pattern) |
| **promptfoo** | Prompt/model comparison and eval from config; side-by-side testing and CI gating of prompt changes |
| **OpenAI Evals** | Open framework for defining and running eval suites against models |
| **LangSmith** | Tracing + eval + dataset management (traces, spans, eval runs) |
| **Langfuse** | Open-source LLM observability — tracing, spans, cost/latency, evals |

The pattern across all of them: define a dataset, run the system, score with
metrics/judges, compare to a baseline, and (for the CI-oriented ones) fail the
build on regression. Pick per stack; the discipline is portable.

---

# Key points to be able to explain

1. **"Why is evaluating LLMs different from classic ML?"** → No single ground
   truth, free-text output, non-determinism, multi-dimensional quality; you
   evaluate the *system* (retrieval + tools + prompt), not just the model, with a
   portfolio of methods.
2. **"How do you gate deploys on LLM quality?"** → Treat prompts/models as code;
   run a versioned eval set in CI on every change; block merge if a primary metric
   regresses or a guardrail fails; use thresholds not exact match for non-
   determinism; A/B online after the offline gate.
3. **"LLM-as-judge — what breaks and how do you trust it?"** → Position/verbosity/
   self-preference bias, non-determinism, gameability. Calibrate against human
   labels, prefer pairwise, randomize position, version the rubric.
4. **"How do you evaluate a RAG system?"** → The triad — faithfulness,
   context relevance, answer relevance — for attribution (retrieval bug vs
   generation bug), plus IR metrics (recall@k, nDCG) on retrieval.
5. **"How do you evaluate an agent?"** → Two levels: outcome (task success on a
   checkable end state) and process (right tool calls, sane trajectory,
   efficiency, robustness to errors).
6. **"Guardrails vs eval?"** → Eval measures (offline/online); guardrails act at
   runtime (input: injection/PII; output: groundedness/toxicity/format). Guardrail
   violation rate is itself a quality metric.
7. **"How do you debug a bad answer in production?"** → Traces and spans:
   inspect the request end to end, find the failing step (retrieval / generation /
   tool), and turn it into a regression case.
8. **"Cost and latency?"** → First-class SLOs alongside quality; the harness reports
   the quality/cost/latency trade-off so bigger-model or more-steps decisions are
   explicit, not accidental.

---

# Further reading

- **Ragas docs** — the RAG triad metrics, made concrete.
- **DeepEval and promptfoo docs** — the CI/deploy-gate pattern for prompts and
  models.
- **Langfuse / LangSmith docs** — tracing, spans, and eval-run management.
- **"LLM-as-a-Judge" literature** — Zheng et al., *"Judging LLM-as-a-Judge with
  MT-Bench and Chatbot Arena"* (biases and calibration).
- **OpenAI Evals** — reference framework for defining eval suites.
- **OWASP Top 10 for LLM Applications** — the security/guardrail and red-teaming
  checklist (prompt injection, data leakage, etc.).
- **Anthropic, OpenAI, and Google model-provider eval/safety docs** — for
  provider-side guardrail and evaluation guidance.

---

