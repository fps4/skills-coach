---
title: The rail is packs, one level deep, and a pack lands on its progress
status: superseded by 0021
date: 2026-08-14
---

# ADR-0018 — The rail is packs, one level deep

> **Superseded by [ADR-0021](0021-the-menu-is-folders-of-skills.md).** The rail is now folders of
> skills, and what a pack offers moved from the rail to tabs on the skill's own page. The landing
> page, the pack landing on its overview, and the ignored `progress` key all carry over.

> The shape below stands. What decides whether an item under a pack is *there* changed the same day
> in [ADR-0019](0019-a-surface-appears-when-the-pack-has-material-for-it.md): a surface the pack has
> no material for is absent rather than disabled, so the sentence here about offered-but-empty is
> superseded by that one.

## Context

[ADR-0009](0009-per-pack-presentation-is-declarative.md) made the rail's *items* declarative: a pack
names its surfaces and the viewer resolves them through a registry. It said nothing about the rail's
*shape*, and the shape it inherited has not aged well.

It was a flat list of the platform's surfaces — your packs, the wiki, lessons, the two drills, the
quiz, progress — with the practice surfaces indented under lessons as a visual grouping. Two things
are wrong with that:

- **Nothing names the pack.** A learner working through a Dutch program and an AWS certification
  sees one "Lessen" and one "Oefentoets", and the rail never says which pack they belong to. The
  items change under them when the URL changes pack, silently.
- **Progress was an item beside the practice surfaces**, and spanned every pack at once. But it
  belongs to a pack — its decks, its error log, its next block — and the cross-pack report answered
  a question nobody was asking while the pack-shaped one had no home.

There is more coming that the flat shape cannot absorb: the wiki is on its way to becoming a pack of
its own, and choosing a *new* pack is becoming a marketplace on the landing page.

## Decision

**The rail is two levels: a pack, then what that pack offers. Nothing else nests, and a pack lands
on its own progress.**

```
Jouw pakketten            /nl                        the product's landing page
Nederlands B1             /nl/progress?packId=…      a pack the learner has started
  Lessen                  /nl/blocks/…
  Lezen                   /nl/reading?packId=…
  Woordtrainer            /nl/drills/words?blockId=…
  Zinspuzzel              /nl/drills/sentences?blockId=…
  Oefentoets              /nl/quiz?blockId=…
Wiki                      /nl/wiki                   platform furniture, for now
```

Three consequences of that sentence, spelled out:

- **The top level is the learner's *started* packs**, named as the pack names itself, from the
  progress call the shell already makes. Packs on offer but not started are the landing page's
  business — a rail that also listed them would be answering "what am I working on" and "what could
  I work on" in the same column.
- **Surfaces render only under the pack in scope.** They belong to a pack, so outside one they are
  absent rather than greyed out. The two gates of ADR-0009 are untouched: the manifest says what is
  *offered*, the live deck counts say what is *enabled*, and offered-but-empty renders disabled.
- **`progress` stops being a surface.** It is what the pack item opens, so it cannot also be an item
  beside the others. `/progress` without a `packId` has nothing to report on and redirects to the
  landing page.

## Consequences

**Good.** The rail says which pack you are in without a header having to. Progress reads as the
pack's own dashboard rather than a report card spanning unrelated programs. The shape has a slot for
what is coming: the wiki becomes a pack and joins the top level as one, and the marketplace grows on
the landing page without the rail changing at all.

**The cost.** The cross-pack progress view is gone — comparing two programs side by side now means
opening each. Nothing asked for that comparison, and the landing tiles already carry the per-pack
headline it was mostly used for.

**`progress` stays in the api's `surfaces` enum.** Packs published against ADR-0009 name it — the
demo pack does — and rejecting it would fail their next publish over chrome that moved. The viewer
ignores the key rather than refusing it, which is the same bargain ADR-0009 struck for an unknown
palette: cosmetics are not worth failing a publish over. A pack that declares only `progress` gets a
pack item with nothing under it, which is exactly what it asked for.

**A pack the learner has just opened for the first time** is not in the rail until the next render:
opening the pack page is what enrols them, and the shell fetched its list before that. It appears on
the next navigation, and the pack page itself is unaffected.

This refines [ADR-0009](0009-per-pack-presentation-is-declarative.md) rather than superseding it.
Declarative presentation, the registry, and the two gates all stand; what changed is where the items
sit and that one of them is no longer an item.
