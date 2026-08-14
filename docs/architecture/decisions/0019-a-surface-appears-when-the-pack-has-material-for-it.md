---
title: A surface appears when the pack has material for it
status: accepted
date: 2026-08-14
---

# ADR-0019 — A surface appears when the pack has material for it

## Context

[ADR-0009](0009-per-pack-presentation-is-declarative.md) gave a rail item two gates: *offered*, from
the manifest's `surfaces`, and *enabled*, from the live deck counts. Offered-but-empty rendered
disabled rather than vanishing, on the reasoning that a rail whose items come and go is harder to
learn than one that explains itself.

That reasoning holds for something temporarily empty. It does not hold for something a pack will
never have. "Omitting `surfaces` means all of them" is the right default for an author — a pack opts
out, never in — but it means a Dutch conversation program that has never had a question renders a
permanently greyed "Oefentoets", and a certification pack that omits the key renders a word trainer
it has no vocabulary for. The item is not explaining itself; it is a dead item asking to be
explained. The manifest can silence it, but only if the author remembers to, which makes correctness
a matter of every pack repeating what the platform could see for itself.

The counts needed to see it are already in hand. `packProgress` summarises decks with
`{ packId, kind }` and the library with `counts(packId)` — **pack-wide and learner-scoped, never
per-block**. The shell was reading those numbers as "is there something to practise today" when they
already answered the more useful question: does this pack do this at all.

## Decision

**Three questions, asked in `web/src/lib/pack-scope.ts` and nowhere else.**

| Question | Source | Decides |
|---|---|---|
| Does the manifest **offer** it? | `presentation.surfaces`, or all of them | the item exists |
| Does the pack **have** any? | pack-wide material counts | the item exists |
| Can it be opened **now**? | the learner's current block | link, or greyed out |

The first two are conjunctive and decide *presence*: an item the pack has no material for is absent,
not disabled. The third keeps ADR-0009's affordance for what it was actually good at — there is
material, there is simply nothing to open at this moment.

Each surface answers the first two as data, in the same registry entry that already carries its icon,
label and destination:

```ts
quiz: {
  icon: ListChecks,
  labelKey: 'quiz',
  has: ({ quiz }) => quiz > 0,                                     // does this pack do this?
  href: ({ locale, currentBlockId }) => currentBlockId ? … : null, // where does it open now?
}
```

**Presence is a property of the pack, not of where the learner is standing in it.** This is why the
counts must stay pack-wide: gating presence on the current block would make items appear and vanish
as someone moves from block to block, which is the failure ADR-0009 named. A block that has not been
seeded yet greys its drill out; it does not remove it.

## Consequences

**Good.** A pack shows what it is, without its author having to declare what it is not. The rail is
correct for packs that predate the `surfaces` key entirely, and for the case an author forgot. And
the extension point is now one shape: a new surface is one registry entry answering two questions,
plus a count in the material payload if it needs a new one — no new endpoint, since the shell reads
the progress call it was already making, and no branch anywhere on which pack it is.

**The cost.** A surface can now disappear: empty a learner's reading library and "Lezen" goes rather
than greys. That is the honest render — there is nothing to read — but it is movement in a rail that
ADR-0009 wanted still. Movement tracks material appearing and disappearing, which is rare and always
someone's deliberate act.

**A manifest's `surfaces` is now purely an opt-out.** It can hide a surface the pack has material
for; it can no longer conjure one it does not. That is the correct direction for a declaration whose
job is intent, and it means a stale manifest degrades to "shows what it has" rather than to a rail
full of dead items.

**Not decided here.** Whether a pack may declare a surface the platform gates on something other
than a count — a date, an entitlement, a coach's approval. When that arrives it is another predicate
in the same registry entry, which is exactly the shape this ADR is choosing.

This refines [ADR-0009](0009-per-pack-presentation-is-declarative.md)'s second gate and leaves
[ADR-0018](0018-the-rail-is-packs-one-level-deep.md)'s shape untouched.
