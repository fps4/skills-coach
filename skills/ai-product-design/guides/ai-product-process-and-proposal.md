---
title: The AI Product Process and Proposal
summary: A four-stage process for taking an AI product from idea to operation, with the gate at each stage, and how to write the executive summary and proposal that wins a decision.
---

## Frame

An AI product moves through uncertainty in a particular order: first *is this worth doing*, then *can
a model learn it*, then *does it help real people*, then *can we keep it working*. A good process
answers those questions in that order, as cheaply as possible, and stops early when the answer is no.
A good proposal shows a decision-maker that the questions have been asked.

Three mental models:

1. **Buy information before you buy software.** Each stage is an experiment that reduces a specific
   uncertainty. Spend little where uncertainty is highest, and more only as it falls.
2. **Every stage ends in a gate.** Go, change course, or stop — decided against criteria written down
   before the stage began. A project without gates drifts into pilot purgatory.
3. **A proposal is an argument, not a description.** Its job is a decision. It states the problem in
   the reader's terms, shows why this approach beats the alternatives, admits the risks, and makes a
   specific ask.

---

## 1. Four stages

Many organisations and courses describe the AI product process in four or five stages; the names vary
and the gates are much the same. The data-mining standard **CRISP-DM** (business understanding, data
understanding, data preparation, modelling, evaluation, deployment) is the common ancestor. One
workable version:

### Stage 1 — Discover and frame

- **Questions** — Whose problem is it and what does it cost? Which decision would a prediction
  improve? What is the current baseline? Is it an AI problem at all? What would success be worth?
- **Activities** — process mapping, interviews with the people who make the decision, rough value
  sizing, a data inventory, an early risk screen.
- **Artefacts** — problem statement, decision decomposition (prediction, judgement, action, outcome),
  value estimate, list of data sources, risk tier.
- **Gate** — the problem is valuable, prediction is the bottleneck, plausible data exists, and the use
  is not prohibited or unmanageably risky.

### Stage 2 — Prototype and validate

- **Questions** — Can a model learn the signal from the data we have? How good is it against the
  baseline? Does the interaction help real users?
- **Activities** — offline model on historical data, error analysis, a Wizard-of-Oz or clickable
  prototype of the interface, tests with a handful of real users.
- **Artefacts** — offline results against baselines, per-slice performance, prototype findings, an
  updated value estimate, the threshold and level of automation proposed.
- **Gate** — the model beats the baseline by enough to matter, no slice fails unacceptably, and users
  can work with it.

### Stage 3 — Build and integrate

- **Questions** — Can it run reliably at production volume, latency and cost? Does it fit the
  workflow? Are oversight, logging and fallbacks in place?
- **Activities** — data and training pipelines, serving, integration into the systems where the
  decision happens, monitoring, documentation (model card), privacy and risk review.
- **Artefacts** — production system, runbooks, monitoring dashboards, approved risk assessment.
- **Gate** — a shadow run or limited pilot shows the system works as validated, and the business
  metric moves.

### Stage 4 — Deploy, operate and improve

- **Questions** — Is it delivering the value promised? Is it degrading? What do users and outcomes tell
  us?
- **Activities** — staged rollout, monitoring of data, model and business metrics, collecting
  feedback and outcomes, retraining, periodic review of fairness and risk.
- **Artefacts** — performance reports, retraining records, incident log, decision to expand, hold or
  retire.
- **Gate (recurring)** — keep, improve, expand to new cases, or retire.

---

## 2. Success metrics, in three layers

Define them in stage 1 and keep them through stage 4:

- **Business metric** — the reason the product exists: cost per invoice, time to resolve, retention,
  revenue per visit.
- **Model metric** — the technical proxy: recall at 95% precision, mean absolute error in days.
- **Guardrail metrics** — what must not get worse: complaints, latency, error rate on a vulnerable
  segment, override rate falling suspiciously low.

A model metric that improves while the business metric does not is a finding, not a success.

---

## 3. The executive summary

One page, written last, read first. A decision-maker should be able to say yes or no from it alone.

1. **Title and one-sentence pitch** — what it does, for whom, with what result.
2. **The problem** — who has it, how often, what it costs today, in the reader's units.
3. **The proposal** — what the system does and where it sits in the workflow.
4. **Why AI** — why rules or process change are not enough, and what the AI approach is.
5. **Evidence** — what has been validated already (a prototype, a backtest, a user test).
6. **Value** — the expected benefit, with the assumptions visible.
7. **Risks and how they are handled** — the two or three that matter most.
8. **Plan and cost** — stages, milestones, budget, team.
9. **The ask** — the specific decision, money or people requested, and by when.

---

## 4. The full proposal

The body behind the summary, one section each:

- **Context and problem** — the current process, its volume and costs, and the people affected.
- **Users and stakeholders** — who uses the output, who is affected by it, who must approve it.
- **Proposed solution** — the decision being supported, the level of automation, the interaction.
- **Data** — sources, labels, volume, quality, rights.
- **Technical approach** — task type, model family, baseline, build/buy/API choice, and why.
- **Evaluation plan** — metrics in three layers, test data, per-slice checks, the threshold logic.
- **Human oversight** — who reviews what, how errors are caught and corrected.
- **Risks** — fairness, privacy, security, regulatory tier, adoption, vendor; each with a control.
- **Operating model** — monitoring, retraining, ownership after launch.
- **Plan** — stages with gates, timeline, team.
- **Costs and value** — build, run and maintain; benefit over time; payback.
- **Alternatives considered** — including doing nothing and a non-AI solution.

---

## 5. A worked value case (synthetic)

A company processes **200,000 supplier invoices a year**. Each takes **6 minutes** of manual entry at a
fully loaded cost of **€40 per hour**.

- **Today** — 200,000 × 6 min = 20,000 hours → **€800,000 a year**.
- **Proposed** — a document-extraction model processes every invoice. **70%** pass straight through
  with a 1-minute spot check; **30%** are low-confidence and handled manually at 6 minutes.
  200,000 × (0.7 × 1 + 0.3 × 6) min = 200,000 × 2.5 min = 8,333 hours → **≈ €333,000 a year**.
- **Gross saving** — ≈ €467,000 a year.
- **Costs** — build €250,000 once; run and maintain €80,000 a year.
- **Net annual benefit** — ≈ €387,000; **payback** ≈ 250,000 / 387,000 ≈ **8 months**.

Then state the assumptions that would break it: the straight-through rate (70% is the number to
validate in the prototype), the accuracy of straight-through invoices (a wrong amount paid has its own
cost), and adoption by the accounts team. A sensitivity line shows the reader you know where the case
is fragile: at **50%** straight-through, 200,000 × (0.5 × 1 + 0.5 × 6) min = 11,667 hours ≈ €467,000,
so the saving falls to ≈ €333,000, the net benefit to ≈ €253,000, and payback stretches to about
**12 months**.

---

## 6. Internal stakeholders versus investors

| | Internal sponsors | Investors |
|---|---|---|
| **Care most about** | Cost, risk, fit with operations, who does the work | Market size, growth, defensibility, team |
| **Value shown as** | Savings, cycle time, quality, payback period | Revenue potential, margins, scalability |
| **Risk they probe** | Disruption, compliance, data access, change management | Competition, moat, dependence on a model vendor |
| **The ask** | Budget, people, access to data and systems, a pilot site | Capital for a stage, against milestones |

For investors, the AI-specific questions are: what stops a competitor calling the same model API, is
there a proprietary data advantage, and how do margins look once inference costs are included?

---

## 7. Questions a good reviewer asks

- What is the baseline, and how much better is this, on what data?
- What happens when it is wrong, and who notices?
- Which segment does it work worst for?
- Where do labels come from after launch?
- What does it cost per decision at full volume?
- Who owns it in a year?
- Which regulation applies, and what tier is this?
- What is the smallest version we could ship to learn the most?
- What would make us stop?

A proposal that answers these before they are asked earns the decision.
