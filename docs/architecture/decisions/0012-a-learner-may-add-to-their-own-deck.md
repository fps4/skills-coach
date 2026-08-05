---
title: A learner may add to their own deck
status: accepted
date: 2026-08-05
---

# ADR-0012 — A learner may add to their own deck

## Context

Until now every drill item arrived through a publish ([ADR-0001](0001-runtime-not-agent.md)): content
enters the system one way, and the pack is the curriculum
([ADR-0004](0004-pack-contract-and-typed-sections.md)). That is still the right rule for the
*programme*. But not everything worth learning arrives with a programme — a word off a form, out of a
meeting, or from a book is exactly the kind of thing a learner wants in the trainer, and telling them
to route it through a coach publish to get it there is absurd.

The obvious implementation is also the broken one. `publishBlock` upserts what the payload defines
and then **deletes what it does not**, along with the learner progress attached to it — that sweep is
what makes republishing idempotent and safe. A learner's word stored as an ordinary drill item would
be, by construction, something the pack does not define. The next republish would silently delete it.

## Decision

**A drill item may carry a `learnerId`.** Absent, the pack owns it and every learner working the
block gets it. Present, one learner added it and only they ever see it. Everything downstream —
prompting, tolerant matching, the stage/streak/mastery machine, the deck meters — is the same code
for both, because a learner's word is not a second kind of content. It is the same shape, filled from
somewhere else.

Four rules make that safe:

1. **The publish sweep is scoped to pack content.** It matches `learnerId: { $exists: false }`, so a
   republish removes what the pack dropped and cannot reach what a learner added. An integration test
   pins this, including that the progress survives.
2. **Reads must ask for an owner.** `listDrillItems` returns pack items plus *this* learner's;
   omitting `learnerId` yields pack content only. The safe thing is the default, so a coach-side
   caller that forgets cannot leak one learner's words into another's deck — or onto the coach
   surface.
3. **Ids are namespaced by owner, and deterministic.** `drillIdFor` hashes the owner into the id, so
   two learners adding the same word get their own item, and one learner adding it twice gets the one
   they already have. The owner is hashed rather than embedded: the id travels in URLs and does not
   need to name anybody.
4. **Ownership is checked on the way in, not just on the way out.** Practising or deleting another
   learner's word by guessing its id is a `404` — the item's existence is not the caller's business.

**Curating is its own capability.** `drill:curate` is granted to `learner` and not to `coach`. It is
separate from `drill:practice` because it writes content, and a capability that permits writing
should not be implied by one that permits practising.

**Words attach to the block being practised**, not to the pack. That is the deck the learner is
adding to and the surface they will return to, and it keeps the deck meters honestly counting one
deck.

## Consequences

**Good.** The trainer stops being read-only for the learner without the pack contract weakening: a
pack is still exactly what a publish defines, and a learner's own words are visibly not part of it.
Nothing on the coach surface, in the MCP tools, or in a next-block brief sees them.

**Costs.** `drillItems` now holds two kinds of ownership in one collection, and every new query
against it has to decide which it wants. The default (pack only) is the safe one, but this is the
thing to watch in review.

A learner's words are **not** part of the pack, so they do not travel: reimporting the pack elsewhere
does not bring them, and there is no export yet. Deck totals now differ between two learners working
the same block, which is correct but worth remembering when reading a summary.

Learner-authored content is learner data, so [ADR-0006](0006-content-and-learner-data-stay-out-of-the-repo.md)
applies to it in full — it never enters this repository, including as a test fixture.
