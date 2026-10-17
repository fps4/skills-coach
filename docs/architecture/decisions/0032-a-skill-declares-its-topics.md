---
title: A skill declares its topics, and a topic links the guides it is practised from
status: accepted
date: 2026-10-17
---

# ADR-0032 — A skill declares its topics; a topic links its guides

Builds on [ADR-0031](0031-a-deck-is-practised-by-topic.md) (a card's topic is its `group`, and the
list of topics is read off the cards) and [ADR-0029](0029-a-skill-is-a-folder-with-its-guides.md)
(guides ship beside the manifest).

## Context

ADR-0031 made topics out of the labels cards already carried, and named their two costs: a topic is
addressed by its label, so renaming a section moves its address and orphans a bookmark; and the
order is the numbering authors put into the labels ("3 · …"), shown as written. A third gap is the
point of the feature: the tiles say nothing about what a topic covers, and nothing connects a topic
to the guide its cards were written from — reading and practising sit on separate tabs.

## Decision

1. **A manifest may declare its deck's topics** under `flashcards.topics`, in the order the skill is
   learned. Each has an `id` (lowercase, digits, hyphens — what the cards carry in `group` and what a
   link names), a `title`, an optional one-line `description`, and optional `guides`: slugs of the
   guide files beside the manifest that the topic is practised from. Ids are unique; `validate:manifests`
   refuses a `guides` slug that names no file, because the api never sees the guides and would publish
   a link to a 404.

2. **Declared topics lead**, in manifest order, with their title, description and guides. Labels the
   manifest does not declare still form topics after them, titled by themselves, and the cards without
   a topic come last — so a learner's own label (the Woordtrainer's, next) and a deck published before
   its skill declared topics keep working. A declared topic no card is in yet has no tile.

3. **Publishing holds a declaring skill to its list.** A published card whose `group` is not a
   declared id is refused with a `409` naming the declared ids — the same rule as an undeclared error
   category, and for the same reason: a typo would quietly become a topic of its own. A skill that
   declares none keeps free labels. A learner's own card is not held to the list: it is theirs.

4. **A topic is shown by its title everywhere.** The card's front, a search result's context and the
   tile all read the declared title for an id; the id appears only in addresses.

5. **Reading and practising link both ways.** A topic's tile on the overview carries its description
   and links each of its guides. The foot of a guide links the topics practised from it, with their
   progress — so a learner reads a section, practises its topic, and goes back to the guide when a
   card trips them up.

6. **Decks labelled before their skill declared topics move once**, by `retopic:cards` (the
   `maintain-skills` workflow, `services/retopic.ts`): each card's label is matched to a declared
   topic by id, or by title with or without its section number, ignoring case, and rewritten to the
   id. Only `payload.group` changes; a card's id is keyed on its front, so every streak stays. A label
   that matches nothing is reported and left alone. It is a migration, not authoring, so it is not
   on the coach API — and it is not a rule the runtime applies on read: once a deck is moved, an id is
   the only thing a card's topic is compared with.

## Consequences

**Good.** Renaming a topic is a manifest change: its id, its address and its cards stay put. The
order is the skill's, stated once. A coach authoring a block reads the declared list in the brief
and cannot invent a near-duplicate. Guides and practice finally point at each other.

**Costs.** The live decks need one migration per skill, after their manifests are published. A
topic's guides are declared by hand — the cards' `details.source` already names the guide, and the
initial lists were derived from it, but nothing keeps the two in step afterwards. A search result's
topic title can lag a manifest change until the index's timed rebuild.

**Rejected.** Matching a card to a declared topic by title on every read: it would make the
migration unnecessary, and make every comparison fuzzy forever. Deriving guide links from
`details.source` at read time: the api would have to parse a free-text field to produce a link, and
the guides it would match against are files the api does not otherwise read.
