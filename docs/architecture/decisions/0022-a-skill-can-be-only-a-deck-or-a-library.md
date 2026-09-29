---
title: A skill can be only a deck or only a library, and a programme's can be forked out of it
status: accepted
date: 2026-09-29
---

# ADR-0022 — A skill can be only a deck or only a library

## Context

[ADR-0021](0021-the-menu-is-folders-of-skills.md) made the menu folders of small skills. The first
two are carved out of the Dutch programme: its word trainer and its reading library, each wanted as
a skill of its own that a learner studies without the programme — and, once they have been carved
out, without the programme existing at all.

The pack contract did not allow either shape. A manifest had to declare at least one error category,
and a block had to hold at least one lesson. Both assumed every pack is a course: lessons to submit,
corrections against a vocabulary of mistakes. A word deck has no lessons and nothing a coach
corrects; a reading list has neither lessons nor a deck.

And a learner's words hang off a block ([ADR-0012](0012-a-learner-may-add-to-their-own-deck.md)), as
does every streak on them. A skill that is only words still needs somewhere for them to live.

## Decision

**A manifest may declare no error categories**, and **a block may hold no lessons.** Everything else
in the contract is unchanged, and everything downstream already coped: a correction naming any
category against a pack with none is refused as an unknown category always was; a block with no
lessons reports zero of zero and is never "current work".

**A skill that is only a deck keeps its words in one block with no lessons** — its *deck block*,
`woordenlijst`, order 1. Every word in it is a learner's own (ADR-0012): private to them, keyed on
them, and out of reach of any publish. Nothing about practising changes, because nothing about the
item shape changed. The shell counts only blocks *with lessons* when deciding whether a skill has a
Lessons tab (ADR-0019), so a deck block does not conjure one.

**A skill that is only a library needs no block at all**: reading was already pack-scoped rather
than block-scoped ([ADR-0017](0017-reading-is-personalized-parallel-text.md)).

**A programme's words and reading can be forked out into such skills**, by
`services/skill-migration.ts` (`npm run migrate:to-skills`). For each learner it copies:

- every term they could practise — the programme's and their own — into the deck as *their own*
  word, collapsing duplicates;
- their progress on each, merged by the archive's never-demote rule
  ([ADR-0020](0020-a-learner-can-take-their-progress-with-them.md)), and their attempt history;
- their articles and read marks, re-keyed under the reading skill with the same slugs, so the reading
  workflow reloads onto the same articles;

then enrols them in both and files both in one folder of their menu. It copies and never deletes, and
a second run changes nothing already at least as far along. It is dry unless `--apply` is given.

**Removing the programme afterwards is a separate step**, and the only place this repository deletes
learner history: `remove-pack --including-history` (`services/pack-removal.ts`). Without the flag,
`remove-pack` still refuses a pack anyone has worked. The flag exists for the case where the people
whose history it is have asked for the pack to go after keeping what they wanted — which is this
case. Both run through the `maintain-skills` workflow, inside the api container, reporting only until
`apply` is ticked.

## Consequences

**Good.** Skills can be as small as a word list, and the contract did not grow a new kind of thing to
allow it: two minimums were relaxed. A forked skill carries a learner's whole history with it, and
survives the programme it came from.

**The costs.** A programme's words stop being the programme's once forked: a coach republishing a
vocabulary section no longer reaches the learner's copy of it. That is the point of the fork, but it
means a correction to a word must now be made by the learner, or by the word-assist flow that
follows this. The deck block is created by the migration rather than published from the tree, because
it has no content to commit; a fresh deployment without a programme to fork from creates it the same
way, by running the migration against an empty source, or by publishing an empty block.

**What this does not decide.** How a learner fills in a new word beyond its translation — that is
the next decision, and it arrives through the coach API ([ADR-0001](0001-runtime-not-agent.md)).
