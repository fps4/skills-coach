---
title: An authored answer key may write the error log
status: accepted
date: 2026-08-07
---

# ADR-0014 — An authored answer key may write the error log

## Context

Until now the error log had exactly one writer: `postCorrection`. That is the shape
[ADR-0001](0001-runtime-not-agent.md) describes — an external coach supplies *judgement* (which
category a mistake belongs to) and the runtime does the arithmetic that follows (counters,
clean-block runs, status transitions, and therefore what gets re-drilled). A coach cannot write a
counter, only report an occurrence.

That works because the only evidence the system had about a learner was free-form writing, and
nothing but a coach can say what is wrong with a paragraph.

A certification pack breaks that assumption. The motivating one is AWS Certified Solutions Architect
– Professional, whose whole assessment format is multiple choice against a published, unambiguous
answer key. There is no judgement to make at answer time: the question's author already made it, in
advance, when they wrote down which option is correct and which task statement the question tests.

Leaving that evidence out of the error log would mean either the adaptation loop cannot see the
learner's main activity, or a second parallel notion of "weak area" exists beside the first. Both are
worse than the alternative, and the second is the kind of drift the single-join-key design exists to
prevent.

## Decision

**A drill item may carry an answer key and the categories it tests, and a wrong answer against that
key records an error-log occurrence directly.** No coach is in the loop at answer time.

A new drill kind, `mcq`, carries:

- `options` and `correct` — the answer key, never sent to the browser before the learner commits
- `categories` — pack-declared error-category ids, validated at publish exactly as a correction's
  categories are validated at post
- `explanation` and per-distractor `why` — the teaching, revealed after the verdict

Grading is set equality: for a multiple-response question every correct option must be selected and
no incorrect one, matching the exam being prepared for. There is no partial credit and no override —
tolerant matching has nothing to be tolerant about when the learner picked from a list.

Four things keep this inside the ADR-0001 boundary rather than through it:

1. **The judgement is authored, not inferred.** The runtime does not decide that an answer was wrong
   in some category; it compares against a key someone wrote down and reads the categories off the
   same item. That is data, arriving through a publish, exactly as a lesson does.
2. **The arithmetic is unchanged and unshared.** `applyOccurrences`, `closeBlock`, `deriveStatus`,
   `redrillCategories`, `retireCategories` and `topRecurring` are untouched. Both writers go through
   one `services/error-log.ts::recordOccurrences`, extracted from `corrections.ts` in this change so
   there is one place counters are written, not two.
3. **Categories are still the pack's.** An mcq naming a category the pack does not declare fails the
   publish, for the same reason an invented one fails a correction: it would accumulate its own
   history and never join anything.
4. **The runtime still generates nothing.** It does not write questions, choose distractors, or
   decide what the next block contains. It counts, and it assembles the brief.

**Quiz sessions are recorded, and scoring them is derived.** A session names the items it asked and
the answers given; the score, the per-domain breakdown and the readiness signal are all computed on
read, never stored — the same rule the error-log status follows, and for the same reason.

## Consequences

**Good.** A certification pack gets the whole existing adaptation loop for the cost of one new drill
kind. The error log, `redrill`/`retire`, the ramp, the brief, `get_brief`, the progress page and
block review all work unchanged, because the join key did not change. An LLM authoring block N+1 sees
weak task statements in the payload it already reads.

The deterministic half of "adaptive" gets sharper: with an answer key the runtime can select the next
20 questions by weakness on its own, before an author is involved at all.

**Costs.** The error log now mixes two kinds of evidence — a coach's reading of a sentence, and a
click against a key. They are not equally informative, and a category's `count` no longer means one
thing. `ErrorExample` records the chosen option against the correct one, which reads oddly next to a
corrected sentence; that is visible in the progress table and accepted.

Answer keys ship to the runtime and are withheld from the browser by `promptFor`, which is the same
guarantee the term and word-order drills already rely on. A bug there leaks the answer, and it now
leaks something a learner has more incentive to want.

Mastery is per item (two correct in a row), so a large bank retires slowly and a question met twice
teaches its own answer as well as its concept. That is a real limitation of reusing the existing
progression machine, taken deliberately over building a second one; if it bites, the fix is a
selection rule in `domain/quiz.ts`, not a new kind of state.

**Not decided here.** Whether a quiz-only pack should close its own blocks. Today `post_block_review`
is still a coach action, and without it nothing retires — see
[the coach loop guide](../../guides/coach-loop.md).
