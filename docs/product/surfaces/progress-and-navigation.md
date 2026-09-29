---
title: Voortgang & het menu — where a learner is, and how they get anywhere
surface: (progress is no longer a declarable surface — ADR-0018, ADR-0021)
status: built
---

# Voortgang & het menu (progress and navigation)

| | |
|---|---|
| **Routes** | `/{locale}` (landing) · `/{locale}/skills` · `/{locale}/progress?packId=…` · `/{locale}/packs/{packId}` · `/{locale}/blocks/{blockId}` |
| **Capability** | `progress:read` |
| **Decides** | nothing. Every number here is **derived on read** |

This is the artifact the program this replaces maintained by hand across three markdown files. Here
it is derived from what actually happened, so it cannot fall out of date — and there is nothing
stored that could disagree with the events it came from.

## The rail: folders of skills

```
Start                     /nl                        the landing page
MIJN MENU                 (organise → /nl/skills)
▾ Nederlands              a folder the learner made
    Woordtrainer          /nl/progress?packId=…      a skill — opens on its overview
    Lezen · nieuws
  SAP · Networking        a skill outside any folder
Alle vaardigheden +3 verborgen   /nl/skills           everything started, hidden ones included
Wiki                      /nl/wiki                   platform furniture
Jouw gegevens             /nl/archive
```

Rules ([ADR-0021](../../architecture/decisions/0021-the-menu-is-folders-of-skills.md), which
supersedes ADR-0018):

- **Two levels: a folder, then skills.** Folders, their names and order, which folder a skill is in
  and whether it shows are all the learner's — stored as `menu` on the learner, never on a pack.
  Whether a folder is open is a per-browser preference (`localStorage`), and the folder holding the
  skill on screen is always open.
- **Only started skills.** Starting a new one is the landing page's job.
- **Hidden is not gone.** A hidden skill leaves the rail and is counted beside "All my skills", where
  it can be switched back on with its progress intact.
- **Nothing is ever lost.** `normalizeMenu` places every started skill exactly once, on read and on
  write — see the API doc for `/me/menu`.

## A skill's page: overview, then tabs

A skill's surfaces are no longer rail items. `SkillHeader` — rendered by the shell above whatever page
is open — shows the folder the skill is filed in, its name, and a row of tabs:

```
Nederlands ›
Woordtrainer
[Overzicht] [Lessen] [Lezen] [Woordtrainer] [Zinspuzzel] [Oefentoets]
```

`Overzicht` is `/progress?packId=…`, the page ADR-0018 had a pack land on. The rest are the surfaces
the skill offers and has. A tab is highlighted by route (`activeTab` in `lib/pack-scope.ts`), because
most surfaces open on more than one page — lessons covers the block list, a block and a lesson.

`progress` stays in the API's `surfaces` enum, because packs published against
[ADR-0009](../../architecture/decisions/0009-per-pack-presentation-is-declarative.md) name it and
rejecting it would fail their next publish over chrome that moved. The viewer ignores the key.

A skill the learner has **just** opened for the first time has no header until the next render:
opening the skill is what enrols them, and the shell fetched its list before that.

## When a surface appears

Three questions, asked in `web/src/lib/pack-scope.ts` **and nowhere else**
([ADR-0019](../../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)):

| Question | Source | Decides |
|---|---|---|
| Does the manifest **offer** it? | `presentation.surfaces`, or all of them | the item exists |
| Does the pack **have** any? | pack-wide material counts | the item exists |
| Can it be opened **now**? | the learner's current block | link, or greyed out |

The first two are conjunctive and decide **presence**: an item the pack has no material for is
*absent*, not disabled. The third decides **affordance**: there is material, there is simply nothing
to open at this moment.

Each surface answers the first two as data, in the registry entry that already carries its icon,
label and destination:

```ts
quiz: {
  icon: ListChecks,
  labelKey: 'quiz',
  has: ({ quiz }) => quiz > 0,                                     // does this pack do this?
  href: ({ locale, currentBlockId }) => currentBlockId ? … : null, // where does it open now?
}
```

**Presence is a property of the pack, not of where the learner is standing in it.** The counts are
pack-wide for that reason: gating presence on the current block would make items appear and vanish
as someone moves between blocks. A block not yet seeded greys its drill out; it does not remove it.

Consequently a manifest's `surfaces` list is **purely an opt-out**. It can hide a surface the pack
has material for; it can no longer conjure one it does not.

**Adding a surface** is therefore one registry entry answering two questions, plus a count in the
material payload if it needs a new one. No new endpoint — the shell reads the progress call it was
already making — and no branch anywhere on which pack it is.

## What progress reports

`GET /api/v1/progress?packId=…` returns, all derived:

```jsonc
{
  "pack": { … },                          // the manifest
  "currentBlock": { … } | null,
  "blockProgress": { … } | null,
  "blocks": [{ "block": …, "progress": … }],
  "decks": {                              // pack-wide deck summaries, one per drill kind
    "terms":     { "total": 120, "stage1Cleared": 45, "stage2Unlocked": 30, "mastered": 15, "inProgress": 105 },
    "wordOrder": { … },
    "quiz":      { … }
  },
  "reading": { "total": 12, "unread": 9 },
  "quiz": { "byCategory": [ … ], "sessions": 4, "score": { … } },
  "errorLog": { "entries": [ … ], "redrill": [ … ], "retire": [ … ], "top": [ … ] }
}
```

Without `packId` it returns `{ packs: [...] }` — the same shape per enrolled pack, which is what the
landing tiles read.

### Which block is "current"

In order: the enrollment's `currentBlockId`, else the first block that is not complete, else the
first block, else none. Blocks are listed **scoped to the learner**, so a pack whose blocks are all
written for individuals reports no blocks to anyone else and renders as an empty pack
([ADR-0015](../../architecture/decisions/0015-a-block-may-be-owned-by-a-learner.md)).

### Block completion

A block is complete when **every lesson has been corrected**. Pending submissions do not count: the
work is not done until the feedback exists, because the feedback is what the next block is written
from. `nextLessonOrder` is the first lesson neither corrected nor pending — so a lesson waiting on a
coach neither blocks the learner nor gets offered again.

## The error log — the memory that makes adaptation possible

The runtime, not the coach, owns these counters
([ADR-0001](../../architecture/decisions/0001-runtime-not-agent.md)). A correction supplies
**judgement** — which category a mistake belongs to. Everything derived from it is **arithmetic**.

The three rules, as the source program stated them:

> 3+ keer 🔁 in een categorie → die structuur komt terug als drill in het volgende blok.
> 2 blokken geen nieuwe fout in een categorie → status wordt ✅ en valt uit de actieve drills.
> De top-3 terugkerende categorieën sturen het grammatica-thema van het volgende blok.

### Status is derived, never stored

```
cleanBlocks ≥ 2                  → mastered
cleanBlocks ≥ 1                  → improving
count ≥ 3                        → recurring
otherwise                        → new
```

**Clean blocks dominate the count.** A category seen ten times but absent for two blocks is
`mastered`, because recency is what says whether a learner still makes the mistake. Status can never
disagree with the counters because it is not stored beside them.

### Occurrences and clean blocks

- Recording an occurrence resets `cleanBlocks` to **0** — which is how a mastered category drops back
  into the active set the moment it reappears.
- `cleanBlocks` is **derived** — the distance between the last occurrence and the furthest block
  closed — rather than accumulated. That makes closing a block **idempotent and order-independent**,
  which matters because a block review can be posted more than once.
- At most **8 examples** are kept per category: enough to recognise the pattern, not a full history.
  The oldest go first, because they stop being representative as a learner changes.

### The three derived lists

| List | Contents | Order |
|---|---|---|
| `redrill` | `recurring` categories — what the next block must drill again | count desc, then name |
| `retire` | `mastered` categories — what may drop out of active drilling | name |
| `top` | `recurring` **and** `improving`, capped at 3 — what drives the next block's focus | count desc, then name |

`top` includes `improving` deliberately: a category on the way out is still the right thing to
reinforce, and a focus list that only ever named entrenched problems would drop a learner's near-wins
the moment they stopped being wrong.

### Quiz accuracy sits beside it

Per-category accuracy across every sitting in the pack, **advisory** and derived on read. This is
what the progress page shows next to the error log and what the brief carries to whoever writes the
next block — the same numbers, so the learner and the author are looking at one thing.

## Deliberate refusals

- **Nothing here is stored.** No score, no status, no ranking, no "level". A stored judgement about a
  person can drift from the evidence it came from, and this system keeps evidence.
- **No dates in any of it.** Progression is position; the error log counts blocks, not weeks.
- **No cross-pack comparison.** Comparing two programs side by side means opening each. Nothing asked
  for the comparison, and the landing tiles carry the per-pack headline it was mostly used for.
- **No engagement metrics.** No time-on-page, no session length, no streak-of-days.

## Where the code is

| | |
|---|---|
| Error-log rules | `api/src/domain/error-log.ts` |
| Position and completion | `api/src/domain/progression.ts` |
| Ramp position | `api/src/domain/ramp.ts` |
| Assembly | `api/src/services/progress.ts` |
| Surface registry (the one place) | `web/src/lib/pack-scope.ts` |
| Menu | `web/src/components/learner-rail.tsx`, `web/src/lib/menu.ts`, `api/src/domain/menu.ts` |
| Skill tabs | `web/src/components/skill-header.tsx`, `skillTabs` in `web/src/lib/pack-scope.ts` |
| Organise page | `web/src/app/[locale]/(app)/skills/page.tsx`, `web/src/components/menu-editor.tsx` |
| Screens | `web/src/app/[locale]/(app)/page.tsx`, `progress/page.tsx`, `packs/[packId]/page.tsx`, `blocks/[blockId]/page.tsx` |
