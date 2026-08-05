# Glossary

The vocabulary of the domain. These terms are used precisely and consistently in code, API and docs.
Where the Dutch pack has its own word for something, it is given for reference only — the platform
never uses it.

## Content

**Pack** — a complete training program for one skill, e.g. Dutch conversation B1→B2. A pack declares
its own **content language**, its competency **framework**, its **error categories** and its section
map. Everything skill-specific enters the platform through a pack; nothing about a skill is hardcoded
in the runtime.

**Block** *(Dutch pack: "blok")* — an ordered, themed batch of lessons within a pack, with a level, a
grammar/skill focus and a milestone. Blocks are the unit of authoring and of adaptation: only the
current block need exist, and the next one is written from evidence about the last.

**Lesson** *(Dutch pack: "les")* — one sitting. Ordered within its block. A lesson is an ordered
array of typed **sections**.

**Section** — a typed piece of a lesson. The runtime knows nine kinds: `text`, `rules`, `vocabulary`,
`questions`, `speak`, `write`, `listening`, `dictation`, `exercise`. The viewer renders each kind its
own way; `write` sections are what produce a submission.

**Drill item** — one practisable atom, held in a deck separate from lesson prose so it can be
scheduled independently. Two kinds today: `term` (a word or phrase with its translation and an
example) and `word-order` (a sentence, its correct chunk order, a translation and a grammar tip).

**Own word** — a `term` item a learner added themselves rather than one that arrived with the pack.
It practises identically and lives in the same deck, but only its owner can see it and a republish of
the block never removes it. See [ADR-0012](docs/architecture/decisions/0012-a-learner-may-add-to-their-own-deck.md).

**Content language** — the language a pack's material is written in. Distinct from **UI language**,
the language of the interface chrome. A Dutch pack renders as Dutch whether the interface is set to
Dutch or English. See [ADR-0005](docs/architecture/decisions/0005-ui-language-vs-content-language.md).

## Learner state

**Learner** — a person working through a pack, identified by the `sub` claim of their
identity-service token. The `learners` record is a thin profile (display name, UI language); Skills
Coach stores no credentials.

**Enrollment** — a learner's position in a pack: current block, current lesson.

**Drill state** — per learner, per drill item: which **stage** they are on, their current **streak**,
and whether the item is **mastered**. This is the spaced-repetition state.

**Stage** — a direction of practice for one drill item. Stage 2 is gated behind mastering stage 1.
For `term` items: stage 1 is content-language → translation, stage 2 the reverse (which drills
spelling). For `word-order` items: stage 1 is the primary correct order, stage 2 an alternative valid
order of the same chunks.

**Streak** — consecutive correct answers at the current stage. Two clears the stage. Any wrong answer
resets it to zero — a near-miss is not partial credit.

**Attempt** — an append-only record of one answer to one drill item: what was given, whether it was
correct, and whether the learner overrode a rejection.

## The coaching loop

**Submission** — a learner's written answers for a lesson, awaiting correction. `pending` until an
external coach corrects it, then `corrected`.

**Correction** — what the external coach returns for a submission: per-item `{original, corrected,
categories, explanation}`, a category tally, and advisory ratings. The runtime derives error-log
changes from it; the coach never writes counters directly.

**Error category** — a stable, pack-declared label for a kind of mistake (the Dutch pack uses
`woordvolgorde-bijzin`, `perfectum/imperfectum`, and so on). Categories are the join key between
correction, drilling and next-block generation, so they must stay stable across a pack's life.

**Error log** *(Dutch pack: "foutenlog")* — per learner, per category: examples, first and last seen,
a count, and a status of `new` → `recurring` → `improving` → `mastered`. This is the memory that
makes adaptation possible.

**Block review** — the end-of-block assessment, carrying a **next-block brief**: what to re-drill,
what to retire, and the theme and difficulty for the block after this one.

**Brief** — the assembled input for authoring the next block: current error-log state, position on
the competency ramp, and the program goal. Fetched from `GET /coach/v1/blocks/:id/brief`. The runtime
assembles it; an external coach consumes it.

## Boundaries

**Runtime** — this system. Stores, grades deterministically, counts, progresses. Generates nothing.

**External coach** — whatever authors lessons and corrects free-form answers. Today a person driving
an LLM CLI against `/coach/v1`; the contract is designed so this can later be the runtime calling a
model API without the API changing.

**Capability** — an action Skills Coach permits, e.g. `submission:write`. Roles arrive on the token
from identity-service; Skills Coach owns the role → capability map and the enforcement. An unknown
role grants nothing.
