---
title: Zinspuzzel — the sentence puzzle
surface: drills:word-order
status: built
---

# Zinspuzzel (sentence puzzle)

| | |
|---|---|
| **Surface key** | `drills:word-order` |
| **Route** | `/{locale}/drills/sentences?blockId=…` |
| **Capability** | `drill:practice` |
| **Appears when** | the block has at least one `word-order` drill item, and the pack has not opted out ([ADR-0019](../../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)) |
| **Decides** | `drillState` for `word-order` items, and `attempts` rows |

The learner is given the meaning in their own language and the sentence's chunks, shuffled, and taps
them into order. Two right in a row solves an order. Where a sentence has a second valid order, that
second order is a second stage, gated behind the first.

It shares the whole progression machine, the deck meters, the feedback panel and the override with
the [Woordtrainer](word-trainer.md) — one implementation, so the two surfaces cannot drift apart.
This file describes only what is different.

## Data it needs

```jsonc
{
  "kind": "word-order",
  "sentence": "Morgen ga ik naar de tandarts.",   // full and punctuated; the answer shown at stage 1
  "parts": ["morgen", "ga", "ik", "naar de tandarts"],   // the primary order, as unbreakable chunks
  "translation": "Tomorrow I'm going to the dentist.",   // the prompt
  "tip": "V2: the verb stays in second position.",       // optional, behind the Hint button
  "partsAlt": ["ik", "ga", "morgen", "naar de tandarts"] // optional second order — see below
}
```

`parts` needs at least two chunks. A chunk is **unbreakable**: "naar de tandarts" is one tile, not
three, and chunking is the authoring decision that sets the difficulty.

## The rules

### Two orders, and when the second one exists

Dutch allows the same sentence in more than one correct order (V2 topicalisation). An item may carry
`partsAlt` to drill that, but it only counts as a second stage when it is **usable**:

```
usable ⟺ partsAlt exists
       ∧ partsAlt is a permutation of parts   (multiset equality, duplicates counted)
       ∧ partsAlt is not the same sequence as parts
```

Comparison is on a canonical form — trimmed, inner whitespace collapsed, lowercased.

**A malformed alternative is silently ignored and the item degrades to single-order.** This is
deliberate and is the opposite of how a malformed `mcq` answer key is treated: a typo in an
alternative order costs one stage, whereas a broken answer key would mark every learner wrong
forever. So the alternative is not validated at publish, and the runtime decides.

`stageCount` therefore returns 2 only for items with a usable alternative — which is exactly what
gates Volgorde 2, and what makes `stagesFor` return 1 for the rest. A single-order item masters
straight out of stage 1.

### The lead cue

An item with two orders shows *"begin met «Morgen»"* — the first chunk of the order being practised,
capitalised. Without it the two rounds would be indistinguishable from the learner's side and the
second would look like the first marked wrong. A single-order item has no cue, because there is
nothing to disambiguate.

### The other valid order

Building the *other* valid order is checked for explicitly and reported as its own outcome:

> ↔ Ook goed Nederlands — maar deze ronde oefenen we de andere volgorde.

It is **never counted correct** — the round is about the order being practised — but it is
deliberately not phrased as an error and not styled as one (primary tone, not destructive). Telling
a learner their correct Dutch is wrong teaches them the wrong lesson.

At stage 1 "the other order" is the usable alternative; at stage 2 it is `parts`. Feedback shows both
orders together when they differ.

### Per-chunk marks

Grading returns `marks: boolean[]`, one per chunk **the learner built**, comparing position by
position against the expected order. The surface colours each tile green or red in place, so the
feedback says *where* the order went wrong rather than just *that* it did. A built sentence longer
than expected marks the overflow positions false (there is no target at that index).

### The bank

`shuffleParts` is a seeded xorshift32 shuffle, and the seed is derived from the `drillItemId` — so a
reload shows the **same** bank rather than reshuffling, and the puzzle a learner walked away from is
the one they come back to. A shuffle that happened to return the answer swaps the first two chunks,
because a shuffle that returns the answer is not a shuffle.

The **Husselen** button in the surface is a different thing: an unseeded, genuinely random reshuffle
of what is still in the bank, for a learner who wants the tiles moved. It never touches what has
already been built.

### The expected answer shown after checking

Stage 1 reveals `sentence` — the authored, punctuated string, which is the truth for that order.
Stage 2 has no authored string, so it is rendered from its own chunks: joined by spaces, whitespace
collapsed, first letter capitalised. That is also how `alternative` is rendered.

## API

Identical to the word trainer, with `kind=word-order`:

```http
GET  /api/v1/drills?blockId=…&kind=word-order&stage=1|2&limit=100
POST /api/v1/drills/:drillItemId/attempts   { stage, given: string[], override? }
POST /api/v1/drills/reset                   { blockId | packId }
```

`given` is the **built chunk array**. A string is accepted and split on `|` for a non-browser caller.

The prompt adds `bank`, `leadCue` and `tip` to the shared shape; the result adds `marks`,
`otherValidOrder`, `alternative` and `tip`.

## The screen

```
Zinstrainer                                     [⇄ Volgorde 2]  [↺ Reset]
Tik de delen in de juiste volgorde.
┌──────────────────────────────────────────────────────────────────────┐
│ Zin 3 van 18 · Reeks 1/2         begin met «Morgen»   [ Volgorde 1 ] │
│                                                                      │
│ Tomorrow I'm going to the dentist.        ← the meaning, not the answer │
│                                                                      │
│ Jouw zin                                                             │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│   [Morgen] [ga] [ik]                      ← tap to send back        │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│ [naar de tandarts]                        ← the bank                 │
│ [ Nakijken ] [⤮ Husselen] [⌫ Wissen] [ Hint ]                        │
└──────────────────────────────────────────────────────────────────────┘
```

Behaviour the rebuild must keep:

- **Tap in, tap out.** A chunk moves to the sentence on tap and back to the bank on tap. It works
  one-handed on a phone, which is why it is taps rather than drag-and-drop.
- **Chunks are tracked by position, not by text.** A sentence can legitimately repeat a chunk ("ik …
  ik"), and keying on the text would make duplicates indistinguishable and un-removable.
- **A chunk put back returns to its original slot**, not to the end — the bank is re-sorted by the
  chunk's key. A bank that reordered itself under the learner's hand would be its own puzzle.
- **The bank refills whenever the item changes**, and `Wissen` restores it to the served order.
- **After a verdict the tiles freeze** — no taking or putting back — and the built row turns into the
  per-chunk marks.
- **Check is disabled on an empty sentence**; the override is not.
- **Position in the round is shown above the prompt** — *"Zin 3 van 18"*, out of what is still to
  master. The same line the [word trainer](word-trainer.md) carries, and for the same reason:
  mastering a sentence takes four correct answers across two orders, so the `beheerst` meter sits at
  `0/n` for a whole first pass and reads as if nothing is being counted. The surface asks for the
  API maximum so the round is the whole rotation, and **round + mastered = total** holds on screen.
- `lang={contentLanguage}` on every chunk and on the lead cue. The prompt is the translation and
  carries no `lang` override.
- Meters, reset, direction switch, stale-session prompt: as the word trainer.

There is **no add-your-own** here. A learner can add a word; authoring a sentence with chunk
boundaries and a second valid order is an authoring job, not a practice-time one.

## Deliberate refusals

- **A malformed `partsAlt` never fails a publish.** It costs a stage instead.
- **The other valid order is never marked correct**, and never marked wrong-in-red either.
- **No partial credit.** `marks` is feedback, not scoring: the attempt is right or it is not.

## Where the code is

| | |
|---|---|
| Order rules, permutation check, shuffle | `api/src/domain/word-order.ts` |
| Prompt + verdict | `api/src/domain/grading.ts` |
| Streak machine (shared) | `api/src/domain/drill-progress.ts` |
| Serving and persisting | `api/src/services/drills.ts` |
| Screen | `web/src/components/sentence-drill.tsx`, `drill-chrome.tsx` |
| Strings | `web/src/i18n/dictionaries.ts` → `drills` |
