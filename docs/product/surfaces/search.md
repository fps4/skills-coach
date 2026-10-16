# Search

Find the guide section or the card that explains something, from any page
([ADR-0030](../../architecture/decisions/0030-search-is-lexical-and-held-by-the-api.md)).

| | |
|---|---|
| Surface key | none — search is chrome, on every signed-in page, not something a skill declares |
| Routes | the bar in the header; `/search?q=&kind=&skill=` for the full list |
| Capability | `lesson:read` |
| Appears | always, for a signed-in learner |
| Writes | **nothing** — no attempt, no drill state, no read state, no audit event |

## What it is for

A learner who half-remembers a term — `idempot…`, "the late-data thing in Flink" — should land on
the paragraph that explains it, not on a skill's front page. Guides are long and cards are many;
search is the shortest path from a word to where it is taught.

## Data it needs

Two kinds of document, ranked together:

```
guide section   title = the heading (or the guide's title, for its top)
                context = the guide's title
                body = the section as plain text, code kept
                → /guides/<skillId>/<slug>#<anchor>
card            title = the front (term)        body = the back (translation)
                context = its group             extra = cue, example, analogy, note, synonyms, code
                → /flashcards?blockId=<blockId>&mode=learn
```

## The rules

- **What is indexed.** Every committed guide (`skills/<id>/guides/*.md`), split at its `#`–`###`
  headings, plus one document for the guide as a whole (title, summary, the text before the first
  heading). Every `term` card in a **published** block. Sentence puzzles and multiple-choice keys are
  not indexed: they are exercises, and finding one by its answer is finding the answer.
- **Who sees what.** A guide is everyone's. A card is everyone's unless it carries a `learnerId` — a
  word the learner added (ADR-0012) or a block written for them (ADR-0015) — and then it is found by
  that learner only. There is no route by which search shows somebody else's word.
- **Anchors match the page.** A section's anchor is `github-slugger` over the visible text of every
  heading in order — what `rehype-slug` renders — so a result opens at its heading.
- **Matching.** Terms are lower-cased and accent-folded (`één` finds `een`); a short list of English
  and Dutch stop words is dropped from both the index and the query. Every term must match, the last
  one as a prefix (the learner is still typing it), each with one edit of tolerance per five letters
  from four letters up. When nothing matches every term, any term will do.
- **Ranking.** BM25 over four fields, weighted title 3, context 1.5, body 1, extra 0.75. A guide shows
  at most its **three** best sections in a result list; the rest fold away.
- **The snippet** is about 180 characters around the first matched word, cut on spaces, with an
  ellipsis where text was cut, and every matched word marked. It comes from the body when the body
  matched, else from the extra (so a card found by its analogy shows it), else the start of the body.
- **Freshness.** A write through the api is searchable as soon as it succeeds. A write made outside
  the api process (a `maintain-skills` script) is searchable after the next rebuild — every
  `SEARCH_REBUILD_MINUTES`, default 15 — or after a restart. Guides change only with a deploy.

## API

`GET /api/v1/search?q=&kind=&skill=&limit=`

```
{ query, total,
  counts: { guide, card },            # within the skill filter — for the kind tabs
  skills: [{ skillId, title, count }],# within the kind filter, most results first
  hits: [{ kind, skillId, skillTitle, title, context,
           snippet: [{ text, match? }],
           slug?, anchor?,            # guides
           blockId?, drillItemId? }]} # cards
```

`q` is trimmed and at most 200 characters (`400` beyond); an empty `q` returns an empty answer with
`200`. `limit` is at most 50, default 20. The route's request log is held at `warn` so the query —
which is in the URL — is not written; the count of results and the time taken are logged instead.

## The screen

```
┌ Skills Coach  your skill · your pace   [🔍 Search guides and cards   / ]   ◐ ☼ │ Sign out ┐
                                         ┌─────────────────────────────────┐
                                         │ GUIDES                          │
                                         │ ▤ 3b. Watermarks                │
                                         │   Confluent Flink SQL · Streaming│
                                         │   A [watermark] asserts that …  │
                                         │ CARDS                           │
                                         │ ▦ Watermark                     │
                                         │   Streaming · Event time        │
                                         │ See all results (14)            │
                                         └─────────────────────────────────┘
```

- From the second character, debounced 150 ms, the best eight results, grouped *Guides* / *Cards*
  with the group holding the best result first. A slower answer to an older query never replaces a
  newer one.
- ↑ / ↓ walk the results and *See all results*; Enter opens the chosen one, or the results page when
  none is chosen; Esc closes the popover, and a second Esc leaves the field.
- `/` (when not typing in a field) and ⌘K / Ctrl-K focus the bar from anywhere. Neither is in the
  flashcards' key map, which ignores modified keys and leaves `/` unbound.
- On a phone the bar takes the header's spare width and its results open full-width below the header.
- `/search` lists up to 50 results as cards, with *All / Guides / Cards* tabs carrying counts, and a
  row of skills when more than one skill matched. Every filter is in the URL.
- A card result opens its deck in **learn** mode, where the back is meant to be on screen.

## Deliberate refusals

- **No vector search, no embeddings, no model.** A query embedding is a model call per search, which
  ADR-0001 keeps out of the runtime; see ADR-0030 for the path if semantic search is ever wanted.
- **No second store.** The index is derived and held in memory; MongoDB stays the only copy of
  anything, learners' own words included.
- **No search history, no "recent searches", no analytics on queries.** What a learner looked for is
  theirs; nothing keeps it.
- **No practice from a result.** A result shows a card's back, which is only safe because search
  records nothing — the same exception learn mode makes (ADR-0027 §5). A streak is still only earned
  by answering a card whose back was not on screen.
- **No exercises in the index.** Sentence puzzles and quiz keys are not searchable.

## Where the code is

| | |
|---|---|
| Rules | `api/src/domain/search.ts` — `tests/unit/search.test.ts` |
| Index | `api/src/services/search.ts` — `tests/unit/search-engine.test.ts`, `tests/integration/search.test.ts` |
| Route | `GET /api/v1/search` in `api/src/http/learner.ts` |
| Bar | `web/src/components/search-bar.tsx`, `search-result.tsx`; rules in `web/src/lib/search.ts` |
| Page | `web/src/app/(app)/search/page.tsx` |
