---
title: A skill is written in one language
status: accepted
date: 2026-10-10
---

# ADR-0026 — A skill is written in one language

## Context

A pack's title, description, goal, tagline and error-category labels and groups — and a block's or
lesson's title — could be authored per interface language, `{ nl, en }`, and the viewer picked one
with the interface language ([ADR-0005](0005-ui-language-vs-content-language.md)). With the interface
English only ([ADR-0025](0025-the-interface-is-english-only.md)) there is nothing left to pick
between: one side of every such object was dead text that still had to be written, reviewed and kept
in step with the other.

The owner's rule goes further than the interface: **every skill is in exactly one language.** The
Woordtrainer is Dutch content because that is its purpose; an upskilling skill is English or Dutch,
never both.

## Decision

1. **Every text field a pack, block or lesson carries is one string.** `title`, `description`,
   `goal`, `presentation.tagline`, `errorCategories[].label` and `.group`, and block and lesson
   `title`. The schemas accept a string and refuse an object, with a message naming the rule —
   `{ nl, en }` is exactly what an author who has published here before will reach for. This holds on
   every way in: the manifest linter, `POST /coach/v1/packs`, `POST /coach/v1/packs/:id/blocks`, and
   the MCP tools that wrap them.
2. **Which language that string is in is the pack's to choose**, and the committed packs choose
   English for their name, description and labels, because those are read inside the English
   interface — while their material stays in `contentLanguage`. A Dutch name that is the skill's name
   (*Woordtrainer*) is fine.
3. **Stored packs are read, not migrated.** Packs, blocks and lessons published before this still
   hold `{ nl, en }` in MongoDB. `domain/pack-text.ts` reads such a value as one string at the read
   boundary (`services/content.ts`): English if present, else the pack's content language, else the
   first non-empty value. Nothing past that point sees the old shape, and nothing rewrites it in
   place; the next republish writes the new one.

## Consequences

**Good.** Half the text in every manifest disappears, and with it the drift between the halves. The
API serves strings, so no surface has to resolve anything; the web app's `pickTitle` is gone. A
legacy document can never surface as `[object Object]`, because the rule that reads it is pure and
tested.

**Costs.** A pack in the old shape no longer validates; it has to be rewritten before it can be
republished. The read-time fallback is permanent code for as long as old documents exist — cheap,
but it is there until every pack has been republished once. A reader in MongoDB itself still sees
both shapes until then.
