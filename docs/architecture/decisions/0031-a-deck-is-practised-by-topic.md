---
title: A deck is practised by topic, and a card's topic is its group
status: accepted
date: 2026-10-17
---

# ADR-0031 — A deck is practised by topic; a card's topic is its `group`

Builds on [ADR-0027](0027-flashcards-are-one-engine-with-two-ways-of-answering.md) (what a card is,
and the `group` it carries) and [ADR-0029](0029-a-skill-is-a-folder-with-its-guides.md) (a skill is a
category, with one curated deck whose groups are concept themes).

## Context

The category skills each hold one deck of 50 to 140 cards, and every card already names its section
in `group` — "3 · Data Vault mechanics", "6 · RDF & ontologies" — shown on the front. A learner can
only ever practise the whole deck, though: there is no way to work on one theme, and no view that
says which themes are done and which are not. The Woordtrainer has the same need for words ("work",
"housing", "verbs") and today its words carry no group at all.

## Decision

1. **A card's topic is its `group`.** No new field. One topic per card, so a deck's topics partition
   it: every card is in exactly one, and the topics' counts add up to the deck's. Multi-valued tags
   were considered and left out until a deck needs a card in two places at once — they would make
   per-topic progress overlap and stop adding up.

2. **The list of topics is read off the cards.** `domain/topics.ts::deckTopics` groups a deck's cards
   by topic and summarises each with the same `DeckSummary` the deck reports, ordered by title with
   numbers compared as numbers (so "10 · …" follows "9 · …"). Cards without a topic, in a deck where
   some have one, are listed last as `_none`; a deck none of whose cards has a topic has no topics,
   not one called "none".

3. **The deck can be practised one topic at a time.** `GET /drills?topic=<group>|_none` serves only
   that topic's cards, in practice and in learn mode alike, and the `summary` beside them is the
   topic's. Every `DeckPage` also carries `topics` — the whole deck's, whichever one is chosen — so the
   surface can offer the others without a second call. A topic the deck does not have serves nothing,
   never the whole deck.

4. **The overview shows the deck by topic.** `GET /progress?packId=…` adds `decks.topics`, for the
   deck the Flashcards tab opens (the current block's) — the same list `GET /drills` returns, so a
   tile and the page it opens cannot disagree. The overview renders a tile per topic: its name opens
   practice on that topic, *Learn* opens it with the answers showing, and a bar shows how much of it is
   mastered. On the flashcards surface the topic is a select beside the mode and direction switches,
   and it lives in the address (`/flashcards?blockId=…&topic=…`), so a tile, the select and a bookmark
   are the same link.

## Consequences

**Good.** No migration and no new field: every live concept deck has topics the moment this ships,
and a learner's own card already accepts a `group`. One summary function serves the deck, a topic
and a tile, so the counts agree everywhere. The streak machine is untouched — a topic is a filter
over the deck, not a deck of its own.

**Costs.** A topic is named by the label the cards carry, so renaming a section in a republished
deck changes its address and orphans a bookmark; the surface says so rather than showing an empty
deck. The numbering authors put in labels ("3 · ") is how sections are ordered and is shown as
written. Both are what a declared list of topics in the manifest would fix, and nothing here stops
one being added on top.

**Rejected.** A per-topic deck block: blocks are a curriculum's sequence, and splitting one deck into
ten would scatter its progress and its search results across blocks for a view that is only a filter.
Chips for the topics on the flashcards surface: a deck has ten or so, and a row of them pushes the
card under the fold on a laptop — the reason the surface was compacted in the first place.
