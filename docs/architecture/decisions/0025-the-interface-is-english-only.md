---
title: The interface is English only
status: accepted
date: 2026-10-10
supersedes: 0005 (the interface-language part)
---

# ADR-0025 — The interface is English only

## Context

[ADR-0005](0005-ui-language-vs-content-language.md) shipped the interface in Dutch and English. The
language was a route segment (`/nl/…`, `/en/…`), negotiated from a cookie, the learner profile and
`Accept-Language`, switched from the header, and stored on the learner as `uiLanguage`. The reading
library then gave that switch a second job: it chose which variant of a parallel-text article was
served ([ADR-0017](0017-reading-is-personalized-parallel-text.md)).

What that bought was small. The learners this product serves are working in English and learning
something else; nobody reads the chrome in Dutch to practise Dutch — they practise on the material.
What it cost was everywhere: every route under a `[locale]` segment, every link and redirect
threading a locale through, a second dictionary to keep in step with the first, a preference on the
learner that existed only for the interface, and one surface where flipping a chrome setting
silently changed the content.

The owner has decided: **the interface is English, and every skill is in exactly one language.** The
Woordtrainer is Dutch content because practising Dutch is its purpose; an upskilling skill is English
or Dutch, never both.

## Decision

1. **There is one interface language, English.** No route segment, no negotiation, no cookie, no
   switch. URLs are `/words`, not `/nl/words`. `web/src/i18n/dictionaries.ts` holds one dictionary;
   it stays a dictionary — chrome in one reviewed place, typed — rather than being inlined.
2. **The learner has no interface-language preference.** `uiLanguage` is gone from the learner, from
   `PATCH /me`, from `GET /coach/v1/learners` and from the archive. A stored value on an older
   learner document is left where it is and never served; a client or an older archive that still
   sends one has it stripped, not refused.
3. **Old URLs redirect.** The middleware answers `/nl/…` and `/en/…` with a permanent redirect to the
   same path without the segment, so bookmarks keep working. Only those two segments are retired.
4. **An article opens in the language the skill teaches.** With no interface language to consult, a
   reading article's default variant is the pack's `contentLanguage`; its other variants are links
   (`?language=`) on the article page. ADR-0017's "the interface language selects the variant" no
   longer holds; the rest of it does.
5. **What ADR-0005 said about content stands.** Content language is still distinct from the interface
   language and still renders exactly as authored, with `lang` on the element, untranslated. A Dutch
   lesson is Dutch inside the English interface, and a term's translation is still content.

## Consequences

**Good.** One less dimension in every route, link and test. No dictionary drift. A learner record
that holds only what is about the learner. The reading library stops being the one surface where a
chrome control changes material.

**Costs.** A learner who preferred Dutch chrome loses it. Adding an interface language later means
reintroducing the machinery this removes; that is deliberate — it should come back only with a
reason, not by default. Pack-authored metadata that was still localized (`{nl, en}`) became a single
string in [ADR-0026](0026-a-skill-is-written-in-one-language.md).
