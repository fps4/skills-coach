---
title: The teaching method
status: current
date: 2026-08-06
---

# The teaching method

This is the didactic half of authoring. [`authoring-with-an-agent.md`](authoring-with-an-agent.md)
says what a block *is* — the schema, the nine section kinds, what fails a publish. This says what a
good one *does*, and why.

It exists because that was missing. The system knew how hard block N+1 should be — the ramp's dials
say `~280 words`, `relative clauses, conditionals` — and said nothing about how a lesson should be
built out of them. An author was left to supply a teaching method from whatever they already
believed, which is exactly the kind of thing that varies silently between blocks and then shows up
as a learner who is not improving.

Nothing here is novel. It is ordinary second-language-acquisition practice, written down so that
every block is built the same way.

## Where the method lives

| Layer | Holds |
|---|---|
| This document | the principles, and why each one is a rule rather than a preference |
| A pack's `method:` block in `pack.yaml` | that pack's own commitments — lesson arc, authoring rules, per-topic sequencing |
| A pack's `framework.ramp[].dials` | how hard the next block should be |

The runtime carries all three and interprets none of them
([ADR-0001](../architecture/decisions/0001-runtime-not-agent.md)). `method` and `dials` reach an
author verbatim inside `get_brief`, under `pack.method` and `nextBlock.ramp`.

The split is the one from
[ADR-0004](../architecture/decisions/0004-pack-contract-and-typed-sections.md): what is true of
teaching in general is here, what is true of *this* skill is in the pack. "Interleave practice" is
platform. "Introduce one function of *er* per block" is Dutch, and belongs in the Dutch manifest.

## The seven principles

### 1. Every lesson makes the learner produce

Recognition is not production. A learner who can read a subclause and understand it will still put
the verb in the wrong place when they write one, and the system cannot know that until they write
one.

This has a mechanical consequence the runtime already enforces: a lesson with only `text` and `rules`
sections generates no submission, so it generates no correction, so it contributes nothing to the
error log and nothing to the next brief. A block of six such lessons advances the learner's position
and leaves the adaptation loop with no input at all.

**Rule:** every lesson carries at least one `write`, `speak`, `questions` or `exercise` section.

### 2. Input sits just past the current level

Material slightly above what the learner can already produce is what moves them; material far above
it is decoding practice, and material at their level is revision. This is the `i+1` idea, and the
ramp's `textLength` and `sentences` dials are the operational form of it.

Treat a dial as a ceiling and a floor, not a target to beat. `~280 words` written as 400 does not
teach faster — it moves the text out of the band where the learner can attend to *form* rather than
spending everything on meaning.

**Rule:** honour the dials of the rung block N+1 sits on. If a text needs to be longer to be
worthwhile, the pack's ramp is wrong and should be changed deliberately, in the manifest.

### 3. Output is pushed, not merely permitted

A prompt like *"write about your week"* can be answered entirely in main clauses with the present
tense. If the block is teaching the perfect tense, that prompt teaches nothing and produces no
evidence about the perfect tense either.

A pushed prompt makes the target structure the only way to answer: *"describe three things that went
wrong last week and what you did about each"* cannot be written without the past.

**Rule:** for every category in `evidence.redrill`, there is a prompt in the block that cannot be
answered correctly without it.

### 4. Correction is focus-on-form

Corrective feedback works when it is about a form the learner is currently learning and is tied to a
category they can see accumulate. It stops working when it is general polish — a learner who receives
fifteen corrections learns that they are bad at the language, not that their subclause word order is
the problem.

This is why corrections carry a category id from the pack's declared vocabulary and why an invented
one is rejected: an uncategorised correction is a comment, not evidence.

**Rule:** correct against the declared categories. Leave correct-but-plain sentences alone. One item
per mistake, not per sentence — two mistakes in one sentence are two items, or the counts under-report
and the wrong things come back as practice.

### 5. Practice interleaves

The tempting shape is one lesson per problem: a word-order lesson, then a preposition lesson. It
performs better *during* the block and worse afterwards. When every item in an exercise needs the
same rule, the learner stops selecting the rule and starts applying the obvious one — and selection
is the skill that a real conversation demands.

**Rule:** spread the re-drill categories across the block. A lesson may be *themed* on a structure;
its practice should still mix in categories from earlier lessons.

### 6. Prior material recycles

An item leaves the active deck when it is mastered — two correct in a row in each direction. That is a
gate for *drilling*, not evidence of durable knowledge. What consolidates it is meeting the item
again in context, unprompted, in something the learner is reading for another reason.

**Rule:** roughly a third of the previous block's drill items reappear inside this block's texts —
not in its decks, in its prose. Costs nothing; it is a word choice while writing.

### 7. Vocabulary is learned as chunks

A noun without its article and a verb without its preposition are two facts, learned separately,
usually with the second never learned at all. Dutch punishes this specifically: `de/het` is not
predictable enough to derive, so a term stored without its article guarantees a `lidwoord` error
later.

**Rule:** a vocabulary item carries its article and one collocation. Drill `de vergadering bijwonen`,
not `vergadering`.

## Working backwards from the milestone

A block declares a `milestone` — *"discuss a work topic for five minutes and react to
counter-questions"*. That is the assessment, and the six lessons are what makes it passable. Write it
first, then ask of each lesson what it contributes to it. A lesson that contributes nothing is not
necessarily wrong, but it should be a deliberate choice rather than the result of filling six slots.

This is why blocks are not weeks and lessons are not days. Miss a day and you do the next lesson.
Nothing is tied to a calendar, so nothing falls out of sync.

## What this method is not

**It is not spaced repetition.** The drill gating — two correct in a row, reverse direction gated
behind forward, a wrong answer resets the streak — is mastery-based, not interval-based. There is no
scheduler and no forgetting curve. That is deliberate: the rules are the ones the source program
proved in use, and rebuilding SRS as a science project is
[explicitly out of scope](../product/vision.md).

**It is not a syllabus.** Nothing here says what to teach in block 7. That comes from the error log
and the ramp, which is the whole point of the design.

**It is not enforced.** None of it is validated at publish time, because none of it can be. The
runtime checks structure — that a category exists, that a `partsAlt` is a permutation, that a slug is
stable. Whether a text is at the right level is judgement, and judgement lives outside the runtime by
design.

## Declaring it in a pack

```yaml
method:
  principles:
    - Every lesson makes the learner produce, not only read.
  lessonArc:
    - input — a text at the block's level
    - form — the structure it demonstrated
    - controlled practice — where the answer is knowable
    - pushed output — a prompt that forces the structure
  rules:
    newTermsPerLesson: 8–12, as chunks with the article
    recycleFromPriorBlock: a third of the previous block's items reappear in this block's texts
  sequencing:
    article: drilled as an article+noun chunk, never taught as a rule
```

Every field is optional and every value is free text. `rules` and `sequencing` are open records for
the same reason a ramp's `dials` are: a language pack, a certification syllabus and a craft do not
share a lesson shape, and a schema that insisted they did would be the runtime holding an opinion
about didactics it cannot act on.

`packs/demo-conversation-nl/pack.yaml` carries a short one; `packs/dutch-conversation-nl/pack.yaml`
carries the real one, including the Dutch sequencing notes.

## Where these come from

Standard second-language-acquisition results, not house theory:

- **Retrieval practice** — testing produces retention that re-reading does not (Roediger & Karpicke).
  Principle 1.
- **Comprehensible input at `i+1`** — acquisition happens on material slightly beyond current
  competence (Krashen). Principle 2.
- **The output hypothesis** — producing language forces syntactic processing that comprehension
  alone does not (Swain). Principle 3.
- **Focus on form / corrective feedback** — attention to form inside meaningful communication beats
  both isolated grammar drill and pure immersion (Long; Lyster & Ranta). Principle 4.
- **Interleaved practice** — mixed practice depresses in-session performance and improves retention
  and transfer (Rohrer & Taylor). Principle 5.
- **The lexical approach** — fluency runs on formulaic sequences rather than assembled single words
  (Lewis; Nation). Principle 7.
- **Task-based language teaching** — a communicative task as the unit of design (Ellis). The
  milestone.
