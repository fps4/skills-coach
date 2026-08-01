---
title: UI language and content language are separate and never conflated
status: accepted
date: 2026-08-01
---

# ADR-0005 — UI language is not content language

## Context

Skills Coach ships its interface in Dutch and English from day one. It also serves packs whose
material is in a particular language — the first pack is entirely in Dutch.

These look like the same concern and are not. A learner working through a Dutch pack may well want
the interface in English, because the interface is scaffolding: navigation, buttons, progress labels,
error messages. Translating a Dutch lesson's text into English would destroy the product. Translating
the word "Progress" would not.

Conflating them is the standard i18n mistake in a language-learning product, and it is invisible in
testing until you have a pack whose content language differs from the interface language.

## Decision

Two independent settings:

- **UI language** — a learner preference, `nl` or `en`, held on the learner profile and reflected in
  the URL (`/nl/...`, `/en/...`). It governs chrome only: navigation, labels, buttons, empty states,
  validation messages, dates and numbers.
- **Content language** — declared by the pack in `contentLanguage`. Content always renders exactly as
  authored, in every interface language, and is marked up with `lang` so screen readers and
  spellcheckers behave.

The rules that follow:

1. **No pack content is ever machine-translated or interpolated into a UI string.** Any string in
   `web/src/i18n/` is chrome. Content comes from the API and passes through untouched.
2. **A term's translation is content, not UI.** `{term: "wennen aan", translation: "to get used to"}`
   is authored data. The Dutch pack happens to translate into English; a different pack might
   translate into Dutch. The runtime has no opinion.
3. **Drill prompts render in whichever direction the stage says**, independent of UI language. A
   learner with an English interface still gets Dutch prompts in stage 1.
4. **Locale negotiation** is cookie → learner profile → `Accept-Language` → `nl`. The cookie wins so
   an explicit switch is sticky.

## Consequences

**Good.** Adding a third interface language is a dictionary file and touches nothing about content. A
pack in any language works in any interface language on the day it is imported. The distinction is
enforced by where strings live — chrome in `i18n/`, content from the API — so it is visible in review
rather than depending on discipline.

**Costs.** Two concepts where product conversations will keep saying "language", so the docs and code
have to keep saying which one. Some genuinely mixed surfaces need care: a progress page showing
error categories renders pack-authored category labels (content) inside translated column headings
(chrome), and getting that wrong looks like a bug in both directions.

Pack-authored labels are also not translatable by us. A pack that declares its error categories in
Dutch shows Dutch category names to an English interface. That is correct — they are the pack's
stable vocabulary and the join key for its adaptation machinery — but it will look like a missing
translation, so packs may optionally supply per-category display names.
