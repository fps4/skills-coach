---
title: A pack declares how it presents itself; the viewer resolves it
status: accepted
date: 2026-08-03
---

# ADR-0009 — Per-pack presentation is declarative

## Context

The landing page is a grid of tiles, one per pack, and it should stay generic — it is the product's
front door, not any pack's. Everything past it is another matter. A conversation pack wants a word
trainer and a sentence puzzle; a pack for something that is not a language will want neither, and
will want surfaces this platform has not been asked for yet.

[ADR-0004](0004-pack-contract-and-typed-sections.md) named the failure mode this invites: build for
the first vertical, meet the second, and end up with `if (pack === 'dutch')` through the runtime. Its
answer for lesson content was a closed set of typed sections rendered by kind. The same question is
now being asked one level up, about chrome rather than content.

There is also a defect that makes this concrete rather than speculative. The learner rail hardcodes
both drills. A pack whose blocks carry no word-order material still shows "Zinspuzzel", permanently
dead, because nothing in the rail knows the deck is empty.

## Decision

**A pack declares its presentation; the viewer resolves each declaration through a registry it owns.
Nothing branches on pack identity.**

`pack.yaml` gains an optional `presentation` block:

```yaml
presentation:
  palette: blue
  icon: message-circle
  tagline: { nl: …, en: … }
  surfaces: [lessons, drills:terms, drills:word-order, progress]
```

Two different bargains, deliberately:

- **`palette` and `icon` are open strings.** They are keys into registries the web app owns, and the
  api has no business enumerating a hue list it does not render — the two packages share no types and
  are versioned by the HTTP contract. An unrecognised value falls back and is reported, the way an
  unrecognised lesson heading is kept as text. Losing a tile's icon must never lose the tile.
- **`surfaces` is a closed enum**, validated at publish. A surface the runtime cannot render is
  precisely the failure ADR-0004 exists to prevent, so a typo fails loudly rather than silently
  hiding a rail item. Adding one is a platform change with a renderer behind it.

**Omitting `surfaces` means all of them.** A pack opts *out*, never in, so a pack that declares no
presentation at all renders exactly as every pack renders today.

**A rail item has two independent gates**, and they answer different questions. *Offered* is the
manifest's `surfaces` — intent. *Enabled* is the live deck count the progress payload already
carries — reality. Offered-but-empty renders disabled rather than vanishing, because a rail whose
items come and go is harder to learn than one that explains itself.

## Consequences

**Good.** ADR-0004's guarantee survives intact: adding a pack still needs no code, because resolution
is by declared key, never by `packId`. The dead-drill defect is fixed by construction rather than by a
special case. And the seam is now where it belongs — a pack that eventually needs a surface nobody has
built gets one entry in a registry and a renderer, not a fork of the shell.

**Costs.** Presentation is one more thing an author can get wrong, and two of its three keys fail
quietly by design — a mistyped palette looks like "the feature did not work". The closed `surfaces`
set is a guess informed by one pack, exactly as the nine section kinds were; widening it is cheap,
narrowing it is not. And the registry lives in the viewer, so a second viewer would have to implement
it again — acceptable while there is one.

**Explicitly not decided.** Per-pack *layout* or per-pack components. A pack chooses from what the
platform renders; it does not ship its own. If that ever changes it is a new decision, not an
extension of this one.
