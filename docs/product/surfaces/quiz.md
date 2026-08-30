---
title: Oefentoets — the practice test
surface: quiz
status: built
---

# Oefentoets (practice test)

| | |
|---|---|
| **Surface key** | `quiz` |
| **Route** | `/{locale}/quiz?blockId=…` |
| **Capability** | `drill:practice` — a sitting is a way of grouping practice, not a second kind of it |
| **Appears when** | the block has at least one `mcq` drill item, and the pack has not opted out ([ADR-0019](../../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)) |
| **Decides** | `quizSessions`, plus the same `drillState`, `attempts` and `errorLog` writes any drill attempt makes |

A fixed set of questions, assembled from what the learner keeps getting wrong, answered through in
one go, then reviewed.

## The two things it does not do

Both are load-bearing:

- **It does not re-implement grading.** An answer goes through `drills.recordAttempt`, the same path
  the word trainer uses. A question answered inside a sitting moves the same drill state, writes the
  same `attempts` row, and records the same error-log occurrence as one answered outside it.
- **It does not store a score.** `scoreSession` and `breakdownByCategory` are pure and run on read.
  A stored score is a persisted judgement about a person, and it can drift from the answers it was
  computed from.

## Data it needs

An `mcq` drill item, which carries its own answer key
([ADR-0014](../../architecture/decisions/0014-an-authored-answer-key-may-write-the-error-log.md)):

```jsonc
{
  "kind": "mcq",
  "stem": "A company runs …",                        // often long — a paragraph, not a headline
  "options": [{ "ref": "A", "text": "…" }, …],        // at least two, refs unique
  "correct": ["B", "D"],                              // at least one; every ref must be defined
  "explanation": "Why the key is the key.",           // required
  "distractors": [{ "ref": "A", "why": "…" }],        // optional, per wrong option
  "categories": ["multi-account-strategy"],           // at least one; checked against the pack
  "sourceRefs": ["SAP-C02 §2.1"],                     // optional — makes a disputed key checkable
  "difficulty": "hard"                                // optional, carried and uninterpreted
}
```

Unlike a word-order alternative — where a malformed `partsAlt` degrades the item to single-order — a
**malformed answer key fails the publish**. An item whose `correct` names an option it does not
define would mark every learner wrong forever, silently.

## The rules

### Selecting the sitting

This is the deterministic half of "adaptive". An external author decides what the next block
*contains*; this decides which of the questions that exist to ask *now*, from the error log the
runtime already keeps. Both halves read the same evidence, which is the only reason they cannot
disagree about what a weak area is.

Selection is **a sort, not a scoring model**. Three keys:

1. **Weakness** — the strongest error-log status among the categories the question tests:
   `recurring` 3 · `new` 2 · `improving` 1 · `mastered` 0. A category with **no** log entry ranks as
   `new`: it has never cost the learner anything, but it has never been proven either.
2. **Least practised** — within one weakness band, an item never seen outranks one attempted twice.
3. **Id** — so the same evidence always produces the same sitting, which is what makes it testable.

Take the first `size` (default **20**, max 75).

Candidates are every non-mastered `mcq` in the block — **including questions already answered
correctly once**. The streak rule is what retires an item; a sitting that only showed unseen
questions would run out long before the bank did.

Two refusals at start:

- a block with no questions → `404`
- every question mastered → `400` ("every question in this block is mastered")

The surface turns both into an explained state rather than an error.

### The order is fixed at start

`itemIds` is stored on the session. A learner who reloads mid-sitting resumes **the same** sitting,
not a fresh one assembled from evidence that has since moved. The next question is simply the first
in that fixed order that has no answer yet.

### Grading

Set equality, no partial credit. From the exam this was built for:

> Multiple response: has two or more correct responses out of five or more response options. You
> must select all the correct responses to receive credit for the question.

A learner who picks two of three correct options has designed an architecture that does not work.
`missed` and `spurious` are reported so the review can show *which* — that is teaching, not scoring.

- `requiredCount` is the de-duplicated size of `correct`, and drives the "choose TWO" instruction.
- More than one → checkboxes; exactly one → radios.
- Options are shuffled deterministically, seeded from the item id: the same order on reload, but
  shuffled at all, because an author who writes the correct option first every time would be
  teaching position rather than content.
- **Refs the item does not define are ignored**, not counted wrong. They cannot have come from the
  surface, and a client bug should not land in a learner's error log.
- **An empty `chosen` is a deliberate skip and is graded wrong**, as the real exam does.
- **There is no override.** Tolerant matching exists because free text cannot be enumerated; picking
  from a list can be, so a rejection here is never the grader's fault.

A wrong answer writes one error-log occurrence per declared category, through the same writer a
coach's correction goes through. Only misses are recorded — the error log is a record of what went
wrong, and counting successes there would need a second set of status rules to mean anything.

### The two modes

| | Practice | Exam |
|---|---|---|
| Verdict per answer | immediately, with explanation | **withheld** — `result` is `null` |
| Question strip marks | correct / wrong | `done` only |
| Everything revealed | as you go | at finish |

Exam mode rehearses committing to an answer you cannot check, which is the skill the real thing
tests. It is enforced **server-side**: in exam mode the answer endpoint returns no verdict at all,
so the key is not in the page to be read out of.

### The clock

Optional, and **advisory**. It counts down, it says so when it hits zero, and then nothing happens —
no auto-submit, no voiding. Voiding a sitting would destroy the evidence the next block gets written
from, which is a strange thing to do to someone for being slow.

The surface offers `SECONDS_PER_QUESTION = 144` × 20, roughly the real exam's 180-minutes-over-75
pace. The API takes any `limitSeconds` up to four hours.

### Answering, once

- Answering a question not in the sitting → `400`.
- Answering the same question twice → `400`, a conflict rather than an update. It would move the
  drill state twice for one question, and the sitting is the record of what was asked once.
- Answering a finished sitting → `400`.

### Finishing

Idempotent — finishing twice keeps the first timestamp. The clock is read **once** and the value
written is the value returned, so two views of the same sitting cannot disagree by a millisecond.

`complete` is reported but not required: a sitting can be finished part-answered, and the score is
correct over *answered*, not over asked.

## API

```http
POST /api/v1/quiz/sessions            { blockId, mode?, size?, limitSeconds? } → 201 QuizSessionView
GET  /api/v1/quiz/sessions            ?packId&blockId&limit                    → { sessions }
GET  /api/v1/quiz/sessions/:sessionId                                          → QuizResults
POST /api/v1/quiz/sessions/:id/answers { drillItemId, chosen: string[] }       → AnswerOutcome
POST /api/v1/quiz/sessions/:id/finish                                          → QuizResults
```

Another learner's sitting is a **`403`**, not a `404` — the caller is authenticated and the resource
exists, which is the learner surface's convention for a resource that is not content.

`QuizSessionView` is `{ session, score, current }`. `current` carries the prompt **without the key**
and its `index` in the fixed order; it is `null` once the sitting is answered through.

`QuizResults` adds `byCategory` (weakest first — the list exists to be acted on, and the top of it
is the action), `complete`, and `review`: every question asked, with its key, explanation,
distractor notes, categories and `sourceRefs`. **The review is the point of the sitting.**

A question tagged with two categories counts once against **each** in the breakdown. Splitting the
credit would make a two-category question worth less than a one-category one.

## The screen

**Before starting** — mode (Practice / Exam, each with a hint) and an optional timer, then *Start*.

**During**:

```
Oefentoets                                        ⏱ 47:31
Practice · 7/20
[✓][✓][✗][✓][⚑][•][ ][ ][ ][ ] …          ← the question strip
┌──────────────────────────────────────────────────────────────────────┐
│ A company runs …                          ← the stem, as a paragraph │
│ Choose TWO.                                                          │
│ ☐ A …   ☑ B …   ☐ C …   ☑ D …                                        │
│ [ Antwoord ]  [⚑ Markeer]                                            │
└──────────────────────────────────────────────────────────────────────┘
```

Behaviour the rebuild must keep:

- **The strip marks four states**: unanswered, flagged, done (exam), correct/wrong (practice).
  Flagging is client-side only — it is a working note for this sitting, not learner state worth
  persisting.
- **Submit is disabled with nothing chosen.** A skip is a deliberate act; the API accepts an empty
  `chosen`, the button does not send one by accident.
- **Single-answer questions replace the selection**; multiple-answer questions toggle.
- **After a practice verdict**, options are marked four ways: `correct` (key, picked), `missed`
  (key, not picked), `wrong` (picked, not key), and unmarked. Then the explanation, the distractor
  notes, and the sources.
- **In exam mode answering advances straight on** — no verdict, nothing to read.
- **Finishing is always available**, part-answered included.
- The results view offers a restart, which starts a *new* sitting — assembled from evidence that now
  includes this one.

## Deliberate refusals

- **No partial credit**, and no "you were close".
- **No override.**
- **No stored score**, and no stored judgement of any kind.
- **The clock never voids a sitting.**
- **The key never reaches the page before the learner commits** — and in exam mode, not until finish.

## Where the code is

| | |
|---|---|
| Selection, scoring, breakdown | `api/src/domain/quiz.ts` |
| Answer-key rules | `api/src/domain/mcq.ts` |
| Sittings | `api/src/services/quiz.ts` |
| Grading path (shared) | `api/src/services/drills.ts` → `recordAttempt` |
| Routes | `api/src/http/learner.ts` |
| Screen | `web/src/components/quiz-runner.tsx`, `quiz-results.tsx`, `ui/option-list.tsx` |
| Strings | `web/src/i18n/dictionaries.ts` → `quiz` |
