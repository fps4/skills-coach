---
title: Lezen — the reading library
surface: reading
status: built
---

# Lezen (reading library)

| | |
|---|---|
| **Surface key** | `reading` |
| **Routes** | `/{locale}/reading?packId=…` · `/{locale}/reading/{articleId}` |
| **Capability** | `lesson:read` to read · `reading:track` to mark read |
| **Appears when** | the learner has at least one article in this pack, and the pack has not opted out ([ADR-0019](../../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)) |
| **Decides** | `readingState` |

A learner's own library of long-form material, held as **parallel text** — the same piece in both
languages, the target language first, the original there when comprehension breaks down
([ADR-0017](../../architecture/decisions/0017-reading-is-personalized-parallel-text.md)).

## What it is for

A pack is a methodology; the material a learner practises on should come from their own working
world. A block is the wrong container for *volume of input* — a learner at B1.2 needs to read far
more than six lessons a month, on subjects nobody is going to hand-author. So the library carries
professional writing the learner would have been reading in English anyway, translated, with the
original one language-switch away.

## Data it needs

An article is content **owned by one learner** — the third thing in the system to be owned this way,
after a learner's own drill items and a block written for them.

```jsonc
{
  "slug": "multi-region-failover",       // stable per pack+learner; re-loading updates in place
  "labels": ["netwerken", "aws"],        // free strings, ≤ 24
  "bodies": [                            // 1–8, one per language, no two in the same language
    { "language": "nl", "title": "…", "body": "# markdown…", "summary": "…" },
    { "language": "en", "title": "…", "body": "…" }
  ],
  "source": { "url": "…", "site": "AWS Architecture Blog", "author": "…", "publishedAt": "…" },
  "estimatedMinutes": 7
}
```

Nothing is machine-translated by the runtime. Both variants are **authored**, on the far side of
`/coach/v1` — which is also what keeps this from breaking
[ADR-0005](../../architecture/decisions/0005-ui-language-vs-content-language.md).

Loading is **idempotent by slug**: a scrape can be re-run and a bad translation fixed by loading it
again, and the learner keeps their place and their read mark — because read state lives in a
separate document.

## The rules

### Language resolution — the one surface where the switch changes content

The API resolves the variant, not the surface, and resolves it **once** so the list and the article
cannot disagree. Order:

1. exact language tag
2. same base language (`nl-BE` matches `nl`)
3. the pack's `contentLanguage` — a Dutch program showing English by default would quietly stop
   being practice
4. whatever exists

`inRequestedLanguage: false` says it fell back. A list of Dutch titles that silently turns English
because one article was never translated is worse than one that says so.

The page passes the **locale from the URL** as `language`, not the stored profile — a page rendered
under `/en/…` knows better than the profile does. So the header's language switch, which rewrites
that locale segment, flips the article between its languages. Every other surface leaves material
alone, so this one says on the page what it is doing.

### The three filters

All three compose by **intersection**, and all are held in the URL rather than in component state —
that is what makes a filtered view bookmarkable and shareable-with-yourself-on-another-device.

| Filter | Quantifier | Default |
|---|---|---|
| `unread` | — | **true**: a queue, not an archive |
| `labels` | **every** label named must be carried | none |
| `sources` | **any one** of the publications named | none |

`labels` narrows and `sources` widens because an article carries several labels but has exactly one
source: asking for two sources the way `labels` asks for two labels would always yield nothing.

Unread-by-default is the rule the whole surface is built on. A library where finished articles keep
their place stops being a queue and becomes an archive, and nothing in it says what to read next.
Read articles are never removed — the filter is a view, and `unread=false` brings them all back.

An article with no `source.site` has no source facet, and drops out of any source-filtered view the
same way one missing a label does. "Unknown" is not a publication a learner would ever mean to
choose; it would collect everything hand-loaded and read as if it were one more feed.

### Facets cover the whole library

Both `labels` and `sources` facets are computed over the learner's **entire** library for the pack,
never the filtered view. A filter that hides its own way out is a trap: narrow to one label and every
other label would vanish along with the articles carrying it.

Facets are sorted by unread descending, then total, then alphabetically — the list is a place to go
next, so whatever has most waiting belongs at the top. A facet with nothing unread is kept, showing
`0`, rather than disappearing.

### Read state

Reversible, and **deliberately not automatic**. A surface that marks an article read when you scroll
to the bottom is guessing, and it guesses wrong for exactly the article you opened, skimmed and meant
to come back to. Read is a filter the learner controls, not a measurement of them.

There is no document for "not yet read" — its absence *is* unread, so putting an article back deletes
the row.

Marking read **returns to the library**: the visit is over, the queue is what you want next, and the
article has left the default view. Putting it back does **not** navigate — undoing a mark is
something you do in order to stay.

### Ordering

Newest first, by `addedAt`. A fresh load lands at the top.

## API

```http
GET  /api/v1/packs/:packId/reading?labels=a,b&sources=a,b&unread=true|false&language=nl
GET  /api/v1/reading/:articleId?language=nl
POST /api/v1/reading/:articleId/read   { read: boolean }
```

Response shape and the four contract commitments are specified in
[`docs/api/endpoints.md`](../../api/endpoints.md#get-packspackidreading).

Every route is scoped to the calling learner **by the query filter itself**. Another learner's
article is a **`404`**, not a `403`: to them it does not exist. This is personalized content, and a
route that could return someone else's by guessing an id would be the whole feature's failure mode.

The list projection reads titles and summaries but **not** the markdown — the text is most of the
document and none of it is shown on a library screen.

## The screen

**The library** — filter rows, then cards:

```
Lezen                                                    12 · 9 ongelezen
[Alleen ongelezen] │ [Alles] [netwerken 4] [aws 2]
[Alle bronnen] [AWS Architecture Blog 3] [AG Connect 2]     ← only when >1 source
┌──────────────────────────────────────────────────────────────────────┐
│ Failover over meerdere regio's                    AWS Architecture   │
│ Een samenvatting…                                 7 min · nl         │
└──────────────────────────────────────────────────────────────────────┘
```

- **Filters are links, not a client component.** Nothing here needs to happen without a round trip,
  and the API is already applying the filters — resolving them twice, once on each side, is how the
  two end up disagreeing.
- A filter link **keeps whatever the other filters are set to**. `unread=true` is the API's default
  so it is left out of the URL rather than restated.
- The source row appears **only when there is more than one source**: with everything from one
  publication the filter would be a single pill that does nothing.
- The empty state distinguishes *nothing matches this filter* from *all read* — and when unread-only
  is on, offers the way back.

**The article** — title, source line, reading time, the resolved language, a fallback notice when
`inRequestedLanguage` is false, the markdown, and the read toggle.

Reading time is `estimatedMinutes` when the loader gave one, otherwise counted **from the variant on
screen**, so a translation that runs longer than its original reports its own length.

### The markdown pipeline is the wiki's

Same `react-markdown`, same plugins (`remark-gfm`, `rehype-slug`, `rehype-highlight`), same
`wiki-prose` styling, rendered on the server so the body ships as HTML with no client JavaScript.
Two renderers for one job would mean two sets of rendering bugs.

> **`rehype-raw` must not be added to the reading route.** Wiki guides are written by us and
> committed; an article is scraped from somewhere else. `react-markdown` does not render raw HTML
> unless `rehype-raw` is added, and it refuses `javascript:` hrefs — which is precisely what makes
> the same pipeline safe to point at untrusted text. If the wiki ever needs raw HTML, the two routes
> take different plugin lists rather than the reading one inheriting it.

## Loading a library

`<slug>.<lang>.md` files in a directory, YAML frontmatter then markdown — one file per article *per
language*. An agent can write that layout, a person can proofread it, and a diff can show it, which
a single file holding both languages would not.

```
make import-reading SOURCE=./articles PACKID=… LEARNER=…
```

- Files sharing a slug are the same article; the tag after it is that variant's language.
- Article-level facts (`labels`, `source`, `estimatedMinutes`) belong to the article, not to a
  translation of it, and are taken from whichever variant declares them — first alphabetically wins,
  and a differing `source.url` is **warned** about rather than silently preferred.
- A variant with no title in frontmatter and no leading `#` heading is **dropped**, not imported
  under its filename: an untitled article is unfindable, and a wrong title is harder to notice than a
  missing file.
- A leading `#` that *is* the title is stripped from the body, because the surface renders the title
  itself.
- The importer validates with the **same schema** the API publishes through, so a file that would be
  refused on publish is refused here, where the filename is still in hand to name in the error.

## Deliberate refusals

- **No machine translation** anywhere in the runtime.
- **No inferred read state.**
- **No `rehype-raw`.**
- **Another learner's article does not exist** (`404`, never `403`).
- **Copyright is the loader's problem, not the runtime's.** Articles carry `source.url` and the
  surface shows it, but nothing here grants a right to copy anything. Material stays in one
  learner's private library, is never committed
  ([ADR-0006](../../architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md)),
  and is never republished to anyone.

## Where the code is

| | |
|---|---|
| Language resolution, filters, facets | `api/src/domain/reading.ts` |
| Library and article | `api/src/services/reading.ts` |
| Routes | `api/src/http/learner.ts` (learner) · `api/src/http/coach.ts` (loading) |
| Importer | `api/src/importer/reading-source.ts`, `import-reading.ts` |
| Screens | `web/src/app/[locale]/(app)/reading/page.tsx`, `[articleId]/page.tsx`, `web/src/components/read-toggle.tsx` |
| Strings | `web/src/i18n/dictionaries.ts` → `reading` |
