---
title: Sessielog — hand work in, and read what came back
surface: (part of `lessons` — it has no rail item of its own)
status: built
---

# Sessielog (session log)

| | |
|---|---|
| **Route** | `/{locale}/sessions/{submissionId}` |
| **Capability** | `submission:write` to create · `lesson:read` to read back |
| **Reached from** | submitting a lesson, or the "already submitted" link on one |
| **Decides** | `submissions` · and, when a coach answers, `corrections` and `errorLog` |

The learner's half of the coaching loop. This is the artifact the source program wrote by hand into
a markdown file after every lesson; here it is a **view over the submission and its correction**, so
it cannot drift from either.

The coach's half — pulling the queue, correcting, closing a block, authoring the next one — is
[`docs/guides/coach-loop.md`](../../guides/coach-loop.md). This file covers only what the learner
sees and what submitting does.

## What a submission is

Written work waiting for a coach. It is **deliberately not graded by the runtime**: judging
free-form writing is exactly what the runtime does not do
([ADR-0001](../../architecture/decisions/0001-runtime-not-agent.md)).

```jsonc
{
  "answers": [{ "ref": "vragen.b", "text": "…" }],   // at least one non-empty
  "speakingNote": "…"                                 // optional, one line
}
```

Reference scheme, shared with the [lesson reader](lessons.md):

```
write, dictation      → the section id
questions, exercise   → "{sectionId}.{itemRef}"
```

## What submitting does

Four things, in order, and each is load-bearing:

1. **Refuses an empty submission.** At least one answer must have non-whitespace text. An empty
   submission is a coach opening a lesson to find nothing in it.
2. **Reports unknown references, and keeps them.** A reference the lesson no longer defines is
   returned as `unknownRefs`, not rejected — a lesson can be re-published with a section renamed, and
   losing a learner's answers to that would be worse than carrying an orphan reference.
3. **Enrols the learner in the pack.** Doing a lesson enrols you exactly as opening the pack does: a
   learner who arrived by deep link or a "continue" bookmark has plainly started the pack. `enroll`
   is idempotent, so this is a no-op for anyone who came in through the pack page.
4. **Moves the learner on** — to `lesson.order + 1`. Submitting is what advances position. Lessons
   advance by position, never by date.

Submitting is gated on the **block's owner**: work submitted against somebody else's lesson would
file evidence against their programme and enrol the writer in a block they cannot open
([ADR-0015](../../architecture/decisions/0015-a-block-may-be-owned-by-a-learner.md)).

## Statuses

```
pending  ──(a coach posts a correction)──▶  corrected
```

`pending` is the coach's queue, sorted **oldest first so nothing starves**. Everything else is sorted
newest first.

A submission with no correction yet renders as *"Nog niet nagekeken — een coach kijkt dit na.
Ondertussen kun je gewoon verder met de volgende les."* Waiting on feedback never blocks the next
lesson; it only holds up the *block* being complete.

## What comes back

A correction, authored on the far side of `/coach/v1`:

```jsonc
{
  "items": [{
    "original": "Ik heb gisteren naar de winkel gegaan.",
    "corrected": "Ik ben gisteren naar de winkel gegaan.",
    "categories": ["hulpwerkwoord"],        // at least one — the pack's declared categories
    "explanation": "…"                      // optional
  }],
  "ratings": { "fluency": 3, "accuracy": 2, "courage": 4 },   // each 0–5, all optional
  "note": "…",
  "model": "…"                              // which model wrote it, when one did
}
```

**`categories` is the judgement, and it is the only judgement.** Every counter downstream — the error
log, the re-drill list, the next block's focus, the quiz's weighting — is arithmetic over those
category names ([ADR-0014](../../architecture/decisions/0014-an-authored-answer-key-may-write-the-error-log.md)).
A category must be one the pack declares; the runtime never invents one and never interprets one.

Posting a correction writes one error-log occurrence per category per item, through the **same
writer** a wrong quiz answer goes through. There is one place counters are written.

`ratings` are a coach's read of one piece of work, shown as they were given. They are not averaged,
not accumulated into a score, and not used by anything.

## The screen

```
Sessielog                                          ← Terug naar de les
Les 4 · ingeleverd 12 aug                          vloeiend 3 · correct 2 · lef 4
┌─ Wat je schreef ──────────────────────────────────────────────────┐
│ « the prompt this answers »                                       │
│ jouw tekst                                    lang=contentLanguage│
└───────────────────────────────────────────────────────────────────┘
┌─ Correcties ──────────────────────────────────────────────────────┐
│ ✗ Ik heb gisteren naar de winkel gegaan.                          │
│ ✓ Ik ben gisteren naar de winkel gegaan.        [hulpwerkwoord]   │
│   uitleg…                                                         │
└───────────────────────────────────────────────────────────────────┘
```

- **Each answer is shown under the prompt it answers**, resolved from the lesson by reference — a
  wall of untitled paragraphs is not a log of anything. A reference the lesson no longer defines
  falls back to showing the raw ref rather than disappearing.
- **A correction shows original and corrected together**, with its categories as chips. The
  categories are the connective tissue to everything else in the product, so they are visible here
  rather than only in the coach's tooling.
- **No correction is a state, not an emptiness.** "Not yet reviewed" and "reviewed, nothing wrong"
  are different messages.

## Deliberate refusals

- **The runtime never grades free-form writing.** No automatic correction, no score for a submission.
- **A submission is never edited.** It is the record of what was handed in at a moment.
- **Ratings are never aggregated.**
- **Another learner's submission is a `403`**, not a `404` — the caller is authenticated and the
  resource exists, which is this surface's convention for a resource that is not content.

## Where the code is

| | |
|---|---|
| Submissions | `api/src/services/submissions.ts` |
| Corrections and the error-log write | `api/src/services/corrections.ts`, `error-log.ts` |
| Answer references | `api/src/domain/progression.ts` |
| Routes | `api/src/http/learner.ts` (learner) · `api/src/http/coach.ts` (correcting) |
| Screen | `web/src/app/[locale]/(app)/sessions/[submissionId]/page.tsx` |
| Strings | `web/src/i18n/dictionaries.ts` → `session` |
| The coach's half | [`docs/guides/coach-loop.md`](../../guides/coach-loop.md) |
