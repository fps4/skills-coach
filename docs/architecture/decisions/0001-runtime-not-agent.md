---
title: The runtime generates nothing; coaching enters through an API
status: accepted
date: 2026-08-01
---

# ADR-0001 — The runtime generates nothing

## Context

Skills Coach is a training platform whose value depends on adaptation: lessons that respond to what a
learner actually gets wrong, and corrections that explain rather than just mark. Both of those are
language-model work today.

The obvious design is to put a model client in the runtime and let it author and correct inline. The
program this platform replaces did the opposite by accident — the "correction loop" was a chat
session with a person's assistant, and the system of record was a folder of markdown files. That
turned out to be a strength, not a limitation: the loop worked from day one, with zero inference
infrastructure, and the model in use could change without anything else changing.

We also have a near-term constraint: for now, generation happens in an LLM CLI a person drives, not
in a service. Later we may want the runtime to call a model API directly.

## Decision

**The runtime contains no model client.** It stores content and learner state, evaluates the
deterministic parts, and exposes a versioned coach API (`/coach/v1`). Everything generative happens on
the other side of that API.

The split follows what is actually decidable by rule:

| The runtime decides | An external coach decides |
|---|---|
| Whether a drill answer matches | Whether free-form writing is correct |
| Streaks, stage gating, mastery | Which error category a mistake belongs to |
| Error-log counts and status transitions | What the next block should teach |
| Progression, and what goes into a brief | The prose of a lesson |

Two consequences are load-bearing:

- **The runtime, not the caller, applies error-log deltas.** A correction supplies categorised items;
  the service layer moves the counters. Adaptation stays deterministic and auditable even though its
  input is a model's judgement.
- **`GET /coach/v1/blocks/:id/brief` is a runtime responsibility.** Assembling the evidence for the
  next block — error-log state, ramp position, program goal — is aggregation, not generation. The
  coach consumes a brief; it does not have to go find the evidence.

## Consequences

**Good.** The caller is swappable: a person with a CLI today, a service calling a model API later,
without the API changing. The system is fully testable with no model in the loop, and CI needs no API
key. Model spend is visible where it happens rather than buried in a request path. Nothing about a
model vendor leaks into the data model.

**Costs.** Correction is asynchronous — a learner submits and waits for a coach to work the queue.
That is honest about how the program already worked, but it is not the instant feedback an inline
model would give. There is also a real risk of a "small exception" — one endpoint that just calls a
model — that would quietly dissolve this boundary. `AGENTS.md` names that explicitly.

**When to revisit.** If synchronous correction becomes a product requirement, the change is to add a
service that calls a model and posts to `/coach/v1` on the learner's behalf — a new *caller*, still
not a model client in the runtime. Reopen this ADR only if that shape proves untenable.
