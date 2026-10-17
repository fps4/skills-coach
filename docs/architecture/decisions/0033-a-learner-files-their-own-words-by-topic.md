---
title: A learner files their own words by topic; a coach sees only the declared ones
status: accepted
date: 2026-10-17
---

# ADR-0033 — A learner files their own words by topic; a coach sees only the declared topics

Builds on [ADR-0031](0031-a-deck-is-practised-by-topic.md) (a card's topic is its `group`),
[ADR-0032](0032-a-skill-declares-its-topics.md) (a skill may declare its topics),
[ADR-0012](0012-a-learner-may-add-to-their-own-deck.md) (a learner's own words) and
[ADR-0023](0023-a-coach-fills-in-a-word-the-learner-asked-for.md) (word requests).

## Context

Topics arrived for the concept decks, whose cards a coach publishes. The Woordtrainer is the other
case: every word in it is the learner's own, so nobody publishes its topics but the learner — and the
words already in it have none. A word request is the other way words arrive, and the coach filling one
in is well placed to say where it belongs. But the word-request queue was built on one rule: a coach
sees the word and its languages, never anything else from the learner's account.

## Decision

1. **A learner files their own words.** The add form takes a topic, and the list of their words lets
   each one be moved — `PATCH /api/v1/terms/:drillItemId { group }`, blank for none. Only the topic
   changes: the card keeps its id and its streak. Only the learner's own cards can be moved, as only
   they can be deleted.

2. **A learner's topics are free.** The box offers the skill's declared topics by title first, then
   the learner's own labels already in use. Typing a declared topic's title stores its id; anything
   else is stored as typed. Publishing holds a declaring skill to its list (ADR-0032); a learner's own
   deck is not held to it.

3. **A skill may declare starter topics for a deck of the learner's own.** The Woordtrainer declares
   nine — work, home, money and paperwork, health, food, getting around, people, time, linking words. A
   declared topic with no word in it has no tile; it is a suggestion, not a fence.

4. **A coach's suggestion may place the word**, in `group`. The learner sees the topic by title on
   the review card, may move it or clear it, and on a skill with declared topics may place a word the
   coach did not.

5. **The queue carries the skill's declared topics, and only those.** A coach needs to know what the
   choices are; the manifest's list is public and the same for every learner. The labels a learner
   made up are theirs and stay out of the queue, which keeps ADR-0023's line where it was: a coach sees
   the word, its languages, and what the skill itself publishes.

## Consequences

**Good.** A word deck gets topics, tiles and topic practice exactly as a concept deck does, with no
second mechanism. A coach's work places new words without seeing the learner's deck.

**Costs.** The words already in a deck are sorted by hand, one box at a time; a coach cannot sort them,
because a coach never sees them. If that is wanted it is a new request type the learner sends — the
same "learner asks, coach suggests, learner accepts" shape — not a widening of the queue. A coach
cannot suggest a learner's own label, only a declared topic or a new label of its own.

**Rejected.** Showing the coach the learner's labels in use: convenient, and exactly the account data
ADR-0023 keeps out of the queue.
