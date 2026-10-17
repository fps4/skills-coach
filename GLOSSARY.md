# Glossary

The vocabulary of the domain. These terms are used precisely and consistently in code, API and docs.
Where the Dutch pack has its own word for something, it is given for reference only — the platform
never uses it.

## Content

**Skill** — what a learner sees and practises: the learner-facing name for a **pack**
([ADR-0021](docs/architecture/decisions/0021-the-menu-is-folders-of-skills.md)). Interface text says
*skill* (Dutch: *vaardigheid*); code, the API and the archive format keep saying *pack*, because
`packId` is the reference every exported file carries. Skills are small and narrowly focused — a word
trainer, one set of verbs, a reading list.

**Menu** — the learner's own arrangement of the skills they have started: **folders** they name and
order, and for each skill which folder it is in and whether it is **hidden**. Belongs to the learner,
never to a pack. A hidden skill keeps its progress and waits on the "All my skills" page, which also
lists every skill not added yet — adding one is what starts it — and the start page shows exactly
the menu's shown skills ([ADR-0024](docs/architecture/decisions/0024-a-skill-is-added-from-the-library-and-the-start-page-is-the-menu.md)).

**Pack** — a complete training program for one skill, e.g. Dutch conversation B1→B2. A pack declares
its own **content language**, its competency **framework**, its **error categories** and its section
map. A skill is written in one language: every title, description and label it carries is one string,
never one per language ([ADR-0026](docs/architecture/decisions/0026-a-skill-is-written-in-one-language.md)). Everything skill-specific enters the platform through a pack; nothing about a skill is hardcoded
in the runtime.

**Method** — a pack's declared teaching method: the lesson arc, its authoring rules, and its
per-topic sequencing notes. Where the **ramp** says how hard the next block should be, the method
says how it should be built. Both are carried into the **brief** verbatim and neither is interpreted.
See [`docs/guides/teaching-method.md`](docs/guides/teaching-method.md).

**Block** *(Dutch pack: "blok")* — an ordered, themed batch of lessons within a pack, with a level, a
grammar/skill focus and a milestone. Blocks are the unit of authoring and of adaptation: only the
current block need exist, and the next one is written from evidence about the last.

**Lesson** *(Dutch pack: "les")* — one sitting. Ordered within its block. A lesson is an ordered
array of typed **sections**.

**Section** — a typed piece of a lesson. The runtime knows nine kinds: `text`, `rules`, `vocabulary`,
`questions`, `speak`, `write`, `listening`, `dictation`, `exercise`. The viewer renders each kind its
own way; `write` sections are what produce a submission.

**Drill item** — one practisable atom, held in a deck separate from lesson prose so it can be
scheduled independently. Three kinds today: `term` (a **flashcard** — a front and a back), `word-order`
(a sentence, its correct chunk order, a translation and a grammar tip), and `mcq` (a question, its
options, its answer key, an explanation, and the error categories it tests).

**Flashcard** *(card)* — a `term` drill item: a front (`term`) and a back (`translation` — for a
concept, its meaning), practised in both directions. Optionally a **cue** (`hint`), a section label
(`group`), an example, and details shown after answering — an analogy (*map onto what you know*),
code, a source, and a word's forms, synonyms and note. A word and a concept are the same thing to the
runtime ([ADR-0027](docs/architecture/decisions/0027-flashcards-are-one-engine-with-two-ways-of-answering.md)).
The learner-facing surface is called *Flashcards*; the Woordtrainer is a skill that is one deck of them.

**Topic** — what a card is about: its `group`. One per card, so a deck's topics partition it and a
deck can be practised, studied and tracked one topic at a time — the overview shows a tile per topic
([ADR-0031](docs/architecture/decisions/0031-a-deck-is-practised-by-topic.md)). Cards without one are
the topic `_none`, listed last; a deck where no card has one has no topics. A skill may **declare** its
topics in its manifest — id, title, a line on what is in it, and the guides it is practised from — and
then every published card names one by id
([ADR-0032](docs/architecture/decisions/0032-a-skill-declares-its-topics.md)). A learner files their own
words under any topic, declared or their own
([ADR-0033](docs/architecture/decisions/0033-a-learner-files-their-own-words-by-topic.md)).

**Grading mode** — how a pack's cards are answered, declared in its manifest
(`flashcards.grading`). **Typed**: the learner types the back and the server matches it tolerantly,
with *Accept anyway* (an override). **Self-graded**: the learner turns the card over — a **reveal**,
which records nothing — and says *Got it* or *Missed it*. Typed is the default.

**Learn mode** — the flashcards shown with their answers, to study rather than be tested. Records
nothing: no attempt, no streak. The one place the back of a card reaches the page before the learner
has committed to an answer, because they asked for it.

**Answer key** — the `correct` options an `mcq` carries. Held on the server and revealed only after
the learner commits. Because the key is authored in advance, a wrong answer records an error-log
occurrence with no coach involved — see
[ADR-0014](docs/architecture/decisions/0014-an-authored-answer-key-may-write-the-error-log.md).

**Multiple response** — an `mcq` whose key names more than one option. Scored all-or-nothing: every
correct option and no incorrect one. There is no partial credit and no override.

**Sitting** *(a quiz session)* — a fixed set of questions answered through in one go, in one of two
modes. `practice` grades each answer as it is given; `exam` withholds every verdict until the end.
Its score and per-category breakdown are derived on read, never stored.

**Word request** — a learner asking for a word's card to be filled in: its translation, forms,
example, synonyms and a note. A coach proposes a **suggestion**; the learner edits it, leaves lines
out, and accepts it into their deck as an own word — or asks again, or discards it
([ADR-0023](docs/architecture/decisions/0023-a-coach-fills-in-a-word-the-learner-asked-for.md)).

**Own word** — a `term` item a learner added themselves rather than one that arrived with the pack.
It practises identically and lives in the same deck, but only its owner can see it and a republish of
the block never removes it. See [ADR-0012](docs/architecture/decisions/0012-a-learner-may-add-to-their-own-deck.md).

**Article** — a piece of long-form reading loaded into **one learner's** library. Not part of a
pack's curriculum: it is the learner's own domain brought into the pack, so nobody else ever sees it.
An article is **parallel text** — one **variant** per language — and is identified by its slug, so
re-loading it corrects it in place. See
[ADR-0017](docs/architecture/decisions/0017-reading-is-personalized-parallel-text.md).

**Variant** — one language's rendering of an article: a language tag, a title, and markdown. An
article opens in the pack's content language; the learner can open another variant by name from the
article page.

**Label** — a free string an article carries, chosen by whoever loaded it. The library filters and
groups by labels; the runtime never interprets one, exactly as it never interprets a ramp's dials.

**Source** — where an article was published: a URL, and the `site` that names the publication. The
library groups and filters by `site` alongside labels, but on the opposite quantifier — an article
carries many labels and needs *all* of the ones asked for, and has one source and needs to match
*any* of them. An article with no `site` is not filed under a placeholder; it simply has no source
facet.

**Content language** — the language a pack's material is written in. Distinct from the language of
the interface chrome, which is English and only English
([ADR-0025](docs/architecture/decisions/0025-the-interface-is-english-only.md)). A Dutch pack renders
as Dutch inside the English interface. See
[ADR-0005](docs/architecture/decisions/0005-ui-language-vs-content-language.md).

## Learner state

**Learner** — a person working through a pack, identified by the `sub` claim of their
identity-service token. The `learners` record is a thin profile (display name, domain profile); Skills
Coach stores no credentials.

**Enrollment** — a learner's position in a pack: current block, current lesson.

**Drill state** — per learner, per drill item: which **stage** they are on, their current **streak**,
and whether the item is **mastered**. This is the spaced-repetition state.

**Reading state** — per learner, per article: that they marked it read, and when. Kept apart from the
article for the reason drill state is kept apart from the drill item — content gets re-loaded, and a
corrected translation must not arrive as something unread. Reversible: read is a filter the learner
sets, never a measurement of them.

**Stage** — a direction of practice for one drill item. Stage 2 is gated behind mastering stage 1.
For `term` items: stage 1 is term → meaning (content language → translation), stage 2 the reverse
(which, typed, drills spelling). The flashcards call them *direction 1* and *direction 2*. For `word-order` items: stage 1 is the primary correct order, stage 2 an alternative valid
order of the same chunks.

**Streak** — consecutive correct answers at the current stage. Two clears the stage. Any wrong answer
resets it to zero — a near-miss is not partial credit.

**Attempt** — an append-only record of one answer to one drill item: what was given, whether it was
correct, whether the learner overrode a rejection, and whether the verdict was their own
(`selfGraded`). A reveal and learn mode are not attempts.

## The coaching loop

**Submission** — a learner's written answers for a lesson, awaiting correction. `pending` until an
external coach corrects it, then `corrected`.

**Correction** — what the external coach returns for a submission: per-item `{original, corrected,
categories, explanation}`, a category tally, and advisory ratings. The runtime derives error-log
changes from it; the coach never writes counters directly.

**Error category** — a stable, pack-declared label for a kind of mistake (the Dutch pack uses
`woordvolgorde-bijzin`, `perfectum/imperfectum`, and so on; the AWS pack uses the exam guide's twenty
task statements). Categories are the join key between correction, drilling, quiz questions and
next-block generation, so they must stay stable across a pack's life. A category may declare a free
`group` label — an exam domain, say — which the viewer groups by and the runtime never interprets.

**Error log** *(Dutch pack: "foutenlog")* — per learner, per category: examples, first and last seen,
a count, and a status of `new` → `recurring` → `improving` → `mastered`. This is the memory that
makes adaptation possible.

**Block review** — the end-of-block assessment, carrying a **next-block brief**: what to re-drill,
what to retire, and the theme and difficulty for the block after this one.

**Brief** — the assembled input for authoring the next block: current error-log state, position on
the competency ramp, the pack's **method**, and the program goal. Fetched from `GET /coach/v1/blocks/:id/brief`. The runtime
assembles it; an external coach consumes it.

## Boundaries

**Runtime** — this system. Stores, grades deterministically, counts, progresses. Generates nothing.

**External coach** — whatever authors lessons and corrects free-form answers. Today a person driving
an LLM CLI against `/coach/v1`; the contract is designed so this can later be the runtime calling a
model API without the API changing.

**Capability** — an action Skills Coach permits, e.g. `submission:write`. Roles arrive on the token
from identity-service; Skills Coach owns the role → capability map and the enforcement. An unknown
role grants nothing.
