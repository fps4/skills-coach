---
title: Designing Human–AI Interaction
summary: Designing interfaces for systems that are sometimes wrong — expectations, levels of automation, calibrated trust, showing uncertainty, explanations, recovery from errors, feedback capture, and generative and agent UIs.
---

## Frame

A conventional interface does the same thing every time. An AI feature does not: it is probabilistic,
it changes as the model is retrained, it cannot fully explain itself, and it is sometimes confidently
wrong. Interaction design for AI is the discipline of making that behaviour usable — so people rely on
the system when it is right, catch it when it is wrong, and can tell the difference.

Three mental models:

1. **Design for the error case first.** Every AI feature will be wrong for someone today. The quality
   of the product is decided by what happens then: is the error visible, cheap to fix, and does the
   correction teach the system?
2. **The goal is calibrated trust, not maximum trust.** Over-trust leads people to accept bad output
   without checking; under-trust leads them to ignore good output. The interface should make reliance
   track actual reliability.
3. **Automation is a dial, not a switch.** Between "the person does everything" and "the system does
   everything" lie many levels. Choosing the level per task, and letting it move, is the core design
   decision.

---

## 1. What makes AI interfaces different

- **Probabilistic** — the same kind of input can produce outputs of very different quality.
- **Evolving** — behaviour changes when the model is retrained or replaced, sometimes without notice.
- **Opaque** — the reasoning is not directly inspectable.
- **Adaptive** — it may learn from the user, so their actions shape what they see later.
- **Open-ended** — generative systems can produce anything, including things nobody designed for.

Each of these breaks an assumption that conventional interaction design relies on: predictability,
consistency, and a clear model of how the system works.

---

## 2. Setting expectations

People form a **mental model** of what the system can do within seconds, usually an inflated one.
Set it deliberately:

- **Say what it can do** — and, as importantly, what it cannot.
- **Say how well it does it** — "suggestions are right about 4 times in 5" is more useful than
  silence.
- **Show the scope boundary** — when a request falls outside what the system handles, say so rather
  than attempting it badly.
- **Avoid anthropomorphism that overpromises** — a human name and personality invite people to assume
  human understanding.

These are the first two of Microsoft's published *Guidelines for Human–AI Interaction* (Amershi et
al., 2019): make clear what the system can do, and how well it can do it.

---

## 3. Levels of automation

A widely used scale (after Sheridan, and Parasuraman, Sheridan and Wickens, 2000), simplified:

1. The person does it all; the system offers nothing.
2. The system offers a set of options.
3. The system suggests one option.
4. The system acts if the person approves.
5. The system acts unless the person vetoes within a time window.
6. The system acts and informs the person.
7. The system acts and informs only if asked, or not at all.

Choose per **task**, not per product: drafting a reply can sit at level 3 while filing spam sits at 6.
Higher levels fit high-volume, low-stakes, reversible tasks with a reliable model; lower levels fit
high-stakes, irreversible or ambiguous ones. A good product lets the level **rise with evidence** —
and lets the user lower it.

---

## 4. Trust: misuse and disuse

- **Misuse (over-reliance, automation bias)** — people accept the system's output without checking,
  including when it is wrong. Grows when the system is usually right, when checking is effortful, and
  when people are busy.
- **Disuse (under-reliance)** — people ignore a system that would have helped, often after one
  memorable error.
- **Complacency** — monitoring attention fades when the system rarely fails, so the rare failure goes
  unnoticed.

Design levers for calibration: show uncertainty, make checking cheap (put the evidence next to the
suggestion), require active confirmation for consequential actions, vary presentation so the
suggestion does not anchor the person before they think, and track **override rates** — near-zero
overrides in a fallible system usually means nobody is checking.

---

## 5. Showing uncertainty

- **Confidence scores** — only if the model is **calibrated** (an "80%" is right about 80% of the
  time). Uncalibrated numbers give false precision.
- **Categories instead of numbers** — high / medium / low confidence, or "needs review", is often
  easier to act on.
- **Several alternatives** — showing the top three suggestions signals that the system is not sure
  and lets the person pick.
- **Abstaining** — "I'm not sure; here is what I found" is better than a confident guess. Routing
  low-confidence cases to a person is the interface form of a decision threshold.
- **Grounding** — showing the source a statement came from lets people verify instead of trust.

---

## 6. Explanations

Ask first: **who needs the explanation, and what will they do with it?** A loan applicant needs to
know what would change the outcome; an auditor needs to know the model is not using a protected
attribute; an operator needs to know whether to trust this case.

- **Global explanations** — how the model works overall: the most important features, the kinds of
  case it handles badly.
- **Local explanations** — why this prediction: the features that pushed this score up or down
  (attribution methods such as SHAP).
- **Example-based** — similar past cases and how they turned out.
- **Counterfactual** — the smallest change that would flip the outcome ("approved if the requested
  amount were below €8,000"). Often the most actionable kind.

A caution: explanations can **increase** over-reliance — a plausible reason makes a wrong answer more
convincing. Test whether explanations actually help people catch errors, not only whether they like
them.

---

## 7. Graceful failure and recovery

- **Make errors cheap** — easy to dismiss, edit, undo or ignore a suggestion.
- **Let the person correct, not just reject** — editing a draft keeps the value that was right.
- **Fall back** — when the model is unavailable or unsure, the manual path still works.
- **Match friction to stakes** — no confirmation for a word suggestion, an explicit review step for
  sending a payment or a medical order.
- **Distinguish system failure from model error** — "the service is down" and "I could not find an
  answer" need different responses.
- **Do not repeat a rejected suggestion** — remember dismissals within a session.

---

## 8. Capturing feedback

Feedback is a data pipeline with an interface on top.

- **Explicit** — thumbs up/down, ratings, "report a problem", corrections typed by the user.
- **Implicit** — accepted, edited, ignored, undone, time spent. Abundant but ambiguous: an ignored
  suggestion may be wrong or merely unneeded.
- **Make it cheap** — one click, in context, at the moment of use.
- **Say what happens to it** — people give better feedback when they know it improves their results,
  and they deserve to know if it is used for training.
- **Close the loop** — show that the system learned ("you'll see fewer of these").

---

## 9. Control and agency

- **Override** — the person can always do it differently.
- **Adjust** — settings for how proactive or automatic the system is.
- **Invoke versus proactive** — a feature the person calls when needed annoys less than one that
  interrupts; proactive help must be well-timed and easy to dismiss.
- **Opt out** — of personalisation, of data use, of the feature.
- **Global controls** — let people see and change what the system has learned about them.

---

## 10. Generative and conversational interfaces

- **Chat is not always the right interface.** A text box hides what the system can do; buttons,
  templates and structured inputs often work better for known tasks. Use chat where the space of
  requests is genuinely open.
- **Show work in progress** — streaming output reduces perceived wait.
- **Ground and cite** — link statements to sources so they can be checked.
- **Output is a draft** — make it editable, comparable and regenerable, not final.
- **Agents need checkpoints** — when the system takes actions (sending email, changing records,
  spending money), show the plan, confirm irreversible steps, and keep a visible log of what was done.
- **Guard the inputs** — content the system reads (web pages, documents, email) can carry hidden
  instructions; the interface should not treat it as the user's own request.

---

## 11. Onboarding and cold start

A personalised system knows nothing about a new user. Options: sensible defaults, a few quick
preference questions, popular-item fallbacks, and an explanation that results improve with use. Do
not make the first experience depend on data the system does not yet have.

---

## 12. Prototyping and evaluating the interaction

- **Wizard of Oz** — a person secretly plays the AI behind a working interface. Tests whether the
  interaction is valuable before any model is built, and reveals what quality bar is actually needed.
- **Test with errors in** — deliberately include wrong outputs in prototypes; a design tested only on
  correct outputs has not been tested.
- **Measure the interaction**, not only the model — task success, time to complete, acceptance rate,
  edit distance between suggestion and final result, override rate, and reported trust.

---

## 13. Reference sets

- **Microsoft, *Guidelines for Human–AI Interaction*** (Amershi et al., CHI 2019) — eighteen
  guidelines grouped by when they apply: initially, during interaction, when wrong, and over time.
- **Google PAIR, *People + AI Guidebook*** — patterns for user needs, data, mental models,
  explainability and trust, feedback and control, errors and graceful failure.
- **Parasuraman and Riley, *Humans and Automation: Use, Misuse, Disuse, Abuse*** (1997) — the
  vocabulary of over- and under-reliance.
