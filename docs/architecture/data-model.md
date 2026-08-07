---
title: Data model
status: current
date: 2026-08-01
---

# Data model

One MongoDB database ([ADR-0003](decisions/0003-mongodb-single-store.md)). Indexes are declared in
`api/src/db/client.ts` and applied at boot — there is no migration runner, because `createIndex` is
idempotent.

## Identifiers

Content identifiers are **deterministic**, derived from position and content rather than generated:

```
pack            demo-conversation-nl
block           demo-conversation-nl.b1              packId + order
lesson          demo-conversation-nl.b1.l2           blockId + order
drill item      demo-conversation-nl.b1.d.00250fd6   blockId + hash(kind|term|sentence|stem)
```

For a question the hashed key is its **stem**, so rewording a distractor or fixing a typo in an
explanation keeps the item — and the learner's progress on it. Changing the scenario itself makes a
new question, which is the right outcome: it is one.

This is what makes republishing safe. A lesson keeps its id when the block is re-imported, and a
drill item whose text has not changed keeps the learner progress attached to it — with random ids
every republish would silently reset everyone's streaks.

Events (submissions, corrections) get random ids: each is a new thing that happened, not a thing
that has an identity.

Derived keys: `enrollment = learnerId:packId`, `drillState = learnerId:drillItemId`,
`errorLog = learnerId:packId:category`, `blockReview = blockId:learnerId`.

## Collections

### Content

| Collection | Key | Notable indexes |
|---|---|---|
| `packs` | `_id = packId` | — |
| `blocks` | deterministic | `(packId, order)` unique · `(packId, status)` |
| `lessons` | deterministic | `(blockId, order)` unique · `packId` |
| `drillItems` | content hash | `(blockId, lessonOrder)` · `packId` |

A `lesson` holds `sections: Section[]` — an ordered array of the nine kinds
([ADR-0004](decisions/0004-pack-contract-and-typed-sections.md)). Nesting stays nested; this is the
shape that would have needed a table per section kind in a relational store.

`drillItems` are held separately from lesson prose because the two are read differently: prose is
read once, drill items are scheduled independently and forever. A vocabulary section appears in the
lesson *and* contributes term items — and because ids are content-derived, a term listed in both
places collapses to one item.

### Learner state

| Collection | Key | Notable indexes |
|---|---|---|
| `learners` | random | `subject` **unique** |
| `enrollments` | derived | `(learnerId, packId)` unique |
| `drillState` | derived | `(learnerId, drillItemId)` unique · `(learnerId, blockId)` |
| `attempts` | random, append-only | `(learnerId, at)` · `(drillItemId, at)` |

`learners` is a thin profile keyed on the token's `sub` — display name and UI language, no
credentials ([ADR-0002](decisions/0002-identity-service-as-authentication-engine.md)). The unique
index on `subject` is what makes lazy creation safe under concurrent first requests.

`drillState` is the spaced-repetition state: `stage`, `streak`, `stage1Cleared`, `stage2Cleared`,
`mastered`, plus attempt counters. `attempts` is the append-only record behind it, including whether
the learner overrode a rejection.

### The coaching loop

| Collection | Key | Notable indexes |
|---|---|---|
| `submissions` | random | `(status, createdAt)` — the queue · `(learnerId, lessonId)` · `(learnerId, blockId)` |
| `corrections` | random | `submissionId` **unique** |
| `errorLog` | derived | `(learnerId, packId, category)` unique |
| `blockReviews` | derived | `(blockId, learnerId)` unique |
| `quizSessions` | random | `(learnerId, startedAt)` · `(learnerId, blockId, startedAt)` |
| `auditEvents` | random | `at` **TTL** · `(actor.subject, at)` |

`errorLog` now has **two** writers ([ADR-0014](decisions/0014-an-authored-answer-key-may-write-the-error-log.md)):
a coach's correction, and a wrong answer against a question's published key. Both go through
`services/error-log.ts::recordOccurrences`, so there is one implementation of the arithmetic and not
two that can drift.

A `quizSessions` document holds which items were asked and what was answered — and **nothing that was
derived from them**. The score, the per-category breakdown and anything resembling readiness are
computed on read, exactly as error-log status is, so they cannot disagree with the answers behind
them. A stored score would also be a persisted judgement about a person, which
[`../../AGENTS.md`](../../AGENTS.md) rules out.

`(status, createdAt)` is the coach's work queue, oldest first. The unique index on
`corrections.submissionId` is what makes double-correction a `409` rather than a duplicate history.

An `errorLog` entry carries `count`, `firstSeen`, `lastSeen`, `lastBlockOrder`, `closedThrough`,
`cleanBlocks` and a derived `status`. **Status is never stored independently of the counters**, so
the two cannot disagree; and `cleanBlocks` is derived as `closedThrough − lastBlockOrder` rather
than accumulated, which is what makes closing a block idempotent.

There is no `sessionLogs` collection. A session log is a *view* over a submission and its
correction — deriving it means it can never drift from what actually happened.

`auditEvents` is bounded by a TTL index rather than by pruning logic.

## What the runtime derives rather than stores

- **Session logs** — submission + correction
- **Error-log status** — from `count` and `cleanBlocks`
- **Block progress** — from which lessons have corrected submissions
- **Deck summaries** — from `drillState`
- **Quiz scores and per-category accuracy** — from a sitting's answers
- **Which questions the next sitting asks** — from the error log, in `domain/quiz.ts`
- **The next-block brief** — from the error log, quiz accuracy, the ramp and the pack goal

That list is the point of the design: everything an author needs in order to write the next block is
computed from what happened, not maintained by hand alongside it.
