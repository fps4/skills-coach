---
title: Flashcards — words and concepts
surface: drills:terms
status: built
---

# Flashcards

| | |
|---|---|
| **Surface key** | `drills:terms` — the key predates the name and is kept, because every published manifest carries it |
| **Route** | `/flashcards?blockId=…` (`&view=add` for adding cards; `&mode=learn` opens in learn mode — where a [search](search.md) result for a card leads). `/drills/words` redirects here, query intact |
| **Capability** | `drill:practice` — and `drill:curate` for a learner's own cards |
| **Appears when** | the block has at least one `term` drill item, and the pack has not opted out ([ADR-0019](../../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)) |
| **Decides** | `drillState` for `term` items, and `attempts` rows |
| **Decision record** | [ADR-0027](../../architecture/decisions/0027-flashcards-are-one-engine-with-two-ways-of-answering.md) |

A card has a front and a back. Answer it: two right in a row and it is done in that direction. The
reverse direction opens only once the forward one is cleared, and a miss sends the streak back to
zero.

One surface serves two kinds of deck, and the **skill** decides how its cards are answered:

| | `typed` (default) | `self` |
|---|---|---|
| For | words — a word has one spelling | concepts — the back is a sentence |
| Answering | type the back; the server matches it tolerantly | turn the card over, then *Got it* / *Missed it* |
| When the check is wrong | *Accept anyway* (recorded as an override) | — the learner is the check |
| Example skill | `woordtrainer-nl` | `knowledge-graphs` |

Both run the same streak machine and offer **learn mode**, which shows every card with its answer
and records nothing.

**It is also a skill of its own** ([ADR-0022](../../architecture/decisions/0022-a-skill-can-be-only-a-deck-or-a-library.md)):
a deck with no lessons around it. The Woordtrainer holds only the learner's own words; an upskilling
deck holds cards a coach wrote from the reference guides. A programme skill shows the same surface as
a tab beside its lessons.

**Adding cards** is the second view (`?view=add`): name a word, a coach fills its card in, and the
learner checks every line before accepting it into the deck
([ADR-0023](../../architecture/decisions/0023-a-coach-fills-in-a-word-the-learner-asked-for.md)).

## What it is for

A deck with gating, prompting in both directions. It replaces a browser trainer that had to ship the
answer to the page in order to check it; here the learner commits first and the back of the card
comes from the server afterwards. That is the behavioural upgrade over what came before, and it is
why `GET /drills` returns **prompts, not items**. Learn mode is the one deliberate exception — see
below.

## Data it needs

One `term` drill item. Only `term` and `translation` are ever graded; everything else is shown.

```jsonc
{
  "kind": "term",
  "term": "Widget join",                                  // the front, in the pack's contentLanguage
  "translation": "Matching two widget lists on a key.",   // the back, in its translationLanguage
  "hint": "Works like a zipper.",                         // optional cue, before answering
  "group": "Basics",                                      // optional section label, on the front
  "example": "A widget join pairs each left widget with its twin.",   // optional
  "details": {                                            // optional, after answering (ADR-0023)
    "analogy": "Like a SQL inner join, but for widgets.", // "Map onto what you know"
    "code": "left JOIN right USING (key)",                // monospace, indentation kept
    "source": "Widgets guide · Joining",                  // "From the guide · …"
    "note": "…", "partOfSpeech": "…", "forms": [], "synonyms": [], "antonyms": [], "exampleTranslation": "…"
  }
}
```

Limits: `hint` 300, `group` 120, `analogy` 1000, `code` 4000 (and not blank), `source` 300 characters.

Items come from three places and are otherwise identical downstream:

- **A published block's `drillItems`** — how a coach publishes a concept deck (`publish_block`).
- **A `vocabulary` section** in a lesson contributes one item per row, with the same optional fields.
  Ids are content derived, so a term listed in two lessons collapses to one item.
- **The learner** ([ADR-0012](../../architecture/decisions/0012-a-learner-may-add-to-their-own-deck.md)).
  A card added in this surface becomes an ordinary item carrying a `learnerId` and
  `origin: 'learner'`. Same prompting, same grading, same streak machine.

Every write builds the payload with `domain/flashcards.ts::termPayload`, so no path can drop a field
another path carries.

The manifest says how the cards are answered:

```yaml
flashcards:
  grading: self     # typed | self; omitted means typed
```

## The rules

### Stages

A `term` item always has **two** stages, and only these two:

| Stage | Prompt | Answer | Labels on the card |
|---|---|---|---|
| 1 | `term` | `translation` | *Term* on the front, *Meaning* on the back |
| 2 | `translation` | `term` | *Meaning* on the front, *Term* on the back |

The direction switch calls them *term → meaning* and *meaning → term*.

Stage 2 is **gated** behind stage 1. It is gated in three independent places, and all three must
stay:

1. `isDueAtStage` — an item sitting at stage 1 is not served in a stage-2 batch, in practice or in
   learn mode.
2. `recordAttempt` and `revealAnswer` — a stage-2 attempt or reveal before `stage1Cleared` is a
   `400`, not a silent accept. The gate has to hold against the API, not only against the UI.
3. The surface — an empty stage-2 deck says *"Direction 2 opens once you have mastered direction 1"*
   rather than *"nothing to practise"*, because those are different facts.

### The streak machine

Shared with the sentence puzzle — one implementation (`domain/drill-progress.ts`), so the surfaces
cannot drift apart. `CLEAR_STREAK` is **2**.

```
correct   → streak + 1
wrong     → streak = 0          (the card keeps coming back)
streak reaches 2 at stage 1
          → stage1Cleared = true
          → stage = 2, streak = 0   (fresh, not carried over)
streak reaches 2 at stage 2
          → stage2Cleared = true, mastered = true
```

Properties worth preserving deliberately:

- **A mastered card is inert.** Further attempts are still counted in `attempts`/`correct` but change
  nothing else. Revisiting an old card can never demote it.
- **Clearing stage 1 resets the streak to 0**, it does not carry it into stage 2.
- **An accepted override earns the streak**, because the learner was right; what is recorded
  separately is *that it was an override*.
- **A self grade enters the same machine.** *Got it* is `correct: true`, *Missed it* is
  `correct: false`; the machine cannot tell them from a typed verdict, and that is the point. What is
  recorded separately is *that it was self-graded* (`attempts.selfGraded`).

### Typed answering

Free text is matched **tolerantly in shape, strictly in spelling** (`domain/matching.ts`). It
forgives case, surrounding whitespace and edge punctuation; one leading article (`de het een 't the a
an`, overridable per language via `matchArticles`); one leading particle `to`; `a / b`, `a, b`,
`a; b` alternatives (any one of them, or several each of which would be accepted); a
`(parenthetical)`. It does **not** forgive diacritics, an unspaced slash, interior punctuation, or
brackets at the edges. Tolerance can never be complete, so it errs strict and pairs with the
override.

**Accept anyway** re-grades a rejected answer with `override: true`. It counts as correct, earns the
streak, and is **recorded as an override** (`acceptedOverride: true`) rather than hidden.

### Self-graded answering

1. The front shows. *Show answer* calls `POST /drills/:id/reveal { stage }`, which returns the back
   and **writes nothing**.
2. The back shows; the surface asks *"Did you have it before you turned the card?"*
3. *Got it* / *Missed it* posts `{ stage, self: 'got' | 'missed' }` as an ordinary attempt.

A self grade is accepted **only on a skill whose manifest says `grading: self`** — a `400` on a typed
skill, where it would be a way round the spelling. It is also a `400` on anything but a `term` item
and alongside `override: true`. A reveal on a typed skill is a `400`: a typed card is revealed by
answering it. The rule is `domain/flashcards.ts::checkAnswerMode`.

### The hint

The cue is offered behind *Hint*, never shown unasked. It is the card's `hint`, or — when it has
none — its `example`, as the word trainer always did. Wherever the cue contains the answer of the
stage being asked, every case-insensitive occurrence is replaced with `…` **before the prompt leaves
the server**:

- an authored `hint` is masked of the answer in both stages;
- an `example` is shown as-is in stage 1 (it is in the prompt's language and contains the prompt)
  and masked of the term in stage 2.

An unmasked hint would make the spelling drill free.

### Learn mode

`GET /drills?mode=learn` serves each card with `card: { expected, hint, group, example, details }` —
the whole back, unmasked. The surface shows prompt, answer, hint, analogy, code and details at once;
*Back* and *Next* move through the batch.

**It records nothing.** No attempt, no streak, no drill state; the integration tests assert the
collections are untouched. It serves only `term` items (a question bank in learn mode would be an
answer sheet) and keeps the stage gate.

This is a **deliberate exception** to "the answer never reaches the page before the learner
commits" ([ADR-0027](../../architecture/decisions/0027-flashcards-are-one-engine-with-two-ways-of-answering.md)):
the learner asked to see the answers, and nothing is being graded. A streak can still only be earned
by answering a card whose back was not on screen, because practice mode never carries the back and
learn mode never writes.

### Rotation and ordering

`GET /drills` returns a batch (default 20, max 100; **the surface asks for the maximum**) ordered
**least-practised first** — `progress.attempts` ascending, then by id. A session works through the
deck rather than re-showing favourites. At the end of a batch the surface shows *Batch done* with
the batch's got/missed counts; *Next batch* fetches a fresh one, and cards answered wrong come back
in it.

## API

```http
GET  /api/v1/drills?blockId=…&kind=term&stage=1|2&limit=100[&mode=learn][&topic=…]  → DeckPage
POST /api/v1/drills/:drillItemId/attempts   { stage, given, override? } | { stage, self }  → AttemptResult
POST /api/v1/drills/:drillItemId/reveal     { stage }                    → RevealResult (writes nothing)
POST /api/v1/drills/reset                   { blockId | packId }         → { reset: n }
POST /api/v1/blocks/:blockId/terms          { term, translation, example?, hint?, group?, details? } → 201 { term }
GET  /api/v1/blocks/:blockId/terms                                       → { terms }
DELETE /api/v1/terms/:drillItemId                                        → 204
```

`GET /drills` needs `blockId` **or** `packId`; neither is a `400`. `stage` is optional — omitted,
each card is served at whatever stage it is sitting on. Passing it explicitly is what the direction
switch does.

A `DeckPage` is `{ items: DueItem[], summary: DeckSummary, topics: TopicSummary[] }`. The summary is
computed over the **whole** deck — or the whole topic, when one is chosen — not the batch:

```jsonc
{ "total": 120, "stage1Cleared": 45, "stage2Unlocked": 30, "mastered": 15, "inProgress": 105 }
```

`stage2Unlocked` is `stage1Cleared - mastered` — in direction 2 but not yet finished.

A practice `DueItem` carries the prompt and **never the answer**:

```jsonc
{
  "drillItemId": "…",
  "stage": 1,
  "prompt": { "kind": "term", "stage": 1, "prompt": "Widget join", "hint": "Works like a zipper.", "group": "Basics" },
  "progress": { "stage": 1, "streak": 1, "mastered": false, "…": "…" }
}
```

An `AttemptResult` adds, after grading: `correct`, `overridden`, `selfGraded`, `expected` (the
canonical answer), `acceptedAlso` (typed only — every form that would have been taken), `example`,
`details`, and the new `progress`. A `RevealResult` is `{ drillItemId, stage, expected, hint?,
group?, example?, details? }`.

`POST /drills/reset` refuses a body with neither `blockId` nor `packId`. **No screen calls it.**

### Topics

A card's `group` is its **topic** ([ADR-0031](../../architecture/decisions/0031-a-deck-is-practised-by-topic.md)):
one per card, so a deck's topics partition it and their counts add up to the deck's. `?topic=<group>`
serves only that topic's cards — in practice and learn mode alike — and `?topic=_none` the cards
without one. `topics` lists the **whole** deck's topics whichever one is chosen, each
`{ id, title?, description?, guides?, summary }`. A deck none of whose cards has a topic has no
topics. A topic the deck does not have serves nothing — never silently the whole deck.

A skill may **declare** its topics in its manifest
([ADR-0032](../../architecture/decisions/0032-a-skill-declares-its-topics.md)):

```yaml
flashcards:
  grading: self
  topics:
    - id: data-vault-mechanics            # what cards carry in `group`, and what a link names
      title: Data Vault mechanics
      description: Hubs, links, satellites, hash keys, PIT and bridge tables.
      guides: [data-vault-2-dbt]          # guide files beside the manifest; checked by validate:manifests
```

Declared topics come first, in manifest order, and are shown by their title — on the card's front,
in search and on the tiles. A label the manifest does not declare is still a topic, after them,
titled by itself and ordered with numbers compared as numbers ("10 · …" after "9 · …"); `_none` is
last. Publishing a card under an undeclared topic, on a skill that declares some, is a `409`. Decks
labelled before their skill declared topics are moved onto the ids once with the `maintain-skills`
workflow's `retopic-cards` task, which changes `group` and nothing else — streaks stay.

On screen the topic is a **select** beside the mode and direction switches — *All topics*, then each
topic with `mastered/total` — present only when the deck has topics. Choosing one navigates to
`/flashcards?blockId=…&topic=…`, keeping learn mode if it is on; the direction resets with the page.
A topic address that matches nothing (a section renamed since it was bookmarked) says *No cards in
this topic* and offers *All topics*, rather than the empty-deck prompt. The overview's topic tiles
link to the same addresses ([progress](progress-and-navigation.md#topics-on-the-overview)).

## The screen

The skill header and its tabs sit above (ADR-0021). Then *Flashcards | Add cards*, and:

```
Flashcards
Turn the card over and say whether you had it. Two in a row and it is done in that direction.

[ Practise | Learn L ]   [ term → meaning | meaning → term D ]

┌ Cards ─┐┌ Direction 1 cleared ┐┌ In direction 2 ┐┌ Mastered ┐
│  120   ││        45           ││       30       ││    15    │
└────────┘└─────────────────────┘└────────────────┘└──────────┘
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Card 3 of 44 in this batch                                     ● ○  ┃  ← streak dots
┃                                                                      ┃
┃ BASICS                                   ← group, primary tone       ┃
┃ TERM                                     ← "Meaning" in direction 2  ┃
┃ Widget join                              ← lang=prompt language      ┃
┃ Works like a zipper.                     ← hint, only once asked     ┃
┃                                                                      ┃
┃ [ Hint H ]  [ Show answer F ]                                        ┃
┃ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ┃  ← after reveal
┃ MEANING                                                              ┃
┃ Matching two widget lists on a shared key.                          ┃
┃ ┌──────────────────────────────────────────────┐                    ┃
┃ │ left JOIN right USING (key)                  │ ← code, monospace   ┃
┃ └──────────────────────────────────────────────┘                    ┃
┃ ▍MAP ONTO WHAT YOU KNOW                                              ┃
┃ ▍Like a SQL inner join, but for widgets.                             ┃
┃ From the guide · Widgets guide · Joining                            ┃
┃                                                                      ┃
┃ Did you have it before you turned the card?                          ┃
┃ [ ✕ Missed it M ]  [ ✓ Got it G ]   ← outline destructive / success  ┃
┃ ──────────────────────────────────────────────────────────────────── ┃  ← after grading
┃ Direction 1 cleared — this card now waits in 'meaning → term'.       ┃
┃ [ Next card N → ]                                                    ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

A typed deck shows the same card with an answer box under the prompt and *Check ↵* / *Hint H*. After
the verdict: *Correct* / *Not right*, *The right answer*, *Also accepted* on a miss, the back of the
card (code, analogy, details, source), the status line, *Next card N* and — on a miss — *Accept
anyway A*. Its own-words form sits under the card.

The status line after grading, from the progress before and after (`lib/flashcards.ts::gradeStatus`):

| When | Line |
|---|---|
| direction 1 just cleared | *Direction 1 cleared — this card now waits in 'meaning → term'.* |
| a miss | *Streak back to zero — it comes back in the next batch.* |
| direction 2 just cleared | *Mastered. It stays mastered.* |
| a first right answer | *One more in a row clears this direction.* |

The states the card can be in instead of a prompt:

| State | Says |
|---|---|
| end of batch | *Batch done*, *n got · m missed*, *Next batch N* |
| direction 2 locked (`stage2Unlocked` 0) | *Direction 2 opens once you have mastered direction 1.* |
| deck fully mastered | *Every card in this deck is mastered.* — *It stays mastered.* |
| empty deck | *No cards yet.* and an *Add cards* button to `?view=add` |
| nothing due in this direction | *Nothing left to practise in this direction.* |

### The keyboard

Every action has a key, shown on its button as a `<kbd>` badge and announced with
`aria-keyshortcuts`. The map is one table (`lib/flashcards.ts::SHORTCUTS`) that both the handler and
the badges read.

| Key | Does | When |
|---|---|---|
| F or Space | Show answer | self-graded, front showing |
| H | Hint | front showing |
| G / M | Got it / Missed it | self-graded, card turned over |
| N | Next card; Next batch | after a verdict; at *Batch done*; in learn mode |
| B | Back | learn mode |
| L / P | Learn / Practise | any time, in the other mode |
| D | Switch direction | any time |
| Enter | Check, then next card | typed, in the answer box |
| A | Accept anyway | typed, after a miss |
| Esc | Leave the answer box | typed — so the letter keys, H among them, work before answering |

Ignored: anything held with Ctrl, ⌘ or Alt; anything typed into an editable field (the answer box
before the verdict); Space and Enter on a focused button or link, which activate it natively; and a
key the answer box has already handled. After a verdict the answer box turns **read-only and keeps
focus**, so Enter, N and A work without reaching for the mouse. A key that means nothing in the
current state falls through to the page.

The listener is on the document **only while the surface is mounted** and removed on unmount — it
is this page's keyboard, not the app's.

Behaviour the rebuild must keep:

- **An empty typed answer is checkable.** *"I don't know"* is graded on the server like any other
  answer. Refusing to submit it would be the page deciding the verdict.
- **Accept anyway is offered regardless of the box**, because it is a claim about the grading.
- **Position in the batch is shown above the prompt** — *"Card 3 of 44 in this batch"* — with the
  card's streak as two dots. Mastering a card takes four right answers across two directions, so
  *mastered* sits at 0 through a whole first pass; the position is the "where am I" it cannot give.
- **Every number on the screen is out of the same deck.** The surface asks for the API maximum, so a
  batch is the whole rotation wherever a deck fits in one. Past 100 unmastered cards the batch is a
  subset, and **batch + mastered = total** keeps it honest.
- **The deck summary moves on every answer**, without refetching: it is patched from the attempt's
  before/after progress (`lib/deck-summary.ts`). An override re-grades, so what it moves *from* is
  the first verdict.
- **`lang` is set per element.** The prompt carries the language it is written in, the answer box
  and the back the other; both flip with the stage.
- **A stale session is a sign-in prompt, not an error** — *Sign in again* returns to this exact deck
  via `?next=`.

## Your own cards

On a typed deck the own-words form sits under the card, collapsed by default, and loads the
learner's list only once opened. On any deck, *Add cards* asks a coach to fill cards in.

- Adding is **idempotent by content**: the id derives from the term, so adding the same card twice
  is the learner repeating themselves, and an edited back overwrites in place **and keeps the
  streak**.
- The card attaches to the **block being practised**, not the pack.
- Only the owner sees it, a republish never sweeps it, and deleting it takes its progress with it.
- `FROM_LEARNER` (`origin: 'learner'`), not `learnerId`, separates these from the pack's own items
  ([ADR-0015](../../architecture/decisions/0015-a-block-may-be-owned-by-a-learner.md)).

## Deliberate refusals

- **In practice, the back never reaches the page before the learner commits** — an answer, or an
  explicit reveal. Not in the prompt, not in a data attribute.
- **A self grade on a typed skill is a `400`.** So is a reveal.
- **Learn mode writes nothing**, and practice never serves what learn mode serves.
- **Someone else's own card is a `404`, not a `403`** — for attempts and reveals alike.
- **Stage 2 cannot be reached by API** — not by attempt, not by reveal, not by learn mode.
- **No demotion.** No decay, no forgetting curve, no re-testing of mastered cards.
- **No client-side grading**, ever — including "obvious" cases like an empty answer.
- **Mastery is advisory.** A self-graded deck's mastery is the learner's own word; nothing
  consequential is built on it (AGENTS.md).

## Where the code is

| | |
|---|---|
| Streak machine | `api/src/domain/drill-progress.ts` |
| Matching | `api/src/domain/matching.ts` |
| Prompt, masking, verdict (typed and self) | `api/src/domain/grading.ts` |
| Grading mode, reveal, learn card, payload builder | `api/src/domain/flashcards.ts` |
| A card's topic, the filter, the per-topic summaries, declared topics | `api/src/domain/topics.ts` |
| Moving labels onto declared ids | `api/src/services/retopic.ts`, `api/src/importer/retopic-cards.ts` |
| Serving, persisting, reveal | `api/src/services/drills.ts` |
| Own cards | `api/src/services/learner-terms.ts` |
| Routes | `api/src/http/learner.ts` |
| Screen | `web/src/components/flashcards.tsx`, `own-words.tsx`, `term-card.tsx` |
| Keyboard map, status line | `web/src/lib/flashcards.ts` |
| Topic links and names | `web/src/lib/topics.ts` |
| Page and old-address redirect | `web/src/app/(app)/flashcards/page.tsx`, `web/src/app/(app)/drills/words/page.tsx` |
| Strings | `web/src/i18n/dictionaries.ts` → `flashcards` |
