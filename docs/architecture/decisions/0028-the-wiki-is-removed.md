---
title: The wiki is removed
status: accepted
date: 2026-10-10
---

# ADR-0028 — The wiki is removed; reference guides become flashcard decks

Supersedes [ADR-0016](0016-the-reference-library-ships-with-the-code.md).

## Context

ADR-0016 committed a library of impersonal reference guides to the repository and rendered them at
`/wiki`, as the one exception to ADR-0006. Reading a guide again turned out not to be how anyone
learns from it. The guides now feed flashcard decks
([ADR-0027](0027-flashcards-are-one-engine-with-two-ways-of-answering.md)): a coach writes cards from
a guide, and the learner practises them.

## Decision

The wiki is gone from the product and from the tree: its routes, filters, corpus loader, label
taxonomy, tests, strings, and the `web/content/wiki/` directory with its `.gitignore` exception.
ADR-0006 applies with no exception again — no content of any kind is committed.

The markdown pipeline the wiki shared with reading stays, owned by reading; its prose class is renamed
`article-prose`.

## Consequences

- A guide reaches a learner only as a deck: content, in the database, published through `/coach/v1`.
- The employer/person guard that protected the committed corpus is removed with it. Nothing in the
  tree needs it, because nothing in the tree is content.
- Bringing a browsable library back would be a new decision, not a revert of this one.
