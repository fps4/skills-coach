---
title: Reading material is personalized parallel text, and the interface language selects the variant
status: accepted
date: 2026-08-08
---

# ADR-0017 — Reading is personalized parallel text

## Context

A pack is a methodology. The material a learner practises on is supposed to come from their own
working world — the Dutch pack's own ramp says so in as many words ("vocabulary: abstract and
professional, plus the learner's own domain"), and the brief a coach authors against carries the
learner's domain profile for exactly that reason.

Blocks already do this, but a block is a taught unit: six lessons, written to a rung of the ramp,
correcting toward declared error categories. It is the wrong container for *volume of input*. A
learner at B1.2 needs to read far more than six lessons a month, on subjects nobody is going to
hand-author, and the single most available source of that is the professional writing they would be
reading in English anyway.

Reading it in English teaches nothing. Reading a hand-written Dutch approximation of it teaches
Dutch but loses the subject. What works is the **parallel text** — a technique older than the
product, and the standard one for exactly this problem: the same piece in both languages, the target
language first, the original there when comprehension breaks down.

That collides with [ADR-0005](0005-ui-language-vs-content-language.md), which says the interface
language governs chrome and content renders exactly as authored in every interface language. The
collision is real and this ADR is where it is resolved rather than quietly worked around.

## Decision

**A reading article is a first-class entity, owned by one learner, carrying one variant per
language.**

1. **Personalized, the way the rest of the product already is.** An article carries a `learnerId`
   and every route is scoped to the calling learner by the query filter itself — another learner's
   article is *not found*, never forbidden. That is the third thing in the system to be owned this
   way, after a learner's own drill items ([ADR-0012](0012-a-learner-may-add-to-their-own-deck.md))
   and a block written for one person ([ADR-0015](0015-a-block-may-be-owned-by-a-learner.md)), and
   it follows both deliberately rather than inventing a fourth ownership model.

2. **An article is parallel text.** It holds `bodies: [{ language, title, body, summary? }]` — one
   entry per language, markdown, authored. Nothing is machine-translated by the runtime: translation
   happens where every other kind of authoring happens, on the far side of `/coach/v1`
   ([ADR-0001](0001-runtime-not-agent.md)).

3. **The interface language selects the variant, and this is the only surface where it does.**
   Resolution order is: exact language tag, then same base language (`nl-BE` matches `nl`), then the
   pack's `contentLanguage`, then whatever exists. The response says which happened, so a fallback
   is announced rather than silently served.

4. **Read is a filter the learner sets, not a measurement of them.** It is stored in a separate
   `readingState` document, reversible, and defaults the library view to unread-only. Nothing infers
   it from scrolling.

5. **Labels are free strings the loader chooses.** The runtime groups and filters by them and never
   interprets one, the way it carries a ramp's dials without reading them.

6. **`reading` is a declared pack surface**, in the same closed set as the others
   ([ADR-0009](0009-per-pack-presentation-is-declarative.md)). A pack opts out by naming its
   surfaces; a pack that says nothing offers it.

### Why this does not break ADR-0005

ADR-0005 forbids **machine-translating pack content** and forbids **content interpolated into UI
strings**. Neither happens here. Both variants are authored, both arrive from the API untouched, and
both are marked up with the `lang` of the variant actually on screen — a Dutch article announces
itself as Dutch to a screen reader while the English original beside it announces itself as English.

What is genuinely new is that a *single article* has more than one authored language and the locale
picks between them. ADR-0005's model — one content language per pack, fixed — has no room for that,
because it was written when content had exactly one language. This narrows it rather than reverses
it:

> The interface language selects **which authored variant** of a multi-variant article is served. It
> never translates, never generates, and never applies to a lesson, a term, a drill or a question —
> all of which remain single-language and untouched.

A lesson still renders in Dutch in the English interface. That is unchanged and must stay unchanged.

## Consequences

**Good.** A learner reads volume, at level, about their own work, and can drop into the original
exactly where comprehension fails — which is the pedagogical point, and something a coach cannot
hand-author at any useful rate. Loading is idempotent by slug, so a scrape can be re-run and a bad
translation fixed by loading it again, keeping the learner's place and read mark. The whole surface
is additive: no block, drill, quiz or correction path changes.

**Costs.** One more thing the word "language" can mean in a product that already had two, so the
docs have to keep saying which. The language switch now does something different on one surface than
on every other, which is why that surface says on the page what it is doing rather than leaving a
learner to work out why the text changed.

**Copyright is the loader's problem, not the runtime's.** Articles carry `source.url` and the
surface shows it, but nothing here grants a right to copy anything. Material stays in one learner's
private library, is never committed ([ADR-0006](0006-content-and-learner-data-stay-out-of-the-repo.md)),
and is not republished to anyone. A loader putting somebody else's writing in front of a third party
is outside what this decision covers.

**The markdown pipeline is the wiki's** ([ADR-0016](0016-the-reference-library-ships-with-the-code.md)),
reused rather than rebuilt: same `react-markdown` plugins, same `wiki-prose` styling, rendered on the
server. Two renderers for one job would mean two sets of rendering bugs.

It carries one condition. Wiki guides are written by us and committed; an article is scraped from
somewhere else. `react-markdown` does not render raw HTML unless `rehype-raw` is added, and it
refuses `javascript:` hrefs — which is what makes the same pipeline safe to point at untrusted text,
and the reason **`rehype-raw` must not be added to the reading route**. If the wiki ever needs it,
the two routes take different plugin lists rather than the reading one inheriting it.
