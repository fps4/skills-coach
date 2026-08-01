---
title: Skills enter through a pack contract; lessons are ordered typed sections
status: accepted
date: 2026-08-01
---

# ADR-0004 — The pack contract and typed lesson sections

## Context

The platform is meant to train many skills; the first is Dutch conversation. The failure mode to
avoid is obvious and common: build for the first vertical, discover the second needs something
slightly different, and end up with `if (pack === 'dutch')` scattered through the runtime.

Looking at the source program, a lesson is not free-form prose. It is a repeated, recognisable
structure — a text to read aloud, a vocabulary table, comprehension questions, a speaking task, a
writing task, sometimes grammar rules, a listening task, a dictation, or an exercise with answers
printed at the bottom. Different lessons pick different subsets in different orders, but the *kinds*
are a small closed set.

The parts that vary by skill are also identifiable: what language the content is in, what competency
framework it ladders against, what labels its mistakes get, and how its source files map onto
sections.

## Decision

**A lesson is an ordered array of typed sections.** Nine kinds today:

| Kind | Carries | Produces |
|---|---|---|
| `text` | prose to read aloud | — |
| `rules` | an explanation | — |
| `vocabulary` | terms inline in the lesson | also feeds the drill deck |
| `questions` | comprehension prompts | part of a submission |
| `speak` | a spoken task and its requirements | a self-reported note |
| `write` | a written task and its requirements | **a submission** |
| `listening` | a task plus suggested sources | — |
| `dictation` | sentences to transcribe | part of a submission |
| `exercise` | items with answers revealed on request | self-checked |

The set is closed in the runtime and validated by zod. Adding a kind is a deliberate platform change
with a renderer, not something a pack can do on its own — which is what keeps the viewer able to
render *any* pack.

**Everything skill-specific arrives in `pack.yaml`:**

- `contentLanguage` — what the material is written in
- `framework` — the competency ladder (`cefr` with its levels, for the Dutch pack) and the ramp
- `errorCategories` — the pack's stable label vocabulary for mistakes
- `sectionMap` — how source headings map to section kinds, so the importer is not hardcoded to Dutch
- `goal` — the program's objective, which flows into every next-block brief

**Drill items live in a deck, not in lesson prose.** A vocabulary table appears in a lesson *and* as
`term` items tagged with that lesson, because the two are read very differently: prose is read once,
drill items are scheduled independently and forever.

## Consequences

**Good.** The runtime never branches on pack identity. A second pack — another language, or something
that is not a language at all — needs content and a manifest, not runtime changes. The viewer renders
by section kind, so a new pack's lessons display correctly the day they are imported. Error
categories being pack-declared is what lets the same counter and status machinery serve any skill.

**Costs.** Nine kinds is a guess informed by one program. Some will prove wrong: `dictation` may turn
out to be a variant of `write`, and a pack will eventually want something none of these express. The
mitigation is that adding a kind is cheap (a schema entry and a renderer) while *removing* one is not
— so we should be reluctant to add speculatively.

There is also a real constraint on authoring: a pack cannot invent a section kind, so a pack author
who needs one is blocked on a platform change. That is the intended trade — it is the price of the
viewer working for every pack — but it means the section vocabulary needs to stay responsive to what
packs actually ask for.
