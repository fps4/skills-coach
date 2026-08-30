---
title: Wiki — the reference library
surface: (not a pack surface — platform-wide)
status: built
---

# Wiki (reference library)

| | |
|---|---|
| **Surface key** | none — it is not declared by a pack and is not scoped to one |
| **Routes** | `/{locale}/wiki` · `/{locale}/wiki/{slug}` |
| **Capability** | none. It is prerendered static content behind the app's own session, not behind the API |
| **Appears when** | always |
| **Decides** | nothing. It writes no state of any kind |

28 impersonal upskilling guides, committed to the repository and rendered in-app
([ADR-0016](../../architecture/decisions/0016-the-reference-library-ships-with-the-code.md)).

## Why it is in the repo at all

[ADR-0006](../../architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md) keeps
content and learner data out of the tree. This is the one exception, and it is granted on three
specific grounds: the library is **impersonal** (about nobody), **public** (nothing in it is
confidential), and **revised on the same clock as the code**. None of those is true of a pack.

The corpus lives at `web/content/wiki/`, one markdown file per guide, and is *in* the tree only
because `.gitignore` un-ignores it explicitly — ADR-0006's `content/` rule matches at any depth and
would otherwise drop every guide silently. `wiki.test.ts` asserts the corpus is non-empty, so that
failure is a red build rather than an empty library in production.

## Data it needs

Frontmatter, then markdown:

```yaml
---
title: Confluent Flink SQL
summary: What you get, in one line — not a restatement of the title.
topic: streaming          # one of the eight, and exactly one
format: deep-dive         # one of the five
tags: [flink, sql, kafka] # free secondary labels
updated: 2026-07-14
---
```

The frontmatter parser is **deliberately narrow** — `key: value` and one `[a, b]` list. It is our
own contract, and a guide that needs more expressive frontmatter is a guide asking for a feature.
Anything the shape does not cover fails validation loudly rather than being quietly mis-read.

### The two label axes

**Topic** — what the guide is about. Exactly one, because it is the primary axis: a guide that could
plausibly sit in two picks the one a reader would look under first and reaches the other through
`tags`.

```
data-engineering · streaming · ml-ai · governance
architecture · integration · enterprise · app-development
```

**Format** — how deep it goes, which is the question a reader asks second. These are a promise about
depth, not a rating of the reader.

```
refresher · primer · guide · deep-dive · awareness
```

`awareness` means "enough to hold a conversation and know what you do not know". `deep-dive` means
the mechanics, with runnable examples.

**Label ids are content; their display names are chrome.** A guide's frontmatter names
`topic: streaming`, and that slug is stable and language-free. What a reader sees on the chip comes
from the dictionary — so adding a third interface language never touches a guide
([ADR-0005](../../architecture/decisions/0005-ui-language-vs-content-language.md)).

A guide declaring an id that is not in the closed set is a **build failure**, not a silently
unfiltered tile. That mirrors what `validate-manifests.ts` does for a pack.

## The rules

### Filtering

Three filters, all from the query string, all narrowing:

| Filter | Behaviour |
|---|---|
| `topic` | exact match, one value |
| `format` | exact match, one value |
| `q` | free text — **every** whitespace-separated term must match somewhere (title, summary, tags…) |

**An unrecognised topic or format narrows to nothing rather than being ignored.** A URL someone
shared should either show what they saw or show that it is empty — never silently show everything.

**A repeated parameter (`?topic=a&topic=b`) is a malformed URL, not a multi-select.** The first value
is taken.

### Chip counts are conditional

Each chip's count is computed against **everything else in the filter**, with its own axis cleared —
so with `streaming` selected, the format row shows how many *streaming* guides are refreshers. That
makes a chip reading `0` a real dead end, and it can be rendered as one.

This is the opposite choice from the [reading library](reading.md), whose facets deliberately cover
the whole library. The difference is what each list is for: reading facets are a way *out* of a
filter you are already inside, so they must not vanish; wiki chips are a way *into* a corpus you are
browsing, so they should tell you what is actually there.

### Where filtering happens

On the **server**, in the page, from the query string. `WikiFilters` is a client component that only
*writes* that query string. That split does two things: it keeps the ~800 KB corpus off the client,
and it makes every filtered view a URL someone can send to someone else.

### Build time, not request time

Both routes are **prerendered** — `generateStaticParams` enumerates every guide — so the standalone
runtime serves HTML and never opens the content directory. `web/src/lib/wiki.ts` is marked
`server-only`, which is load-bearing: importing it from a client component would ship the whole
corpus to the browser, and instead the import fails at build time.

Two things to know before changing this:

- Next's file tracer finds `content/wiki` on its own, and the guides survive into the image without
  an `outputFileTracingIncludes` entry. Both facts were verified, not assumed.
- **A route that stopped being prerendered would need the files at runtime.** If you add one that
  reads a guide dynamically, check the trace picks the directory up rather than trusting it.

## The screen

```
Wiki
[Alle onderwerpen] [streaming 6] [governance 3] …      ← topic chips, with counts
[Alle vormen] [deep-dive 4] [primer 9] …               ← format chips
[ zoeken…                                        ]
┌──────────────────┐ ┌──────────────────┐
│ Confluent Flink  │ │ DAMA-DMBOK       │
│ Wat je krijgt…   │ │ …                │
│ streaming · deep │ │ governance · ref │
└──────────────────┘ └──────────────────┘
```

A tile shows **what the guide is** (title, one-line summary) and **what kind of thing it is** (topic,
format). Everything else — how long it is, when it changed — belongs on the guide itself.

The chip rows stay **two**. `tags` are searched but never turned into chips; a third row would make
the index a filing system rather than a way in.

## The markdown pipeline

`react-markdown` with `remark-gfm`, `rehype-slug` and `rehype-highlight`, styled by `wiki-prose`,
rendered on the server. This is the same pipeline the [reading library](reading.md) uses, and the
sharing is deliberate — two renderers for one job would mean two sets of rendering bugs.

The **condition** on that sharing runs the other way: guides here are written by us and committed, so
they could safely take `rehype-raw`; a scraped article cannot. If the wiki ever needs raw HTML, the
two routes take different plugin lists rather than the reading route inheriting it.

## Deliberate refusals

- **No third chip row.**
- **No per-learner state** — no bookmarks, no read marks, no history. The wiki is a reference, not a
  queue. That is what the reading library is for.
- **No CMS.** A guide is a file, changed by a pull request, reviewed like code.
- **No expressive frontmatter.**

## Where the code is

| | |
|---|---|
| Corpus | `web/content/wiki/*.md` (28 guides) |
| Reading and parsing | `web/src/lib/wiki.ts` (`server-only`) |
| Label contract and filter | `web/src/lib/wiki-labels.ts` |
| Screens | `web/src/app/[locale]/(app)/wiki/page.tsx`, `[slug]/page.tsx` |
| Chip row | `web/src/components/wiki-filters.tsx` |
| Guard | `web/src/lib/wiki.test.ts` |
| Strings | `web/src/i18n/dictionaries.ts` → `wiki` |
