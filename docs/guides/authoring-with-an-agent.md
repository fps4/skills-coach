---
title: Authoring blocks with an agent over MCP
status: current
date: 2026-08-03
---

# Authoring blocks with an agent

This is written **for the model** doing the authoring, and for whoever is driving it. It is the
[coach loop](coach-loop.md) with the tools in place of the curl calls, and it assumes you are
connected to the Skills Coach MCP.

Read it before writing a block. The rules in it are not style preferences — most of them are things
the runtime enforces or silently degrades, and getting one wrong costs a learner their progress.

It covers the *contract*: what a block is, what fails a publish. For what makes a block **good** —
how a lesson is shaped, how much new vocabulary it carries, how a write prompt is built so it
actually elicits the mistakes you want to see — read [the teaching method](teaching-method.md), and
then the `method:` block the pack itself declares.

## What you are doing, and what you are not

**You author one block at a time, from evidence.** A block is roughly six lessons on a theme. You
write the next one only after the last one has been corrected and reviewed, because the whole point
is that it answers what actually went wrong.

You are not the runtime. You never set a counter, a status or a streak — you report judgement and
the runtime derives everything from it ([ADR-0001](../architecture/decisions/0001-runtime-not-agent.md)).
There is no tool that lets you do otherwise, deliberately.

**Do not pre-generate whole phases.** Generating blocks 3 through 8 in advance locks in a difficulty
guess and ignores what the learner did in block 2, which is the one thing this design exists to
avoid.

**Blocks are not committed to the repository.** Only manifests are
([ADR-0008](../architecture/decisions/0008-a-packs-manifest-is-product.md)); a block is published
straight into the runtime with `publish_block` and lives in the database. If you were expecting to
open a pull request with lesson files, you were not — publishing *is* the import.

## Connecting

```sh
claude mcp add --scope user --transport http skills-coach https://coach-mcp.fps4.nl/mcp \
  --client-id skills-coach-mcp-operator --callback-port 9415
```

The callback port is exact-matched against what is registered, so it cannot be changed freely. Your
account needs the **`coach` role** on the `skills-coach` application; without it the login succeeds
and every tool refuses. If `tools/list` comes back empty or the endpoint answers 403, that is what
to check first — not the client.

## The loop

```
  get_brief ──▶ write the block ──▶ publish_block
      ▲                                   │
      │                                   ▼
 post_block_review ◀── post_correction ◀── list_submissions
```

### 1. Read the brief

```
get_brief { blockId: "<the block just finished>" }
get_brief { packId: "<pack>", learnerId: "<learner>" }   ← for their first block
```

It assembles what you would otherwise have to go and find:

| Field | Is |
|---|---|
| `learner.profile` | the working world this block is **about** — domain, background, target role |
| `evidence.errorLog`, `evidence.lessons` | how the learner actually did |
| `evidence.redrill` | categories at 3+ occurrences — these **must** come back as practice |
| `evidence.retire` | categories with two clean blocks — stop drilling these |
| `nextBlock.ramp` | the level, phase and **dials** for the block you are about to write |
| `pack.method` | how this pack is taught — lesson arc, authoring rules, per-topic sequencing |
| `goal` | what the whole program is for |
| `evidence.review.nextBlockBrief` | what the last review explicitly asked for |

**The dials are the specification.** `textLength: ~170 words` means write ~170 words, not 400.
`grammar: perfectum, subclause word order` means those structures carry the block. The runtime never
interprets a dial — it hands them to you verbatim because you are the one who acts on them.

**`pack.method` is how to build it.** The dials say how hard; the method says how — the lesson arc,
how many new terms a lesson carries, how much of the last block to recycle, and the sequencing notes
for topics that fail when taught in the obvious order. It is carried verbatim for the same reason.
A pack that declares none leaves you working from the dials alone.

**`learner.profile` is what it is about.** A pack holds only the methodology; the subject matter is
this person's ([ADR-0015](../architecture/decisions/0015-a-block-may-be-owned-by-a-learner.md)). Two
learners on the same rung of the same ramp get texts about entirely different working worlds, and
that is the point — a text about somebody else's job is a text they will read once and never reuse a
word of.

If the profile is empty, **stop and write one** with `set_learner_profile` before authoring. Guessing
a domain and building six lessons on the guess is the expensive way to find out you were wrong.

**Block 1 has a brief too.** Pass `packId` and `learnerId` instead of a `blockId` and you get the same
payload with the evidence half empty: the goal, the method, the ramp's first rung and the profile.
There is no evidence yet — that is the point of asking, not a reason not to.

### 2. Write the block

A block is `{ order, slug, title, level?, theme?, focus?, milestone?, learnerId?, lessons[], drillItems[] }`.

- **`learnerId`** — who it is for. **Set it.** Omit it and the block belongs to the pack, which means
  every learner in that pack sees lessons written about one person's job. Omitting it is right for a
  demo or template pack and wrong for everything else.
- **`order`** — the next integer *for that learner*. Two learners each have a block 1.
  `blockId` is derived as `<packId>.u<owner>.b<order>`, or `<packId>.b<order>` when the pack owns it.
- **`slug`** — lower-case, hyphenated, and **permanent**. Republishing a block under a different
  slug is a `409`: the old one is already in links people have.
- **`focus`** — optional tags. Anything of the form `category:<id>` is checked against the pack's
  declared error categories and a mismatch fails the publish, because a typo there would quietly
  break re-drilling.
- **`milestone`** — what the learner should be able to do at the end. One sentence, testable.

Each lesson is `{ order, title, level?, estimatedMinutes?, focus?, sections[] }` with at least one
section. Six lessons per block is the established rhythm: vocabulary, grammar, listening,
professional/interview, reading, then free conversation and review.

### The nine section kinds

The set is closed ([ADR-0004](../architecture/decisions/0004-pack-contract-and-typed-sections.md)).
You cannot invent one — there is a renderer behind each, and a tenth kind is a platform change.

| `kind` | Required fields | Produces |
|---|---|---|
| `text` | `body` | — a passage to read aloud |
| `rules` | `body` | — a grammar explanation |
| `vocabulary` | `items[]` of `{term, translation, example?}` | **term drills, automatically** |
| `questions` | `items[]` of `{ref, prompt}` | answers in the submission |
| `speak` | `prompt`, `minSentences?`, `requirements?` | a self-reported note |
| `write` | `prompt`, `minSentences?`, `requirements?` | **the submission you will correct** |
| `listening` | `prompt`, `sources?` of `{title, note?}` | — |
| `dictation` | `sentences[]` | an answer key, kept behind a reveal |
| `exercise` | `items[]`, `answers?` of `{ref, answer}` | self-checked |

Every section also takes `id` (slug-like, unique within the lesson), `title?` and `instruction?`.

Two things worth knowing:

- **A `vocabulary` section becomes term drills on its own.** Do not also list those words in
  `drillItems` — you would be writing them twice, and the deduplication that saves you is
  incidental, not a feature.
- **Every lesson needs something submittable** if you want it corrected. A lesson of only `text` and
  `rules` produces no submission, so it generates no evidence, so it contributes nothing to the next
  brief.

### Drill items

```json
{ "lessonOrder": 2, "payload": { "kind": "term", "term": "de vergadering", "translation": "the meeting", "example": "De vergadering duurt een uur." } }
{ "lessonOrder": 3, "payload": {
    "kind": "word-order",
    "sentence": "Morgen begin ik met de cursus.",
    "parts": ["ik", "begin", "morgen", "met de cursus"],
    "translation": "Tomorrow I start the course.",
    "tip": "Fronting a time phrase inverts subject and verb.",
    "partsAlt": ["morgen", "begin", "ik", "met de cursus"] } }
```

- **`parts` is the answer.** The trainer shuffles it. Write the chunks in mid-sentence form —
  whichever lands first is capitalised for you.
- **Split subject and verb into separate chunks**, or inversion cannot be expressed at all. Four to
  seven chunks, each an unbreakable unit.
- **`partsAlt` must be a permutation of exactly the same chunks.** If it is not, the item silently
  becomes single-order — the publish reports how many it dropped, so check that number.

### 3. Publish

```
publish_block { packId: "<pack>", block: { … } }
```

Idempotent by construction: ids derive from position and content, so republishing updates in place
and **a drill item whose text is unchanged keeps the learner's progress on it**. Change one
character of a term and it becomes a new item with a fresh streak — which is the right behaviour,
and a reason not to churn wording between publishes.

Read the response: `ignoredAlternatives` counts word orders dropped for not being permutations, and
`drillItemsRemoved` counts items the new version dropped **along with the progress attached to
them**. A number you did not expect there means you changed something you did not mean to.

### 4. Correct what comes back

```
list_submissions { status: "pending" }
get_submission   { submissionId }
post_correction  { submissionId, correction: { items: [...], ratings: {...} } }
```

Each item is `{ original, corrected, categories[], explanation? }`.

- **Use only the pack's declared category ids** — `list_packs` gives you them. An invented one is
  rejected, because it would accumulate history that never joins anything.
- **One item per mistake, not per sentence.** Two mistakes in one sentence are two items, or the
  counts under-report and the wrong things get re-drilled.
- **Do not invent mistakes.** A model asked to correct will find something to correct; inflated
  counts distort what comes back as practice. If a sentence is right, leave it out.
- Keep `explanation` to one sentence, in the learner's interface language.
- Ratings are advisory, never a persisted score about a person.

Correcting the same submission twice is a `409`.

### 5. Close the block

```
post_block_review { blockId, learnerId, review: { whatWentWell?, nextBlockBrief: { redrill[], retire[], themeAndDifficulty? } } }
```

**This is what makes a mistake retire.** Every category that did not appear in the block earns a
clean block; two clean blocks means mastered. Skip the review and nothing ever retires, the error
log only grows, and the re-drill list stops being a signal. Clean blocks are derived rather than
accumulated, so posting twice is safe.

Then go back to `get_brief` for the next one.

## A prompt that works

> You are authoring block N of a Dutch conversation program for one learner.
> Here is the brief: `<get_brief output>`
> Here are the pack's declared error categories: `<ids from list_packs>`
>
> Write the block as a `publish_block` payload, with `learnerId` set to `brief.learner.learnerId`.
> Six lessons. Honour every dial in
> `nextBlock.ramp.dials` — text length, sentence complexity, grammar load — and build every lesson
> to the arc and rules in `pack.method`. Every text, example and write prompt sits in the working
> world in `learner.profile`; do not invent a domain, and do not borrow one from an example block.
> Build practice for
> every category in `evidence.redrill`. Do not drill anything in `evidence.retire`.
> Use only the nine section kinds. Every lesson must contain one `write` or `questions` section, or
> it generates no evidence. Word-order `partsAlt` must be a permutation of the same chunks.

## When something is refused

Refusals come back as tool errors you can read, not transport failures. The common ones:

| Message | What it means |
|---|---|
| `this operation requires the … capability` | your account lacks the `coach` role |
| `block N already exists as "<slug>"` | the slug is permanent; publish under the existing one |
| `block focus references categories the pack does not declare` | a `category:` tag has a typo |
| `category … is not declared by pack …` | a correction used an invented category id |
| `several learners have work in this pack` | pass `learnerId` explicitly |
| `a first-block brief needs learnerId` | `packId` alone has no block to infer a learner from |
| `this submission has already been corrected` | someone corrected it first |
