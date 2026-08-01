---
title: "PRD-0001 — Dutch conversation pack, M0"
status: current
date: 2026-08-01
milestone: M0
---

# PRD-0001 — Dutch conversation coach (M0)

## Why

The Dutch program that motivates this platform already works, and is entirely manual. Lessons are
markdown files opened by hand. The vocabulary and word-order trainers are single-file browser pages
that ask the learner to pick a folder and keep progress in `localStorage` — so progress is per-browser,
invisible, and lost when site data is cleared. Every session log and every row of the cumulative error
log is typed out by hand after the fact.

The adaptive step depends entirely on that hand-written record surviving and being read. It works
because one person is disciplined about it. It does not survive a busy month.

**M0 puts a backend under exactly what exists, losing nothing.**

## Scope

M0 is complete when a learner can run the whole daily loop in the application, and the external coach
can run the whole correction and authoring loop through the API.

### Learner

- Sign in via identity-service; interface in Dutch or English, switchable, remembered.
- See where they are: current pack, block and lesson, and what is next.
- Read a lesson with every section kind rendered appropriately — text, rules, vocabulary, questions,
  speak, write, listening, dictation, exercise (answers revealed on request, not before).
- Submit written answers for a lesson, and later read the correction as a session log.
- Practise vocabulary with the original rules intact: two correct in a row clears a stage; the
  reverse direction is gated behind the forward one; a wrong answer resets the streak; tolerant
  matching with a "no, I was right" override.
- Practise word order the same way: build the sentence from shuffled chunks, per-chunk feedback, the
  grammar tip on reveal, a second valid order gated behind the first, and "that is also correct
  Dutch, but this round we are practising the other order" when they build the alternative.
- See progress: the live error log with categories, counts and statuses, plus mastery counts.

**Progress is server-side.** That is the single biggest change from the browser trainers — the same
rules, but the state follows the learner rather than the browser.

### External coach

- Publish a pack manifest, and publish a block with its lessons and drill decks atomically.
- Pull the queue of pending submissions.
- Post a correction: categorised items with explanations, a tally, advisory ratings.
- Post a block review with the brief for the next block.
- Fetch an assembled brief for authoring the next block.

### Migration

The importer reads the existing directory layout — per-block markdown lessons, `woordenschat.csv`,
`zinsvolgorde.csv` — and publishes it. It must handle the optional `Les` column and the optional
second word order (`DelenB`), silently ignoring an alternative order that is not a permutation of the
same chunks, exactly as the browser trainer did. The cumulative error log imports once as a backfill.

## Out of scope for M0

- Any generation or correction inside the runtime (ADR-0001).
- Audio: recording, playback, or grading of spoken answers. The learner records on their phone and
  self-reports, as today.
- An MCP server for the coach surface — the HTTP API comes first; MCP is additive over the same
  service layer.
- Anki export. The vocabulary trainer replaces the flashcard app for this pack's material; a learner
  who wants Anki keeps their CSV.
- Multi-learner administration, cohorts, or anything an operator would use. Roles and access are
  identity-service configuration.

## Success

M0 is done when the learner completes a full lesson in the app — read, drill, submit — the coach
corrects it through the API, the error-log counters move by rule, and the resulting brief is good
enough to author the next block from. That is the loop; everything else is surface area.

## Risks

**The demo pack drifts from real packs.** Only a synthetic pack is committed (ADR-0006), so the
importer's fidelity to real content is not covered by CI. Mitigation: a dry-run import of the real
directory is part of the verification checklist, and the demo pack exercises every section kind.

**Nine section kinds is a guess.** Derived from one program. Some will be wrong; adding a kind is
cheap and removing one is not, so we add only on demand (ADR-0004).

**Asynchronous correction changes the feel.** Submitting and waiting is honest to how the program
already worked, but the learner previously got corrections in the same conversation. If the wait
proves to be what stops daily use, the answer is a service that corrects and posts to `/coach/v1` —
a new caller, not a model in the runtime.
