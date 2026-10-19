---
title: AI Product Risks and Governance
summary: The challenges of shipping AI — why projects fail, bias and fairness, privacy, security, robustness, the EU AI Act's risk tiers, governance frameworks, adoption, and sector cautions for healthcare and education.
---

## Frame

An AI product carries every risk of ordinary software plus a set of its own: it can be unfair without
anyone intending it, leak what it was trained on, be manipulated through its inputs, degrade silently,
and make decisions about people that the law treats as high-risk. Recognising these early is cheaper
than discovering them in production or in the press.

Three mental models:

1. **Most AI projects fail for non-model reasons.** Unclear problems, missing data, no path into the
   workflow and no owner kill more projects than poor accuracy does.
2. **Harm follows from data and deployment, not intent.** A model trained on historical decisions
   learns historical patterns, including unfair ones; a model used outside the population it was built
   for fails in ways nobody tested.
3. **Risk scales with the decision, not the technology.** The same model is minimal-risk recommending
   songs and high-risk ranking job applicants. Regulation and governance follow the use case.

---

## 1. Why AI projects fail

- **The problem was not worth solving**, or was not a prediction problem.
- **The data did not exist**, was not accessible, or did not carry the signal.
- **Pilot purgatory** — a proof of concept succeeds and never gets the integration, owner or budget to
  reach production.
- **No path to action** — the prediction arrives but no process changes.
- **No adoption** — users distrust it, it adds work, or incentives reward ignoring it.
- **Unmeasured value** — no baseline was recorded, so success cannot be shown.
- **No one owns it after launch** — the model drifts and nobody notices.

---

## 2. Bias and fairness

**Where bias comes from:**

- **Historical** — the data faithfully records an unfair past (past hiring decisions).
- **Representation** — some groups are under-represented, so the model is worse for them.
- **Measurement** — the label is a poor proxy that differs by group (arrests as a proxy for crime;
  healthcare spending as a proxy for health need).
- **Aggregation** — one model for groups that behave differently.
- **Evaluation** — the test set does not reflect the people the product serves.
- **Deployment** — the model is used for a purpose or population it was not built for.

**Fairness definitions** (for a yes/no decision):

- **Demographic parity** — each group receives positive decisions at the same rate.
- **Equal opportunity / equalised odds** — each group has the same true-positive rate (and, for
  equalised odds, the same false-positive rate).
- **Calibration within groups** — a given score means the same likelihood in each group.

When base rates differ between groups, these definitions **cannot all be satisfied at once** (a
mathematical result shown independently by Kleinberg, Mullainathan and Raghavan, and by Chouldechova,
both 2016). Choosing one is a value judgement about the context, and should be made explicitly,
documented and owned — not left to whatever the training loop happened to produce.

**Mitigation:** evaluate every metric **per group**; fix the data (collect, rebalance, relabel);
constrain training; adjust thresholds per group where lawful; and keep a human review for affected
decisions. Removing a protected attribute from the inputs is not enough — other features act as
proxies for it.

---

## 3. Privacy

- **Lawful basis and purpose limitation** (GDPR) — personal data collected for one purpose cannot
  simply be reused to train a model for another.
- **Data minimisation** — use only what the purpose needs.
- **Automated decisions** — GDPR Article 22 gives people rights against decisions based solely on
  automated processing that significantly affect them; in practice, meaningful human review and an
  explanation are needed for such decisions.
- **Data protection impact assessment (DPIA)** — required for high-risk processing, which most
  consequential AI uses of personal data are.
- **Pseudonymised is still personal** — only properly anonymised data falls outside GDPR, and
  anonymisation is hard to achieve with rich data.
- **Memorisation** — models, especially large ones, can reproduce fragments of their training data.
- **Third-party models** — sending personal or confidential data to an external model provider is a
  data transfer; check the contract, retention and training terms.

---

## 4. Security

- **Prompt injection** — instructions hidden in content a language model reads (a web page, an email,
  a document) override the developer's instructions. The defining security problem of LLM products,
  with no complete fix: limit what the model can do, separate trusted from untrusted input, and confirm
  consequential actions.
- **Data poisoning** — corrupting training data to plant a behaviour.
- **Adversarial examples** — small, crafted input changes that flip a prediction.
- **Model extraction and inversion** — reconstructing a model or its training data through queries.
- **Insecure output handling** — model output executed as code or inserted into pages without checks.

The OWASP *Top 10 for LLM Applications* is the standard checklist for generative products.

---

## 5. Robustness and reliability

- **Distribution shift** — the world changes and the model's accuracy falls with it.
- **Edge cases and the long tail** — rare situations the data barely covered.
- **Hallucination** — generative models produce fluent falsehoods.
- **Over-reliance** — people stop checking a usually-right system (see automation bias).

Mitigations: stress-testing on hard and rare cases, monitoring in production, fallbacks, human review
at the boundaries, and a clear statement of the conditions the model was validated for.

---

## 6. Transparency and accountability

- **Model cards** — a short document per model: intended use, out-of-scope uses, training data,
  evaluation results overall and per group, known limitations (Mitchell et al., 2019).
- **Datasheets for datasets** — where the data came from, how it was collected and labelled, what it
  should not be used for (Gebru et al., 2018).
- **Audit trail** — log inputs, model version, output and the final human decision, so any decision
  can be reconstructed.
- **Named ownership** — a person accountable for each model in production.
- **Disclosure** — tell people when they are interacting with an AI system or when AI shaped a
  decision about them.

---

## 7. Regulation: the EU AI Act

The EU AI Act classifies AI systems by the risk of their **use**:

| Tier | Examples | Consequence |
|---|---|---|
| **Unacceptable** | Social scoring by public authorities, manipulative techniques causing harm, emotion recognition in workplaces and schools (with narrow exceptions), certain biometric uses | Prohibited |
| **High-risk** | AI as a safety component of regulated products (medical devices, machinery); uses listed in the Act's Annex III — employment and worker management, education and vocational training (admission, assessment), access to essential services (credit scoring, benefits), critical infrastructure, law enforcement, migration, justice, biometrics | Risk management, data governance, technical documentation, logging, transparency to deployers, **human oversight**, accuracy and robustness, conformity assessment, registration |
| **Limited (transparency)** | Chatbots, AI-generated or manipulated content (deepfakes) | Tell people they are dealing with AI; label synthetic content |
| **Minimal** | Spam filters, recommendations in games | No specific obligations |

Separate obligations apply to providers of **general-purpose AI models** (foundation models). The Act
entered into force in 2024 and its obligations apply in phases; check the current timeline for the
tier that applies, as dates for some high-risk obligations have been subject to change.

**Sector rules still apply on top**: medical device regulation, financial supervision, consumer
protection, employment law, and the GDPR.

---

## 8. Governance frameworks

- **NIST AI Risk Management Framework** — four functions: **Govern** (culture, roles, policies),
  **Map** (context and risks of a use), **Measure** (assess and track those risks), **Manage**
  (prioritise and act on them).
- **ISO/IEC 42001** — a certifiable management-system standard for AI, in the style of ISO 27001 for
  security.
- **ISO/IEC 23894** — guidance on AI risk management.

In practice, governance for a product team means: an inventory of AI uses, a risk tier for each, a
review before launch scaled to that tier, documented decisions on trade-offs (thresholds, fairness
definition, level of automation), and monitoring with named owners.

---

## 9. Adoption and organisational change

- **Involve users early** — the people whose work changes should help design how.
- **Fit the workflow** — a prediction in a separate dashboard is a prediction ignored.
- **Align incentives** — if people are measured on volume, a tool that asks them to review more will
  be bypassed.
- **Train for judgement** — when to trust, when to check, how to override and report.
- **Be honest about jobs** — explain which tasks change and what happens to the people doing them.
- **Champions** — respected early users spread adoption faster than mandates.

---

## 10. Sector cautions

**Healthcare**
- Clinical validation on the population where the product will be used, ideally prospectively.
- Many diagnostic and treatment uses are regulated as medical devices and are high-risk under the
  AI Act.
- **Alert fatigue** — too many low-value alerts teach clinicians to ignore all of them.
- Liability and accountability stay with clinicians and institutions; augmentation is the default.
- Workflow integration with health record systems decides adoption.

**Education**
- AI used for admission, assessment, placement or proctoring is **high-risk** under the AI Act.
- Learners are often minors; their data needs particular protection.
- Equity — a tool that works best for students who already do well widens gaps.
- Academic integrity — generative tools change what assignments measure.
- Teachers stay in control of consequential judgements about learners.

---

## 11. A risk register for an AI product

For each risk record: the risk, who is affected, likelihood, impact, the control in place, how it is
monitored, and the owner. A starting list:

- Model underperforms for a subgroup.
- Data used beyond its lawful purpose.
- Personal data sent to a third-party model.
- Prompt injection leads to an unwanted action.
- Model drifts without detection.
- Users over-rely on outputs in high-stakes cases.
- Use case falls into a regulated or high-risk category.
- Adoption fails and value is not realised.
- Vendor model changes behaviour or pricing.
