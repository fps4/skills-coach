---
title: Data and Model Requirements
summary: The technical and operational requirements of an AI product — data and labels, leakage, evaluation metrics and thresholds, baselines, non-functional needs, the path to production and what it costs to run.
---

## Frame

In a working AI product the model is a small box in the middle of a large diagram. Around it sit the
data that feeds it, the labels that teach it, the evaluation that proves it, the systems that serve
it, and the monitoring that notices when it stops working. Requirements for an AI product are mostly
requirements for that surrounding system.

Three mental models:

1. **Data is the specification.** In ordinary software, behaviour is written in code. In ML,
   behaviour is learned from data, so the data — what it covers, how it was labelled, what it leaves
   out — *is* the specification, and gaps in it become gaps in behaviour.
2. **The model outputs scores; the product makes decisions.** A classifier produces a probability.
   Turning it into an action means choosing a threshold, and that choice is a business decision about
   the cost of each kind of error.
3. **Shipping is the start.** A deployed model decays as the world drifts away from its training data.
   Monitoring, retraining and a way to collect fresh outcomes are part of the requirements, not
   a later phase.

---

## 1. Data requirements

For each candidate data source, write down:

- **Content** — which features, and is the signal plausibly in them?
- **Labels** — is the outcome recorded, how reliably, and how long after the event?
- **Volume** — enough examples of the *rare* class, not only overall. Ten thousand transactions with
  twelve frauds is a dataset of twelve.
- **Coverage** — every segment the product will serve: regions, languages, device types, customer
  groups, seasons. A model has not seen what is not in the data.
- **Freshness** — how quickly it is available, and whether the past still represents the present.
- **Rights** — the legal basis to use it for *this* purpose, consent, contracts, and where it may be
  processed.

There is no universal "enough data". Rough orientation only: a few hundred labelled examples per class
can be enough to fine-tune a pre-trained model; tabular models often want thousands of rows with
enough positives; training deep models from scratch wants far more. Learning curves on a pilot dataset
answer the question better than any rule.

---

## 2. Labels

Where labels come from, roughly cheapest first:

- **Existing outcomes** — the business already records the answer (did the customer churn, was the
  claim paid). Cheap, but may be biased by past decisions.
- **Implicit feedback** — clicks, purchases, edits, dismissals. Abundant, noisy, and shaped by what
  the product showed.
- **Rules and weak supervision** — heuristics label data automatically; noisy but fast.
- **Model-assisted labelling** — a model proposes labels, people correct them.
- **Expert annotation** — accurate and expensive, sometimes the only option (medical images).

Two checks on any labelling effort: **inter-annotator agreement** (if two experts disagree 20% of the
time, no model will do better than that ceiling) and **clear guidelines** with worked edge cases.
**Delayed labels** — fraud confirmed weeks later, a loan defaulting after months — slow both training
and monitoring, and must be planned for.

---

## 3. Data quality and leakage

- **Missing and noisy values** — decide per feature whether to impute, drop or flag.
- **Imbalance** — when one class is rare, accuracy misleads and sampling or weighting may be needed.
- **Target leakage** — a feature that secretly contains the answer. A "cancellation reason" field
  predicts churn perfectly in training and does not exist at prediction time. Leakage produces
  spectacular offline results that collapse in production; suspiciously good numbers are a warning.
- **Temporal leakage** — training on information from after the moment of prediction. Split by time
  when the product predicts the future.
- **Training/serving skew** — features computed one way for training and another way in production.
- **Data contracts** — agreements with the teams that produce the data about its schema, meaning and
  freshness, so upstream changes do not silently break the model.

---

## 4. Splits and validation

- **Random split** — fine when examples are independent and the world is stable.
- **Time-based split** — train on the past, test on the later period; required for forecasting and
  for anything that will predict the future.
- **Group split** — keep all records of one customer, patient or device on the same side, or the model
  is tested on people it has already seen.
- **Cross-validation** — rotate which part is held out, for a more stable estimate on small data.
- **The test set is spent once.** Tuning against it turns it into training data and the reported score
  into an overestimate.

---

## 5. Choosing metrics

| Task | Metrics | Watch out for |
|---|---|---|
| Classification | **Precision** (of those flagged, how many were right), **recall** (of the true cases, how many were found), F1 | **Accuracy** misleads on imbalanced data: 99% accurate by never predicting fraud |
| Ranking a rare class | **PR-AUC** | ROC-AUC looks flattering when negatives vastly outnumber positives |
| Probability estimates | **Calibration** — does "70%" happen 70% of the time? | Uncalibrated scores mislead users and downstream maths |
| Regression | **MAE** (average error, in units), **RMSE** (punishes large errors), MAPE (percentage) | MAPE explodes near zero |
| Ranking and recommendation | precision@k, recall@k, NDCG | Offline gains that do not move online behaviour |
| Generation | Human rubric scores, reference comparisons, model-graded checks | One aggregate number hiding failure types |

Pick the metric that maps to the business cost, and report it **per slice** (per region, customer
type, language), not only overall — an average can hide a segment where the product fails badly.

Every product also needs three levels of metric: a **business metric** (cost per claim, retention), a
**model metric** (recall at a fixed precision) and **guardrail metrics** that must not get worse
(complaints, latency, fairness gaps).

---

## 6. Thresholds and operating points

A fraud model scores 10,000 transactions; 100 are truly fraudulent. Missing a fraud costs €500;
reviewing a flagged transaction costs €5.

| Threshold | Flagged | Fraud caught | Precision | Recall | Missed fraud cost | Review cost | Total |
|---|---|---|---|---|---|---|---|
| A (low) | 300 | 80 | 27% | 80% | 20 × €500 = €10,000 | 300 × €5 = €1,500 | **€11,500** |
| B (high) | 100 | 60 | 60% | 60% | 40 × €500 = €20,000 | 100 × €5 = €500 | **€20,500** |

Threshold B looks better on precision and is nearly twice as expensive. The model is the same; the
operating point is a product decision, and it moves when the costs move. Many products use **two
thresholds**: act automatically above the high one, send to a person between the two, let through
below the low one.

---

## 7. Baselines

Never report a model score alone. Compare it with:

- **Trivial baselines** — always predict the majority class; predict last week's value.
- **A heuristic** — the rule a domain expert would write in an afternoon.
- **Current performance** — the existing process, human or automated, measured on the same data.

If the model does not clearly beat the heuristic, ship the heuristic.

---

## 8. Non-functional requirements

- **Latency** — milliseconds inside a checkout, seconds in a chat, hours for a nightly report.
- **Batch or online** — precompute predictions on a schedule, or compute on request.
- **Throughput and peaks** — predictions per second at the busiest hour.
- **Cost per prediction** — negligible for a small tabular model; significant for large language-model
  calls at volume.
- **Where it runs** — cloud, on-premises, or on the device (for privacy, offline use, or latency).
- **Privacy and residency** — which data may leave which boundary, including to a model provider.
- **Explainability** — whether a person or a regulator needs a reason for each decision.
- **Update cadence** — how often the model must be retrained to stay accurate.
- **Fallback** — what happens when the model is down or unsure.

---

## 9. From prototype to production

1. **Proof of concept** — can a model learn the signal at all, offline, on historical data?
2. **Pilot** — does it help real users in a limited setting, measured against the current process?
3. **Production** — reliable, monitored, integrated, owned.

The production system (often called **MLOps**) adds: data pipelines, a feature store so training and
serving compute features identically, a training pipeline, a **model registry** of versioned models,
staged rollout (**shadow** mode first — the model predicts but nothing acts on it — then a **canary**
on a small share of traffic), and monitoring.

**Monitor four things:** input data (**data drift** — the inputs change), the relationship between
inputs and outcome (**concept drift** — what fraud looks like changes), model performance once labels
arrive, and the business metric. Define in advance what triggers retraining or rollback.

---

## 10. Feedback loops

A deployed model changes the data it will later learn from. A recommender only learns about items it
showed; a fraud model only gets labels for transactions it let through or sent to review. Without
care this narrows the model over time. Countermeasures: a small share of **exploration** (random or
diversified choices), logging what was shown and why, and holding out a control group.

Design the product to **capture outcomes** from day one — corrections, accept/reject actions, final
resolutions. That stream is what turns a static model into one that improves.

---

## 11. People and roles

- **Product manager** — owns the problem, the value case, the metrics and the threshold decisions.
- **Domain expert** — defines labels, judges edge cases, validates outputs.
- **Data scientist** — explores data, builds and evaluates models.
- **ML engineer** — productionises training and serving.
- **Data engineer** — builds and maintains the pipelines.
- **Designer** — shapes how predictions reach people and how people correct them.
- **Legal, privacy and risk** — data rights, regulation, accountability.

---

## 12. What it costs

Budget for: data acquisition and **labelling**, compute for training and experiments, **inference**
(per call, which dominates for large models at volume), the people above, and **ongoing maintenance**.
ML systems accumulate their own kind of technical debt — tangled data dependencies, feedback loops,
pipeline glue — and the code that trains the model is a small fraction of what must be kept running
(Sculley et al., *Hidden Technical Debt in Machine Learning Systems*, 2015).

The production engineering behind this guide — feature stores, serving patterns, rollout and drift
monitoring — is covered in depth in the *ML and AI engineering* skill.
