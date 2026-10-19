---
title: Framing AI Opportunities
summary: Deciding whether a problem is an AI problem — prediction as the unit of value, augment vs automate, the cost of being wrong, and sizing value against feasibility before anything is built.
---

## Frame

Most AI products that fail were built well and aimed badly. The model worked; the problem was not
one a model could change, the data did not carry the signal, or nobody's work changed when the
prediction arrived. Framing is the step that prevents this, and it happens before anyone opens a
notebook.

Three mental models:

1. **AI sells predictions, not decisions.** A machine-learning system fills in information you do
   not have — will this customer churn, what does this image show, what word comes next — from
   patterns in data. A *decision* needs that prediction plus judgement about what each outcome is
   worth, plus an action someone is able to take. An opportunity is a decision where the prediction
   is the expensive or slow part.
2. **The baseline is the current process, not perfection.** A model that is wrong 8% of the time is
   a good product if the current process is wrong 15% of the time and slower. It is a bad one if a
   three-line rule is wrong 9% of the time and costs nothing to run.
3. **Value and feasibility are separate axes.** A brilliant idea with no data is a research project;
   an easy idea nobody needs is a demo. Score both, separately, before committing.

---

## 1. Prediction as the unit

Decompose any candidate decision into four parts:

| Part | Question | Fraud example |
|---|---|---|
| **Prediction** | What do we not know that we would like to? | Probability this payment is fraudulent |
| **Judgement** | What is each outcome worth to us? | A blocked good customer costs goodwill; a missed fraud costs the amount |
| **Action** | What can we do with the answer? | Allow, step-up authentication, hold for review, block |
| **Outcome** | How will we know if we were right? | Chargebacks, customer complaints, review verdicts |

If the action column is empty — nobody can do anything differently with the prediction — there is no
product, however accurate the model. If the outcome column is empty, the model can never be measured
or improved.

This framing comes from the economics of AI (Agrawal, Gans and Goldfarb, *Prediction Machines*):
as prediction gets cheaper, the things that complement it — data, judgement and the ability to act —
become the scarce and valuable parts.

---

## 2. Is it an AI problem?

**Signs it is:**

- A **repeated decision at volume** — thousands of tickets, transactions, images or documents, not
  one strategic choice a year.
- The pattern is **too complex or too fluid for hand-written rules**: many weak signals, rules that
  keep needing exceptions, or a world that changes faster than rules can be maintained.
- **Data exists that carries the signal**, and historical outcomes exist to learn from.
- The business can **tolerate some error**, and errors can be caught or reversed.
- There is a **feedback signal** — a way to learn after the fact whether the prediction was right.

**Signs it is not:**

- The rules are known and stable. *If you can write the rules down, write the rules.*
- The decision needs guaranteed correctness or a complete, auditable chain of reasoning that a
  statistical model cannot give.
- There is no data, or the data does not contain the information (you cannot predict machine
  failure from data that never recorded vibration or temperature).
- The bottleneck is process, politics or incentives — a faster prediction feeds a queue that was
  never the slow part.

---

## 3. The ladder of approaches

Start at the bottom and climb only when the step below is not good enough:

1. **Process change** — remove the decision, or move it to where the information already is.
2. **Rules and heuristics** — explicit logic. Cheap, transparent, brittle at the edges.
3. **Classical machine learning** — learned from tabular data. Cheap to run, moderately
   interpretable, needs labelled history.
4. **Deep learning** — learned from images, audio, text and other unstructured data. Needs more data
   and compute, less interpretable.
5. **Foundation models and generative AI** — a pre-trained model adapted by prompting, retrieval or
   fine-tuning. Fast to prototype, can work with little labelled data, costs per call, and can be
   confidently wrong.

Whatever you build, keep the simplest working rung as the **baseline** the AI must beat.

---

## 4. Finding opportunities in a process

AI rarely replaces a job; it changes some of the tasks inside one. To find where it helps:

1. **Map the process** as steps, with who does each, how long it takes and how often it happens.
2. **Mark the decision points** — the steps where someone looks at information and chooses.
3. For each decision point, ask: is the slow or error-prone part *working out what is true*
   (prediction), *deciding what to do about it* (judgement), or *doing it* (action)?
4. **Target prediction-heavy, high-volume steps** where better or faster answers change the outcome.
5. Distinguish **AI inside a process** (internal efficiency: routing, triage, extraction,
   forecasting) from **AI as the product** (the customer pays for the prediction: recommendations,
   search, an assistant). They have different success metrics, risks and owners.

Typical prediction-heavy tasks: classifying and routing incoming work, extracting fields from
documents, forecasting demand or load, detecting anomalies, ranking options, drafting text a person
then edits.

---

## 5. Augment or automate

| | Augment (human in the loop) | Automate (human on or out of the loop) |
|---|---|---|
| **The model** | Suggests, ranks, drafts or flags | Decides and acts |
| **The person** | Decides, with the suggestion in view | Monitors, handles exceptions, audits |
| **Fits when** | Errors are costly or irreversible, cases vary, accountability must stay with a person | Volume is high, errors are cheap and reversible, cases are routine |
| **Risk** | Automation bias — the person stops checking | Silent failure at scale |

Most products start as augmentation and move cases into automation as evidence accumulates: the
model handles the confident, routine 70%, and routes the uncertain 30% to people. The split is a
threshold, and the threshold is a business decision (see the cost of being wrong, below).

---

## 6. The cost of being wrong

Every classifier makes two kinds of mistake, and they almost never cost the same:

- **False positive** — the model says yes, the truth is no (a good payment blocked, a healthy
  patient flagged, a legitimate email sent to spam).
- **False negative** — the model says no, the truth is yes (fraud let through, a disease missed, a
  phishing email delivered).

Write down, in money or harm, what each mistake costs *before* choosing a model or a metric. That
asymmetry decides the threshold, the level of automation and whether the idea is viable at all. Also
ask whether an error is **reversible** (a recommendation the user ignores) or **irreversible** (a
loan denied, a shipment sent): irreversible errors pull hard towards augmentation.

---

## 7. Sizing the value

A rough value model is enough to rank ideas:

```
annual value ≈ decisions per year
             × improvement per decision (time saved, error avoided, revenue gained)
             × share of decisions the system actually handles
             × adoption (share of people who use it as intended)
```

Value comes in five shapes: **cost** (less effort per unit), **speed** (faster cycle time),
**quality** (fewer errors), **revenue** (better conversion, retention, pricing) and **new
capability** (something that was not possible at any price before). Compare against the current
process, and be honest about adoption — a tool people route around delivers nothing.

---

## 8. Judging feasibility

Five questions, each a reason projects stall:

1. **Data** — does it exist, can we legally use it for this purpose, does it contain the signal,
   are there labelled outcomes, is there enough of it covering the cases that matter?
2. **Technical maturity** — has this kind of task been solved elsewhere (document extraction: yes;
   predicting a novel's commercial success: not reliably)?
3. **Integration** — can the prediction reach the person or system that acts on it, in time?
4. **People** — do we have, or can we hire or buy, the skills to build and run it?
5. **Risk and regulation** — is the use case restricted, high-risk or reputationally dangerous?

Place each candidate on a **value × feasibility** grid. Start with high value and high feasibility —
a first project that ships builds the data, the team and the credibility the harder ones need.
High value with low feasibility is a longer bet; low value with high feasibility is a learning
exercise at best.

---

## 9. Build, buy or call an API

| Option | Effort | Control | Fits when |
|---|---|---|---|
| **Use an AI feature in a product you already buy** | Lowest | Lowest | The task is generic (transcription, translation, spam filtering) |
| **Call a foundation model through an API, with prompts and retrieval** | Low | Medium | Language or image tasks, little labelled data, fast learning matters |
| **Fine-tune a pre-trained model** | Medium | High | The generic model is close but not good enough, and you have examples |
| **Train your own model** | Highest | Highest | Tabular prediction on your own data, or the model is the differentiator |

Build where the AI is your differentiator or your data is unique; buy where the task is a commodity.
Cost per call, data leaving your boundary, vendor lock-in and how fast the underlying models change
all belong in the comparison.

---

## 10. Data advantages and moats

A **data flywheel** — more use produces more data, which improves the model, which attracts more
use — is a real advantage only when three things hold: usage generates data the model can learn
from, that data is not available to competitors, and extra data still improves the model enough for
users to notice. Many products hit diminishing returns early, and many "proprietary" datasets are
easy to approximate. Treat a claimed moat as a hypothesis to test.

---

## 11. Opportunities by sector

- **Healthcare** — triage and prioritisation of cases, a second reader for medical images, drafting
  clinical notes from a conversation, predicting no-shows to improve scheduling. High stakes, strict
  validation and regulation; augmentation is the norm.
- **Education** — adaptive practice that targets each learner's weak spots, feedback on drafts,
  early warning of students at risk of dropping out, generating practice items. Stakes vary from
  low (a practice question) to high (admission or grading decisions, which are regulated).
- **Operations** — demand forecasting, predictive maintenance, document processing, route and
  schedule optimisation, quality inspection from images.
- **Customer-facing** — routing and answering support requests, search and recommendation,
  personalisation, churn prediction.

---

## 12. Common traps

- **A solution looking for a problem** — starting from "we should use AI" instead of from a costly
  decision.
- **Optimising a proxy** — predicting clicks when the goal is satisfaction, or time-on-page when the
  goal is a solved problem.
- **Pilot purgatory** — a successful proof of concept that never gets integration, an owner or a
  budget to reach production.
- **Ignoring adoption** — the model is right and nobody changes how they work.
- **Benchmarking against perfection** — rejecting a system that beats the current process because
  it still makes mistakes.
