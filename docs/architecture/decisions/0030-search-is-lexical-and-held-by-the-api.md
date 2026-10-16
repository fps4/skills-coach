---
title: Search is lexical, in-process, and derived — not a vector database
status: accepted
date: 2026-10-16
---

# ADR-0030 — Search is lexical, held in the api's memory, and rebuilt from the store

Builds on [ADR-0001](0001-runtime-not-agent.md) (no model in the runtime),
[ADR-0003](0003-mongodb-single-store.md) (one store), [ADR-0027](0027-flashcards-are-one-engine-with-two-ways-of-answering.md)
(what a card is, and when its back may be on screen) and [ADR-0029](0029-a-skill-is-a-folder-with-its-guides.md)
(guides ship with the code).

## Context

A learner wants to type a phrase into a bar at the top of every page and land on the guide section
or the card that explains it — "Google-like": forgiving of typos and half-typed words, ranked, with
a snippet showing why each result matched, fast enough to update as they type.

The material lives in two places with two lifecycles:

| Source | Where | Changes when | Who may see it |
|---|---|---|---|
| Guides | `skills/<id>/guides/*.md`, ~140 files, read off disk | a new image is deployed | every signed-in learner |
| Cards | `drillItems` in MongoDB | a coach publishes, a learner adds a word, a script migrates or removes a pack | everyone, unless `learnerId` is set — then only that learner (ADR-0012, ADR-0015) |

The corpus is small: a few MB of guide text and cards in the low thousands. It is written in two
languages (most skills English, `woordtrainer-nl` Dutch; one language per skill, ADR-0026).

The question that arrived with the request is whether this needs a vector database. It does not, and
the reasons are worth recording because the idea will come back:

1. **A query embedding is a model call on the request path.** Documents could be embedded offline by a
   coach and posted through `/coach/v1`, but the *query* only exists when the learner types it. Either
   the api calls an embedding API — a model client and an API key in `api/`, exactly the "small
   exception" ADR-0001 and `AGENTS.md` rule out — or the api runs an embedding model in-process, which
   is still a language model in the runtime and would need its own ADR amending ADR-0001.
2. **It is a second store.** MongoDB 7 Community has no `$search` or `$vectorSearch` (those are Atlas,
   or `mongot` in Community 8.2+, still preview). Qdrant, pgvector or similar would be a second
   datastore to run, back up (ADR-0013) and keep consistent — and it would hold learners' own words,
   which today exist in exactly one backed-up place.
3. **It answers a different question.** Semantic retrieval finds "things about the same idea"; what a
   learner typing `idempot` or `kafka exactly once` wants is the section with those words in it,
   tolerant of spelling. Lexical ranking with fuzzy and prefix matching does that better and
   explainably — a snippet can highlight the matched terms; a cosine score cannot say why.

### Options considered

| Option | Typos / prefix | New infra | Fits ADR-0001/0003 | Verdict |
|---|---|---|---|---|
| Vector DB + embeddings | n/a (semantic) | store + model | no | rejected — above |
| MongoDB `$text` index | no / no | none | yes | rejected — no fuzzy or prefix, one text index per collection, crude ranking, no highlighting; not "Google-like" |
| Meilisearch / Typesense sidecar | yes / yes | a service + a second copy of the data | strains 0003 | rejected for now — the best engine, but a second store with private learner data, and a sync job, for a corpus that fits in memory |
| **In-process index in the api** (MiniSearch) | yes / yes | one npm dependency | yes | **chosen** |

## Decision

### 1. The api holds a lexical index in memory, and it is derived, never authoritative

`services/search.ts` owns one [MiniSearch](https://github.com/lucaong/minisearch) index (MIT, no
dependencies; BM25+ ranking, fuzzy and prefix matching, per-field boosts, a filter callback, and
`autoSuggest`). Nothing about it is persisted: it can be thrown away and rebuilt from MongoDB and the
guide files at any moment, and every mechanism below relies on that.

The api owns search — not the web — because only the api can apply card visibility, and because one
index gives one ranking across guides and cards; two indexes merged in the browser would compare
scores that are not comparable. The api image therefore copies `skills/` the way the web image
already does (`SKILLS_DIR`).

### 2. What is indexed

A **search document** is one of:

- **A guide section** — each guide is split at its `##`/`###` headings, so a result lands on the
  section, not the top of a 40-screen page. Fields: guide title, section heading, section text
  (markdown stripped, code fences kept as text). The anchor is computed with `github-slugger`, the
  same algorithm `rehype-slug` uses on the guide page, so `/guides/<skill>/<slug>#<anchor>` resolves.
- **A card** — a `term` drill item from a published block of a published skill, or a learner's own.
  Fields: front (`term`), back (`translation`), `hint`, `group`, `example`, `analogy`. Other drill
  kinds (sentence puzzles, MCQ keys) are not indexed: they are exercises, not reference.

Boosts, highest first: section heading / card front, guide title / `group`, body / back, the rest.
Each document carries `skillId`, `kind`, and `learnerId` when it has one.

Shaping a guide or a card into search documents, the visibility predicate, the boost table and the
snippet/highlight rule are **pure** and live in `domain/search.ts`, tests first. The MiniSearch
instance, the reads and the timers are `services/search.ts`.

Text is lower-cased and diacritics are folded (`é` → `e`, so a Dutch word matches typed without its
accent). There is no stemming in the first version: fuzzy and prefix matching cover most of what
stemming would, and a per-language stemmer can be added through MiniSearch's `processTerm` later
without changing anything else.

### 3. How the index stays current — "reindex on a schedule"

Three mechanisms, each covering what the previous one cannot:

| When | What | Covers |
|---|---|---|
| **At boot** | full build, before the api starts listening | guides (they only change with the image, so a deploy *is* the guide reindex) and the first load of cards |
| **On write, in-process** | the service that changed a block's cards calls `ctx.search.blockChanged(blockId)` after the write succeeds, which re-reads that block — publish and republish, archive, an own word added or removed (an accepted term request is one), an archive import; `upsertPack` calls `skillsChanged` for the title | everything a request changes; the result is searchable immediately |
| **Every 15 min** (`SEARCH_REBUILD_MINUTES`) | full rebuild into a fresh index, swapped in atomically when complete | writes made outside the server process — the `maintain-skills` scripts (`migrate-to-skills`, `remove-pack`) run as separate processes in the container and their hooks fire in *that* process — and any write path that forgot its hook |

The schedule is an **in-process timer**, not a GitHub `on: schedule` workflow and not a host cron
entry. ADR-0013 explains why the pipeline is the wrong scheduler (best-effort, and silently
disabled), and a host cron could only restart the process; the index lives in the process, so the
process is what rebuilds it. A rebuild that fails keeps the previous index and logs an error; it
never leaves search empty.

Change streams, which would make the third row unnecessary, need a replica set, which ADR-0003
declined. A rebuild of a corpus this size is expected to take well under a second; the spike that
precedes implementation measures it, and the interval is set from that measurement.

### 4. Visibility is applied at query time, inside the api

`GET /api/v1/search?q=&limit=&skill=` (capability `lesson:read`) returns a mixed, ranked list of
`{ kind: 'guide' | 'card', skillId, title, snippet, href }`, with matched terms marked in the
snippet. The query is filtered with the pure visibility predicate: a guide is visible to everyone; a
card is visible when it has no `learnerId` or its `learnerId` is the caller's. Archived blocks and
unpublished skills are never in the index, so they need no filter.

A coach-side search (an MCP tool to find existing cards before authoring a duplicate) is a natural
second caller, but is out of scope: it would need the coach's view of learner-owned words decided
first (ADR-0023 keeps that view anonymous).

### 5. A card result shows its back, under the learn-mode exception

A search result for a card shows the front and a snippet that may come from the back. This is the
same exception ADR-0027 §5 makes for learn mode, and for the same reason it is safe: **search records
nothing** — no attempt, no drill state, no read state — so the guarantee that a streak can only be
earned by answering a card whose back was not on screen still holds. Search is a reference surface,
not a practice surface. A card result links to the skill's flashcards in learn mode.

The query text is not written to `auditEvents` and not logged at `info`; stdout gets the count of
results and the latency. What a learner searched for is personal, and there is no product use for
keeping it.

### 6. The search bar

- **In the header**, between the tagline and the toggles (`components/app-header.tsx`), as a client
  component `components/search-bar.tsx` calling `lib/api-client.ts`. It takes the width the header
  has spare; on a phone that is narrow, so its results open full-width below the header.
- **As you type**: debounced (~150 ms), from the second character, the top eight results in a
  popover grouped *Guides* / *Cards*, each with its skill and snippet. ↑/↓ move, Enter opens, Esc
  closes. A card result opens its deck at `/flashcards?blockId=…&mode=learn`.
- **Enter with nothing selected** goes to `/search?q=…`, a server-rendered page with the full list,
  filterable by skill and by kind — the shareable, back-button-friendly form.
- **`/` and ⌘K / Ctrl-K focus the bar.** Neither collides with the flashcards key map (ADR-0027 §6):
  `/` is not bound there, and that listener already ignores modified keys and anything typed into an
  editable field, which the search input is.

## Consequences

**Good.** No new service, no second store, no model, no API key; CI tests search against the same
MongoDB it already runs. Typo- and prefix-tolerant results with highlighted snippets and deep links
into guide sections. Learner-owned words stay in the one backed-up store. The ranking rules are pure
functions with tests that read as the rules.

**Costs.**

- *Memory and boot time.* The index lives in the api process — a few tens of MB at most at this size,
  rebuilt at boot. Fine at hundreds of guides and tens of thousands of cards; not at millions.
- *One instance is assumed.* With several api replicas, each holds its own index; an in-process
  update reaches only the replica that took the write, and the others catch up within the rebuild
  interval. Today there is one api container.
- *Bounded staleness for out-of-band writes* — up to one rebuild interval after a `maintain-skills`
  script. A script could also end by calling a rebuild endpoint; not built until it is missed.
- *The guide parser exists twice.* The api needs `skills/<id>/guides/*.md` parsed the way
  `web/src/lib/guides.ts` parses it, and there is no shared package (CODEBASE.md: no workspace). The
  frontmatter contract is two keys; a test in the api holds its parser to the same committed files.
- *No semantic matching.* "How do I stop duplicate messages" will not find a section that only says
  "idempotent consumer". Synonyms in a card's `hint` or a guide's summary are the cheap mitigation.

**When to revisit.**

- *Semantic search becomes a requirement.* The shape that respects ADR-0001 is: a coach computes
  document embeddings outside the runtime and posts them through `/coach/v1`; the open question is the
  query embedding, which needs either an in-process embedding model or a model call per keystroke.
  That is an amendment to ADR-0001, decided on its own, and it would add a vector score beside the
  lexical one (hybrid ranking) rather than replace it.
- *The corpus or the replica count outgrows memory.* Then a Meilisearch sidecar, fed by the same
  pure shaping functions in `domain/search.ts` and the same three triggers — the documents and the
  rules do not change, only where the index is held.
- *MongoDB Community's `$search` reaches GA* and the deploy moves to it. Then the index could be a
  MongoDB search index on a `searchDocuments` collection, kept current by the same write hooks, with
  no rebuild timer.
