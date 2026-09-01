---
title: Woordtrainer — the word trainer
surface: drills:terms
status: built
---

# Woordtrainer (word trainer)

| | |
|---|---|
| **Surface key** | `drills:terms` |
| **Route** | `/{locale}/drills/words?blockId=…` |
| **Capability** | `drill:practice` — and `drill:curate` for a learner's own words |
| **Appears when** | the block has at least one `term` drill item, and the pack has not opted out ([ADR-0019](../../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)) |
| **Decides** | `drillState` for `term` items, and `attempts` rows |

Type the translation. Two right in a row and the word is done in that direction. The reverse
direction unlocks only once the forward one is cleared, and a wrong answer sends the streak back to
zero.

## What it is for

A vocabulary deck with spaced-repetition-style gating, prompting in both directions. It replaces a
browser trainer that had to ship the answer to the page in order to check it; here the learner
commits first and the verdict comes back from the server. That is the single behavioural upgrade
over what came before, and it is the reason `GET /drills` returns **prompts, not items**.

## Data it needs

One `term` drill item:

```jsonc
{
  "kind": "term",
  "term": "de doorlooptijd",        // in the pack's contentLanguage
  "translation": "the lead time",   // in the pack's translationLanguage
  "example": "De doorlooptijd is twee weken."   // optional
}
```

Items come from two places and are otherwise identical downstream:

- **The pack.** A `vocabulary` section in a lesson contributes one item per row. Ids are content
  derived, so a term listed in two lessons collapses to one item.
- **The learner** ([ADR-0012](../../architecture/decisions/0012-a-learner-may-add-to-their-own-deck.md)).
  A word added in this surface's own form becomes an ordinary item carrying a `learnerId` and
  `origin: 'learner'`. Same prompting, same matching, same streak machine.

## The rules

### Stages

A `term` item always has **two** stages, and only these two:

| Stage | Prompt | Answer | What it drills |
|---|---|---|---|
| 1 | `term` (content language) | `translation` | Recognition |
| 2 | `translation` | `term` (content language) | Production, and spelling |

Stage 2 is **gated** behind stage 1. It is gated in three independent places, and all three must
stay:

1. `isDueAtStage` — an item sitting at stage 1 is not served in a stage-2 batch.
2. `recordAttempt` — posting a stage-2 attempt before `stage1Cleared` is a `400`, not a silent
   accept. The gate has to hold against the API, not only against the UI.
3. The surface — an empty stage-2 deck says *"direction 2 opens once you have mastered direction 1"*
   rather than *"nothing to practise"*, because those are different facts.

### The streak machine

Shared with the Zinspuzzel — one implementation, so the two surfaces cannot drift apart.
`CLEAR_STREAK` is **2**.

```
correct   → streak + 1
wrong     → streak = 0          (the item keeps coming back)
streak reaches 2 at stage 1
          → stage1Cleared = true
          → two-stage item: stage = 2, streak = 0   (fresh, not carried over)
          → one-stage item: mastered = true
streak reaches 2 at stage 2
          → stage2Cleared = true, mastered = true
```

Three properties worth preserving deliberately:

- **A mastered item is inert.** Further attempts are still counted in `attempts`/`correct` but change
  nothing else. Revisiting an old word can never demote it.
- **Clearing stage 1 resets the streak to 0**, it does not carry it into stage 2. Stage 2 is a new
  skill, not a continuation.
- **An accepted override earns the streak.** The override arrives at the machine as `correct: true`,
  because the learner was right; what is recorded separately is *that it was an override*.

### Tolerant matching

Free text is matched **tolerantly in shape, strictly in spelling**. It forgives:

- case, surrounding whitespace, and edge punctuation (quotes, `.,;:!?`)
- one leading article — `de het een 't the a an`, overridable per language via the manifest's
  `matchArticles`
- one leading particle — `to`, so "to send" matches "send"
- `a / b`, `a, b`, `a; b` alternatives: **any one** of the listed meanings is right, and a learner
  who writes several is right too provided each would have been accepted alone
- a `(parenthetical)`: both "to move (house) to" and "to move to" are accepted

It deliberately does **not** forgive:

- **diacritics.** "potentiele" for "potentiële" is exactly the mistake stage 2 exists to train out.
- an **unspaced** slash — "and/or" and "he/she" stay one answer rather than splitting into two.
- interior punctuation — "'s ochtends" and "erop neerkomen dat" must stay distinct.
- brackets at the edges are not stripped, or a trailing `)` would be orphaned from its opening.

Tolerance can never be complete, so it errs strict and pairs with the override.

### The override

Any rejected answer can be overridden by the learner: *"Toch goed — accepteer"*. It re-grades with
`override: true`, which counts as correct and earns the streak. It is **recorded as an override** in
the `attempts` row (`acceptedOverride: true`) rather than hidden — a learner who overrides
everything should be visible.

The override is offered for `term` and `word-order` items only. An `mcq` has none: picking from a
list needs no tolerance, so a rejection there is never the grader's fault.

### The hint

`example` is offered behind a *Hint* button, never shown unasked. At **stage 2 the example contains
the answer**, so every case-insensitive occurrence of `term` inside it is replaced with `…` before
the prompt leaves the server. An unmasked hint would make the spelling drill free.

### Rotation and ordering

`GET /drills` returns a batch (default 20, max 100; **the surface asks for the maximum**) ordered
**least-practised first** — `progress.attempts` ascending, then by id for stability. A session works
through the deck rather than re-showing favourites. Reaching the end of a batch fetches a fresh one;
items that were answered wrong come back in it.

## API

```http
GET  /api/v1/drills?blockId=…&kind=term&stage=1|2&limit=100   → DeckPage
POST /api/v1/drills/:drillItemId/attempts                     → AttemptResult
POST /api/v1/drills/reset            { blockId | packId }     → { reset: n }
POST /api/v1/blocks/:blockId/terms   { term, translation, example? }  → 201 { term }
GET  /api/v1/blocks/:blockId/terms                            → { terms }
DELETE /api/v1/terms/:drillItemId                             → 204
```

`GET /drills` needs `blockId` **or** `packId`; neither is a `400`. `stage` is optional — omitted,
each item is served at whatever stage it is sitting on, which is what a plain practice session
wants. Passing it explicitly is what the direction switch does.

A `DeckPage` is `{ items: DueItem[], summary: DeckSummary }`. The summary is computed over the
**whole** deck, not the batch:

```jsonc
{ "total": 120, "stage1Cleared": 45, "stage2Unlocked": 30, "mastered": 15, "inProgress": 105 }
```

`stage2Unlocked` is `stage1Cleared - mastered` — unlocked but not yet finished, which is what the
second meter is counting.

A `DueItem` carries the prompt and **never the answer**:

```jsonc
{
  "drillItemId": "…",
  "stage": 1,
  "prompt": { "kind": "term", "stage": 1, "prompt": "de doorlooptijd", "hint": "De doorlooptijd is…" },
  "progress": { "stage": 1, "streak": 1, "mastered": false, "…": "…" }
}
```

An `AttemptResult` adds, after grading: `correct`, `overridden`, `expected` (the canonical answer),
`acceptedAlso` (every form that would have been taken, sorted — shown only on a miss), and the new
`progress`.

`POST /drills/reset` refuses a body with neither `blockId` nor `packId`: a reset that clears
everything is not a thing this endpoint will do by omission. **No screen calls it.** Wiping a deck
was one click away from the practice a learner had just done, and an undo for it does not exist; the
endpoint stays for a coach or a script, which is where a decision that destructive belongs.

## The screen

```
Woordtrainer                                    [⇄ Richting 2]
Typ de vertaling. Twee keer goed achter elkaar en het woord is klaar.
┌──────────────────────────────────────────────────────────────────────┐
│ Woord 3 van 44 · Reeks 1/2                           [ Richting 1 ]  │
│                                                                      │
│ de doorlooptijd                          ← lang=contentLanguage      │
│ De doorlooptijd is…                      ← hint, only once asked     │
│ ┌──────────────────────────────────────┐ ← lang=answer language,     │
│ │ Typ je antwoord                      │   spellcheck off            │
│ └──────────────────────────────────────┘                             │
│ [ Nakijken ]  [ Hint ]                                               │
│ ──────────────────────────────────────────────────────────────────── │
│ Vrijgespeeld: 45/120             Beheerst: 15/120                    │
│ ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░  ← stage1Cleared                            │
│ ▓▓░░░░░░░░░░░░░░░░░░░░░░  ← mastered (success tone)                  │
│ ▸ Eigen woord toevoegen                                              │
└──────────────────────────────────────────────────────────────────────┘
```

After a check, the input locks and the feedback panel replaces the buttons: verdict, *Het juiste
antwoord*, `acceptedAlso` on a miss, then **Volgende** (autofocused) and, on a miss, **Toch goed —
accepteer**.

Behaviour the rebuild must keep:

- **Enter does the obvious thing.** Before a verdict it checks; after one it advances. The input is
  refocused on every new item.
- **An empty answer is checkable.** *"I don't know"* is a thing a learner needs to be able to say,
  and it is graded on the server like any other answer — wrong, streak back to zero, right answer
  shown. Refusing to submit it would be the page deciding the verdict.
- **The override is offered regardless of the box**, because overriding is a claim about the
  grading, not about the text in it.
- **Position in the round is shown above the prompt** — *"Woord 3 van 44"*. It is the one "where am
  I" the meters below cannot give: mastering a word takes four correct answers across two
  directions, so `mastered` legitimately sits at `0/n` for a whole first pass, which reads exactly
  like nothing is being counted.
- **Every number on the screen is out of the same deck.** The surface asks for the API maximum, so
  the round *is* the whole rotation wherever a deck fits in one batch — and then the position's
  denominator is the deck's own count rather than a page size that happens to sit near it. Asking
  for less put an arbitrary number beside a real one (*"1 van 40"* over *"beheerst: 0/44"*) with no
  relationship a learner could work out. Both footer counters carry `/total` for the same reason.

  Past 100 unmastered items the round is genuinely a subset, and the count restarts on the next
  batch. What keeps that honest is the arithmetic: **round + mastered = total**, always.
- **The meters move on every answer**, without refetching the deck. They are held beside the deck in
  their own state and patched from the attempt's before/after progress. An override re-grades, so
  what it moves *from* is the first verdict rather than the deck's stale copy.
- **The footer stays when the deck is empty.** An exhausted deck is exactly when a learner wants to
  see what they have mastered and add a new word, so the meters and the add-word form render whether
  or not there is a prompt above them.
- **`lang` is set per element.** The prompt carries the language it is written in and the input
  carries the language being typed, so a screen reader and the spellchecker both get it right. The
  answer language flips with the stage.
- **A stale session is a sign-in prompt, not an error.** `expired` renders a *Sign in again* button
  that returns to this exact drill via `?next=`.

## Your own words

Collapsed by default — the trainer's job is the word in front of you, and a form competing with it
would be the wrong thing on screen. It opens on demand, loads the learner's list only once opened,
and closes itself after a word goes in.

- Adding is **idempotent by content**: the id derives from the term, so adding the same word twice is
  the learner repeating themselves, and an edited translation overwrites in place **and keeps the
  streak**.
- The word attaches to the **block being practised**, not the pack — that is the deck being added to.
- Only the owner sees it, a republish of the block never sweeps it, and deleting it takes its
  progress with it.
- `FROM_LEARNER` (`origin: 'learner'`), not `learnerId`, is what separates these from the pack's own
  items — inside a block written for one learner the pack's items carry a `learnerId` too
  ([ADR-0015](../../architecture/decisions/0015-a-block-may-be-owned-by-a-learner.md)), and without
  the origin check the list would offer a delete button on the learner's own curriculum.

## Deliberate refusals

- **The answer never reaches the page before the learner commits.** Not in the prompt, not in a
  data attribute. Everything about this surface follows from that.
- **Someone else's own word is a `404`, not a `403`.** Its existence is not the caller's business.
- **Stage 2 cannot be reached by API.** See the three gates above.
- **No demotion.** There is no decay, no forgetting curve, no re-testing of mastered items. Mastery
  here is a floor, and the deck is finite on purpose.
- **No client-side grading**, ever — including "obvious" cases like an empty answer.

## Where the code is

| | |
|---|---|
| Streak machine | `api/src/domain/drill-progress.ts` |
| Matching | `api/src/domain/matching.ts` |
| Prompt + verdict | `api/src/domain/grading.ts` |
| Serving and persisting | `api/src/services/drills.ts` |
| Own words | `api/src/services/learner-terms.ts` |
| Routes | `api/src/http/learner.ts` |
| Screen | `web/src/components/word-drill.tsx`, `drill-chrome.tsx`, `own-words.tsx` |
| Strings | `web/src/i18n/dictionaries.ts` → `drills` |
