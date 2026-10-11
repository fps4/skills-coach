---
title: LLMOps and LLM Evaluation
summary: Evaluating GenAI systems — eval sets, LLM-as-judge, RAG and agent evaluation, guardrails, tracing, and the eval harness as a deploy gate.
---

## Frame

Evaluating LLM systems is genuinely different from evaluating classic ML. There is usually no single
ground-truth label, outputs are free text, "correct" is fuzzy, and the same prompt can give
different answers on different runs. The question is how to keep a non-deterministic, free-text
system from regressing in production, and how to gate deploys on quality rather than on impressions.

Three mental models:

1. **LLM features need an eval harness.** The discipline that makes GenAI shippable is the one that
   made software shippable: an automated test suite (an *eval set*) that runs in CI and gates the
   deploy. A prompt change, a model swap, a retrieval change — all go through the harness first.
2. **Offline and online eval answer different questions.** Offline (a fixed eval set, run in CI)
   answers "did this change regress?" cheaply and repeatably. Online (real traffic, real signals)
   answers "is it good for users?" Offline is the gate, online is the truth.
3. **LLM-as-judge is powerful and dangerous.** Using a strong model to score another model's output
   scales evaluation past what humans can label — but judges are biased, gameable and
   non-deterministic, and must be calibrated against human labels.

---

## 1. Why LLM eval is different

- **No single ground truth** — many valid answers; "correct" is a range.
- **Free-text output** — exact match and BLEU/ROUGE-style overlap metrics correlate poorly with
  quality.
- **Non-determinism** — temperature and model updates make one input yield different outputs; you
  evaluate tendencies over samples, not fixed outputs.
- **Multi-dimensional quality** — correctness, faithfulness, relevance, tone, safety, format,
  latency, cost — all at once, and they trade off.
- **The system, not the model** — a RAG or agent pipeline's quality depends on retrieval, tools and
  prompts as much as on the base model.

LLM eval is therefore a *portfolio* of methods (offline sets, judges, task metrics, online signals),
and the harness that runs them is the deliverable.

---

## 2. Offline eval sets

A curated, versioned dataset of inputs (with references or rubrics where possible), run repeatedly
against the system.

- **Contents** — representative inputs, edge cases, known-hard cases, past failures (regression
  cases) and adversarial cases. Every production bug becomes a new case.
- **Sources** — expert-written cases, cases sampled from production logs, synthetic cases reviewed
  by a human, cases derived from incidents.
- **Use** — run the system over the set, score each output (metric, reference or judge), aggregate,
  compare with the previous baseline. The unit-test suite of the LLM world.
- **Golden set** — a smaller, high-trust subset with human-verified expectations for the
  highest-stakes checks, versioned so a score change means the *system* changed, not the test.

---

## 3. Reference-based vs reference-free metrics

- **Reference-based** — compare the output to a known good answer: exact match / F1 for extractive
  tasks, embedding similarity for looser matches, a judge checking agreement with the reference.
  Precise, but expensive to curate and brittle when many answers are valid.
- **Reference-free** — score the output *without* a gold answer, against a rubric or the
  input/context: grounded in the context? relevant? well-formed? safe? Scales to open-ended tasks,
  usually via an LLM judge or heuristics.

Production LLM eval leans reference-free, with a smaller reference-based golden set where the right
answer can be pinned down.

---

## 4. LLM-as-judge

A strong LLM *scores* outputs against a rubric — the way to evaluate free-text quality at scale.

### 4a. Patterns

- **Pointwise** — the judge rates one output on a rubric (1–5, or pass/fail on criteria such as
  faithful, relevant, complete).
- **Pairwise** — the judge picks the better of two outputs. More reliable than absolute scores,
  because relative judgements are easier and more stable.
- **Reference-guided** — the judge compares the output to a reference answer.

### 4b. Pitfalls

- **Position bias** — favouring the first (or second) option in pairwise; fix by randomizing order
  or scoring both orders and averaging.
- **Verbosity bias** — preferring longer, more elaborate answers regardless of correctness.
- **Self-preference bias** — preferring outputs from its own model family.
- **Non-determinism** — the judge is an LLM; scores vary run to run.
- **Rubric sensitivity** — vague rubrics give noisy scores; the judge prompt must be engineered and
  versioned.
- **Gameability** — optimizing a system against a judge can produce outputs that score well and are
  worse (Goodhart's law).

### 4c. Making judges trustworthy

- **Calibrate against human labels** — measure judge–human agreement on a sample (e.g. Cohen's
  kappa). An unvalidated judge is an opinion, not a metric.
- **Prefer pairwise** for comparisons, **randomize position**, use a **strong judge model** and an
  explicit, versioned rubric; consider **multiple judges** for high-stakes decisions.

---

## 5. RAG evaluation

A RAG answer can be wrong because *retrieval* failed, because *generation* ignored good context, or
both. Evaluate the stages separately as well as end to end — the **RAG triad**:

| Dimension | Question | Failure it catches |
|---|---|---|
| **Faithfulness / groundedness** | Is the answer supported by the retrieved context? | The model made something up despite having context |
| **Context relevance** | Is the retrieved context relevant to the question? | Retrieval pulled wrong or noisy documents |
| **Answer relevance** | Does the answer address the question? | Grounded but off-topic |

Reading it:

- **Low context relevance** → the answer is already capped; fix retrieval (chunking, embeddings,
  reranking), not the prompt.
- **Good context, low faithfulness** → the model hallucinates past the evidence; fix the generation
  prompt, add citation constraints or a groundedness guardrail.
- **Faithful but low answer relevance** → it answers the wrong question; fix query understanding or
  the prompt.

Add IR metrics — **precision@k, recall@k, MRR, nDCG** — on whether the right documents were
retrieved (needs relevance labels). Frameworks such as Ragas compute the triad, mostly judge-based.
The value of the triad is **attribution**: retrieval bug or generation bug.

---

## 6. Tool-use and agent evaluation

- **Tool-call correctness** — the right tool with the right arguments, checked structurally against
  an expected call.
- **Trajectory validation** — for multi-step tasks, a sensible sequence of steps rather than
  wandering or looping. Evaluate the path, not only the endpoint.
- **Task success** — did the agent accomplish the task, on a checkable end state or by a judge? The
  metric that ultimately matters, and the hardest to score.
- **Efficiency** — steps, tokens, cost, latency; a correct 20-step path is a regression against a
  correct 3-step path.
- **Robustness** — behaviour on tool errors, missing data, ambiguous instructions.

**Process metrics** (right tools, sane trajectory, efficiency) diagnose *why*; the **outcome metric**
(task success) decides *whether*. A system can reach the right answer by a fragile path that breaks
on the next case, so both are needed. A useful report gives each run a verdict — answered, partial,
declined, loop-exhausted, tool-error — and compares the expected tool chain with the actual one.

---

## 7. Online quality signals

- **Explicit feedback** — thumbs up/down, ratings.
- **Implicit signals** — accepting or copying the answer, retrying, rephrasing, abandoning,
  escalating to a human. Retries and escalations are strong negative signals.
- **Task / business outcomes** — did the session convert, was the summary acted on.
- **Online judges / sampled grading** — a judge or human review on a sample of live traffic.
- **Guardrail violation rates** — how often safety filters, groundedness checks or format validators
  fire.

Sampled production failures become new offline cases, closing the loop.

---

## 8. Guardrails

Runtime checks *around* the model on every request. Eval measures; guardrails *act*.

- **Input guardrails** — prompt-injection detection, PII detection/redaction, out-of-scope
  rejection, jailbreak filters.
- **Output guardrails** — groundedness checks, toxicity/safety filters, format/schema validation,
  policy compliance, PII-leak checks.
- **Actions on violation** — block, regenerate, fall back to a safe response, route to a human, strip
  the offending content.
- **Where they run** — synchronously on the request path (adds latency, so must be cheap) or
  asynchronously for monitoring.

A guardrail's violation rate is itself an online quality metric, and guardrail behaviour belongs in
the offline eval set too.

---

## 9. The eval harness as a deploy gate

- **Prompts, models and retrieval configs are code** — versioned, reviewed, tested. A prompt edit
  goes through CI.
- **The harness runs in CI** — on every change (prompt, model version, retrieval parameters, agent
  tools) it runs the eval set and computes the metrics.
- **Gate on the result** — block the merge or deploy if a primary metric regresses beyond a
  threshold or a guardrail check fails: a test gate with scores instead of asserts.
- **Handle non-determinism** — several samples, thresholds and tolerances rather than exact matches,
  comparison with a baseline rather than an absolute bar.
- **Regression cases** — every incident adds a case, so the same failure cannot ship twice.
- **A/B after the gate** — the offline gate proves "no regression"; an online experiment proves
  "actually better".

```python
baseline = load_scores("main")
candidate = run_eval(eval_set, samples=5)
for m in PRIMARY_METRICS:
    if candidate[m] < baseline[m] - TOLERANCE[m]:
        fail(f"{m} regressed")
if candidate["guardrail_violations"] > 0:
    fail("guardrail check failed")
```

---

## 10. Cost, latency and tracing

### 10a. Cost and latency as first-class metrics

- **Cost** — tokens in/out per request, cost per session, cost per successful outcome. Watch agent
  loops and long contexts.
- **Latency** — p50/p95/**p99**, **time to first token** (what a user feels in a streaming UI), total
  time for multi-step agents.
- **The three-way trade-off** — quality vs cost vs latency. A bigger model, more retrieval or more
  agent steps buys quality at cost and latency; the harness reports all three so the trade-off is
  explicit. A quality win that doubles latency may be a net loss.

### 10b. Traces and spans

One request fans out into retrieval, several model calls and tool calls, so debugging needs:

- **Trace** — the full record of one request or session end to end.
- **Span** — one step within it, with inputs, outputs, tokens, latency and cost.

When an answer is bad, the trace shows *which step* failed — the same attribution logic as the RAG
triad, at the infrastructure level. Langfuse, LangSmith and OpenTelemetry-based GenAI tracing capture
these; you cannot operate an LLM system you cannot trace.

### 10c. Red-teaming

Deliberately trying to break the system: prompt injection, jailbreaks, unsafe or off-brand output,
PII extraction, hallucination-inducing inputs. Findings become guardrails and eval cases. For a
public-facing assistant, red-teaming is a launch prerequisite.

---

## 11. Frameworks

| Tool | What it is for |
|---|---|
| **Ragas** | RAG metrics — the triad, largely judge-based |
| **DeepEval** | Pytest-style LLM assertions run like unit tests in CI |
| **promptfoo** | Prompt/model comparison from config; side-by-side testing and CI gating of prompt changes |
| **OpenAI Evals** | Open framework for defining and running eval suites |
| **LangSmith** | Tracing, eval runs and dataset management (LangChain ecosystem) |
| **Langfuse** | Open-source LLM observability — traces, spans, cost/latency, evals |

The pattern across all: define a dataset, run the system, score with metrics and judges, compare to a
baseline, and fail the build on regression.

---

## Review questions

1. **Why is LLM eval different from classic ML?** No single ground truth, free text,
   non-determinism, many quality dimensions; you evaluate the system, with a portfolio of methods.
2. **How do you gate deploys on quality?** Prompts and models as code; a versioned eval set in CI;
   block on regression or guardrail failure; tolerances for non-determinism; A/B after the gate.
3. **What breaks LLM-as-judge?** Position, verbosity and self-preference bias, non-determinism,
   gameability. Calibrate against humans, prefer pairwise, randomize position, version the rubric.
4. **How do you evaluate RAG?** The triad for attribution, plus IR metrics on retrieval.
5. **How do you evaluate an agent?** Outcome (task success) and process (tool calls, trajectory,
   efficiency, robustness).
6. **Guardrails vs eval?** Eval measures; guardrails act at runtime.
7. **How do you debug a bad answer?** Traces and spans to find the failing step, then a regression
   case.

---

## Further reading

- Ragas, DeepEval, promptfoo, Langfuse and LangSmith docs.
- Zheng et al., *"Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"* — judge biases and
  calibration.
- OpenAI Evals.
- OWASP Top 10 for LLM Applications — prompt injection, data leakage, red-teaming checklist.
- Related: [AWS Bedrock and the AWS-Native GenAI Platform](./aws-bedrock-genai-platform.md) for the
  managed equivalents; [Online Experimentation](./online-experimentation.md) for the A/B that follows
  the gate.
