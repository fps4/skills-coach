---
title: API reference
status: current
date: 2026-08-01
---

# API reference

Two surfaces, deliberately disjoint. A learner works through material; a coach authors it and
corrects it. Neither can do the other's job — see [ADR-0002](../architecture/decisions/0002-identity-service-as-authentication-engine.md).

Every request carries `Authorization: Bearer <token>` issued by identity-service. Errors are always
`{ "error": { "code", "message", "details"? } }` with one of: `unauthenticated` (401), `forbidden`
(403), `not_found` (404), `invalid_request` (400), `conflict` (409), `internal` (500).

## Capabilities

| Role | Capabilities |
|---|---|
| `learner` | `lesson:read` `drill:practice` `drill:curate` `reading:track` `submission:write` `progress:read` `progress:restore` |
| `coach` | `lesson:read` `pack:publish` `submission:read-all` `correction:write` `review:write` `term:suggest` |

An unrecognised role grants nothing and is logged. An absent `roles` claim is treated as `learner`.

## Ops

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness — the process is up |
| GET | `/ready` | none | Readiness — MongoDB answers. `503` when it does not |
| GET | `/.well-known/oauth-protected-resource` | none | Protected-resource metadata (RFC 9728) — which authorization server guards this API. Served only when `MCP_RESOURCE_URL` is set; also at `…/mcp`, the resource-path form the RFC specifies |

Discovery is unauthenticated by necessity: a client cannot present a token it has no way to obtain.
The exemption is an exact-match path list (`http/ops.ts` plus the well-known paths), never a prefix.

`AUTH_AUDIENCE` is comma-separated, and `MCP_RESOURCE_URL` is appended to it automatically — one
service can be more than one OAuth *resource*, and a token bound to the MCP endpoint (RFC 8707)
carries that URL as its `aud` rather than the application's.

## Learner API — `/api/v1`

Every route is scoped to the calling learner. No route takes a learner id, so one learner cannot
reach another's work.

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/me` | `progress:read` | Profile and enrollments. Creates the profile on first call |
| PATCH | `/me` | `progress:read` | `{ uiLanguage?, displayName? }` |
| GET | `/me/menu` | `progress:read` | Your folders and which skills show — every started skill placed exactly once |
| PUT | `/me/menu` | `progress:read` | Replace the menu wholesale. Reconciled with what you have started, never refused for it |
| GET | `/packs` | `lesson:read` | Every published pack |
| GET | `/packs/:packId` | `lesson:read` | Pack and its blocks. **Enrols the learner** |
| GET | `/packs/:packId/blocks` | `lesson:read` | Published blocks only |
| GET | `/blocks/:blockId` | `lesson:read` | Block, lesson index, progress, deck summaries |
| GET | `/lessons/:lessonId` | `lesson:read` | Full lesson with typed sections, plus own submissions |
| POST | `/lessons/:lessonId/submissions` | `submission:write` | Submit written answers → `201` |
| GET | `/submissions` | `submission:write` | Own submissions. `?lessonId`, `?blockId`, `?status` |
| GET | `/submissions/:id` | `submission:write` | The session log. `403` for another learner's |
| GET | `/drills` | `drill:practice` | Due items as **prompts**. Requires `blockId` or `packId` |
| POST | `/drills/:drillItemId/attempts` | `drill:practice` | Grade an attempt |
| POST | `/drills/reset` | `drill:practice` | Clear progress for a scope. Refuses an unscoped reset |
| POST | `/quiz/sessions` | `drill:practice` | Start a sitting → `201` |
| GET | `/quiz/sessions` | `drill:practice` | Own sittings, newest first. `?packId`, `?blockId`, `?limit` |
| GET | `/quiz/sessions/:id` | `drill:practice` | Results and full review. `403` for another learner's |
| POST | `/quiz/sessions/:id/answers` | `drill:practice` | Answer one question |
| POST | `/quiz/sessions/:id/finish` | `drill:practice` | Close the sitting. Idempotent |
| POST | `/blocks/:blockId/terms` | `drill:curate` | Add a word of your own to this block's deck → `201` |
| GET | `/blocks/:blockId/terms` | `drill:curate` | The words you added to this block |
| DELETE | `/terms/:drillItemId` | `drill:curate` | Remove one of your words, and its progress → `204` |
| POST | `/blocks/:blockId/term-requests` | `drill:curate` | `{ terms }` — ask a coach to fill words in → `201` |
| GET | `/blocks/:blockId/term-requests` | `drill:curate` | Your requests for this deck: open ones, and what was resolved in the last week |
| POST | `/term-requests/:requestId/accept` | `drill:curate` | Add the suggestion, with your edits, to the deck |
| POST | `/term-requests/:requestId/retry` | `drill:curate` | Send it back to the coach, dropping the suggestion |
| DELETE | `/term-requests/:requestId` | `drill:curate` | Throw it away. It can be asked for again |
| GET | `/packs/:packId/reading` | `lesson:read` | Your reading library for this pack. `?labels`, `?sources`, `?unread`, `?language` |
| GET | `/reading/:articleId` | `lesson:read` | One article, in the resolved language. `?language` |
| POST | `/reading/:articleId/read` | `reading:track` | `{ read: boolean }` — mark read, or put it back |
| GET | `/progress` | `progress:read` | Overview, or one pack with `?packId` |
| GET | `/archive` | `progress:read` | Everything about you, as a JSON attachment |
| POST | `/archive/import` | `progress:restore` | Put an archive back. `?dryRun=true` reports and writes nothing |

### `GET /me/menu` and `PUT /me/menu`

```jsonc
{
  "folders": [{ "folderId": "nl", "name": "Nederlands" }],
  "placements": [
    { "packId": "woordtrainer-nl", "folderId": "nl", "hidden": false },
    { "packId": "some-other-skill", "folderId": null, "hidden": true }
  ]
}
```

The learner's own arrangement of their skills ([ADR-0021](../architecture/decisions/0021-the-menu-is-folders-of-skills.md)).
Order is array order — of folders, and of skills within a folder. `folderId` is chosen by the client
and must be 1–40 letters, digits, `-` or `_`; a malformed one is a `400`.

Both directions run through the same reconciliation, so the response is always complete: every skill
the learner has started appears exactly once, one never placed is appended loose and shown, a
placement for a skill they have not started is dropped, and one naming a missing folder moves out of
it. A `PUT` is therefore never refused for naming the wrong skills — it is corrected, and the
corrected menu is what comes back. Private to the learner; not on the coach surface. Travels in the
archive under `learner.menu`.

### `GET /drills`

`?blockId` · `?packId` · `?lessonOrder` · `?kind=term|word-order|mcq` · `?stage=1|2` · `?limit`

Returns `{ items: DueItem[], summary: DeckSummary }`, ordered least-practised first.

**A prompt never contains its answer.** The trainers this replaces had to ship the answer to the
page in order to check it; here grading is server-side, so the answer arrives only after the learner
commits. An integration test asserts this.

```jsonc
{
  "items": [{
    "drillItemId": "pack.b1.d.00250fd6b17e",
    "stage": 1,
    "prompt": { "kind": "term", "stage": 1, "prompt": "nadat", "hint": "Nadat ik had gegeten, …" },
    "progress": { "stage": 1, "streak": 0, "stage1Cleared": false, "mastered": false, "attempts": 0 }
  }],
  "summary": { "total": 20, "stage1Cleared": 3, "stage2Unlocked": 2, "mastered": 1, "inProgress": 19 }
}
```

A `word-order` prompt carries `bank` (chunks, deterministically shuffled), `leadCue` (which chunk
must lead, when the item drills two orders) and `tip`.

An `mcq` prompt carries `options` (deterministically shuffled, and **carrying no marker of which are
correct**), `choose` (how many to select) and `multiple`. It has one stage — a question has no
reverse direction.

### `POST /drills/:drillItemId/attempts`

```jsonc
{ "stage": 1, "given": "lead time", "override": false }
// word-order: "given": ["ik", "begin", "morgen", "met de cursus"]
```

`override: true` records that the learner rejected the grading and asserted they were right. It
counts as correct and is stored as an override — tolerant matching can never be complete, and hiding
the disagreement would be worse than recording it.

Returns the verdict, the expected answer, `acceptedAlso` (every form that would have been taken),
`marks` (per-chunk verdict), `otherValidOrder`, `alternative`, `tip`, and the new `progress`.

`otherValidOrder: true` with `correct: false` means the learner built the *other* correct order —
good material, wrong round. Requesting stage 2 before stage 1 is cleared is a `400`.

### `GET /archive` and `POST /archive/import`

The learner's portable archive ([ADR-0020](../architecture/decisions/0020-a-learner-can-take-their-progress-with-them.md)).
`GET` returns the whole file as `attachment; filename="skills-coach-YYYY-MM-DD.json"`.

```jsonc
{
  "kind": "skills-coach.learner-archive",
  "version": 1,
  "exportedAt": "2026-08-31T09:12:04.318Z",
  "packs": [{ "packId": "aws-sap-c02", "version": 7 }],
  "learner": { "uiLanguage": "nl", "profile": { "domain": "integration architecture" } },
  "drillState": [{
    "item": { "pack": "aws-sap-c02", "block": 1, "owned": false,
              "kind": "term", "digest": "00250fd6b17e", "own": false },
    "progress": { "stage": 2, "streak": 1, "stage1Cleared": true, "stage2Cleared": false,
                  "mastered": false, "attempts": 6, "correct": 4 },
    "updatedAt": "2026-08-30T20:11:00.000Z"
  }],
  "ownTerms": [], "attempts": [], "submissions": [], "corrections": [],
  "errorLog": [], "blockReviews": [], "quizSessions": [], "articles": []
}
```

**References, not identifiers.** Several ids embed a hash of the `learnerId`, which is a
`randomUUID()` per identity subject — so the file carries what an id is made of and the import
re-derives it under whoever is importing. That is what makes a move to another deployment work.
A drill item's **content digest** travels; its text never does, so a learner's file holds no pack
material.

`POST /archive/import` returns a report rather than the data:

```jsonc
{
  "dryRun": true,
  "archive": { "version": 1, "exportedAt": "2026-08-31T09:12:04.318Z" },
  "packs": [{ "packId": "aws-sap-c02", "archived": 7, "live": 9 }],
  "sections": { "drillState": { "applied": 44, "unchanged": 0, "unresolved": 3 }, "…": "…" },
  "examples": [{ "section": "drillState", "ref": "aws-sap-c02/p1/pab12cd34ef56",
                 "why": "no such drill item on this system" }]
}
```

**Merge never demotes**: the further-along side wins, taken whole, and counters are maxed rather than
summed. There is no replace mode. A reference to material this system does not have is reported as
unresolved and skipped, never invented.

`400` for a file that is not an archive, a `version` this build cannot read, or a malformed row —
and in every case **nothing is applied**, because nobody can tell which half of a half-applied
archive landed. `403` for a coach token: this is a learner surface.

### `POST /quiz/sessions`

```jsonc
{ "blockId": "aws-sap-c02.b1", "mode": "practice", "size": 20, "limitSeconds": 2880 }
```

Assembles a sitting from the block's `mcq` items, weighted by what the learner keeps getting wrong:
questions testing a `recurring` category first, then least-practised, then id. Mastered items are
excluded. The order is **fixed at start**, so reloading resumes the same sitting rather than
assembling a fresh one from evidence that has since moved.

`mode` is the learner's choice, not the pack's. `practice` returns a verdict with each answer;
`exam` returns `result: null` until the sitting is finished. `limitSeconds` is advisory — the clock
runs out and says so, and nothing is voided.

`404` when the block has no questions; `400` when every question in it is mastered.

### `POST /quiz/sessions/:id/answers`

```jsonc
{ "drillItemId": "aws-sap-c02.b1.d.4f1c9a02", "chosen": ["b", "d"] }
```

Graded by the same path as any other drill attempt, so the sitting moves the same drill state and —
on a miss — writes the same error-log occurrence a coach's correction would
([ADR-0014](../architecture/decisions/0014-an-authored-answer-key-may-write-the-error-log.md)).

Scoring is **set equality**: for a multiple-response question every correct option must be selected
and no incorrect one. No partial credit, and no `override` — tolerant matching exists because free
text cannot be enumerated, and a list can be. An empty `chosen` is a deliberate skip and is graded
wrong, as the exam does.

Returns `{ session, result }`, where `result` is `null` in exam mode and otherwise carries `correct`,
`expected`, `correctRefs`, `explanation`, `distractors` and `sourceRefs`. Answering the same question
twice, or one not in this sitting, is a `400`.

### `POST /quiz/sessions/:id/finish`

Returns `{ session, score, byCategory, complete, review }`. `score` and `byCategory` are computed on
read and never stored. `review` is every question asked with its key and explanation — in exam mode
this is the first point at which any of it is revealed.

Idempotent: finishing twice keeps the first `finishedAt`.

### `POST /blocks/:blockId/terms`

```jsonc
{ "term": "de begroting", "translation": "the budget", "example": "De begroting klopt." }
```

A word the learner adds themselves ([ADR-0012](../architecture/decisions/0012-a-learner-may-add-to-their-own-deck.md)).
It becomes an ordinary `term` item in that block's deck — same prompting, same tolerant matching,
same streak machine — owned by the learner who added it.

**Idempotent by content**, as publishing is: adding a word already there returns the same
`drillItemId` and updates its translation, so a correction does not cost the streak. Private —
another learner cannot list it, practise it or delete it even knowing its id, and it does not appear
on the coach surface. **A republish of the block never deletes it**; the publish sweep only removes
what the pack itself no longer defines.

### Word requests — `/blocks/:blockId/term-requests` and `/coach/v1/term-requests`

A learner names words; a coach fills them in; the learner decides
([ADR-0023](../architecture/decisions/0023-a-coach-fills-in-a-word-the-learner-asked-for.md)).

```jsonc
// POST /api/v1/blocks/woordtrainer-nl.b1/term-requests
{ "terms": ["verdwijnen", "ondanks"] }        // trimmed, deduplicated case-insensitively, at most 50

// GET /coach/v1/term-requests — what a coach sees. No learner, no deck.
{ "requests": [{ "requestId": "…", "term": "verdwijnen", "contentLanguage": "nl",
                 "translationLanguage": "en", "status": "requested", "requestedAt": "…" }] }

// PUT /coach/v1/term-requests/:requestId/suggestion
{
  "translation": "to disappear, to vanish",
  "example": "De kat verdween achter het huis.",
  "details": {
    "partOfSpeech": "verb — strong",
    "forms": [{ "label": "past", "value": "verdween, verdwenen" }, { "label": "perfect", "value": "is verdwenen" }],
    "exampleTranslation": "The cat disappeared behind the house.",
    "synonyms": ["wegraken"], "antonyms": ["verschijnen"],
    "note": "Perfect tense takes zijn."
  }
}

// POST /api/v1/term-requests/:requestId/accept — edits win field by field; `omit` leaves fields off
{ "translation": "to disappear", "omit": ["antonyms"] }
```

`requested → suggested → added`, or `discarded`; `retry` sends a suggested or discarded request back
to `requested`. Accepting what was never suggested, or touching an added one, is a `409`. Asking for a
word already waiting returns the existing request. Another learner's request is a `404`.

The accepted card becomes an ordinary own word — the same as `POST /blocks/:blockId/terms`, which
also takes `details` now. Details are shown after an answer (`example` and `details` on a term's
attempt result) and never graded.

### `GET /packs/:packId/reading`

`?labels=a,b` · `?sources=a,b` · `?unread=true|false` · `?language=nl`

The learner's own library ([ADR-0017](../architecture/decisions/0017-reading-is-personalized-parallel-text.md)).

```jsonc
{
  "articles": [{
    "articleId": "dutch-conversation-nl.r8f14e45f.multi-region-failover",
    "slug": "multi-region-failover",
    "labels": ["netwerken", "aws"],
    "source": { "url": "https://aws.amazon.com/blogs/…", "site": "AWS Architecture Blog" },
    "addedAt": "2026-08-08T09:00:00.000Z",
    "readAt": null,
    "language": "nl",
    "title": "Failover over meerdere regio's",
    "inRequestedLanguage": true,
    "languages": ["nl", "en"]
  }],
  "labels": [{ "label": "netwerken", "total": 6, "unread": 4 }],
  "sources": [{ "site": "AWS Architecture Blog", "total": 5, "unread": 3 }],
  "counts": { "total": 12, "unread": 9 }
}
```

Four things this contract commits to:

- **Unread by default.** `unread=false` brings read articles back; nothing is ever deleted by being
  read. `POST /reading/:articleId/read` with `{ "read": false }` puts one back.
- **`labels` narrows** — an article must carry *every* label named. The facets describe the whole
  library rather than the filtered view, so a filter always shows its own way out.
- **`sources` matches any** — an article must come from *one of* the publications named. The
  opposite quantifier to `labels`, because an article carries several labels but has only one
  source: asking for two sources the way `labels` asks for two labels would always return nothing.
  An article with no `source.site` has no facet and drops out of any source-filtered view. All
  three filters compose by intersection, and the `sources` facets cover the whole library for the
  same reason the label ones do.
- **The api resolves the language, not the surface.** `language` (defaulting to the learner's
  `uiLanguage`) picks the variant: exact tag, then same base language, then the pack's
  `contentLanguage`, then whatever exists. `inRequestedLanguage: false` says it fell back, so the
  surface can tell the learner instead of silently changing language on them.

`GET /reading/:articleId` returns the same shape plus `body` — the markdown of the resolved variant.
Another learner's article is a `404`, not a `403`: to them it does not exist.

## Coach API — `/coach/v1`

The only way content and corrections enter the system
([ADR-0001](../architecture/decisions/0001-runtime-not-agent.md)).

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/packs` | `lesson:read` | Every pack |
| POST | `/packs` | `pack:publish` | Upsert a pack manifest |
| POST | `/packs/:packId/blocks` | `pack:publish` | Publish a block with lessons and drills → `201` |
| POST | `/blocks/:blockId/archive` | `pack:publish` | Archive a block |
| POST | `/packs/:packId/reading` | `pack:publish` | Load articles into one learner's library → `201` |
| GET | `/packs/:packId/reading` | `submission:read-all` | What a learner has been given. `?learnerId` required |
| DELETE | `/reading/:articleId` | `pack:publish` | Remove an article and its read mark. `?learnerId` → `204` |
| GET | `/blocks/:blockId` | `lesson:read` | Block with full lessons and its drill deck |
| GET | `/submissions` | `submission:read-all` | The work queue. `?status=pending` first-in-first-out |
| GET | `/submissions/:id` | `submission:read-all` | Submission, correction and the lesson it answers |
| POST | `/submissions/:id/correction` | `correction:write` | Post a correction → `201` |
| POST | `/blocks/:blockId/review` | `review:write` | Post a review; **closes the block** → `201` |
| GET | `/blocks/:blockId/review` | `submission:read-all` | Read a review back |
| GET | `/blocks/:blockId/brief` | `submission:read-all` | The assembled brief for the next block |
| GET | `/learners` | `submission:read-all` | Learner ids and display names. No email |
| GET | `/term-requests` | `term:suggest` | Words waiting to be filled in, oldest first. `?status=requested\|suggested`, `?limit`. No learner |
| PUT | `/term-requests/:requestId/suggestion` | `term:suggest` | Propose the card for one word |

### `POST /coach/v1/packs/:packId/blocks`

Idempotent. Identifiers are derived from position and content, so republishing a block updates it in
place and a drill item whose text is unchanged **keeps its learner progress**.

`lessons` may be empty: a block can be only a deck, the place a word skill's words live
([ADR-0022](../architecture/decisions/0022-a-skill-can-be-only-a-deck-or-a-library.md)). Likewise a
manifest (`POST /coach/v1/packs`) may omit `errorCategories` — a skill with nothing to correct. Vocabulary sections
also contribute `term` drills, so an author never writes a word twice.

An `mcq` drill item carries its own answer key:

```jsonc
{
  "payload": {
    "kind": "mcq",
    "stem": "A company runs a regulated workload in two Regions and must meet an RPO of five minutes…",
    "options": [
      { "ref": "a", "text": "Amazon S3 Cross-Region Replication" },
      { "ref": "b", "text": "Amazon Aurora global database" }
    ],
    "correct": ["b"],                       // more than one ⇒ multiple response, all-or-nothing
    "explanation": "An Aurora global database replicates with sub-second typical lag.",
    "distractors": [{ "ref": "a", "why": "S3 CRR replicates objects, not the transactional store." }],
    "categories": ["d1-3-reliable-resilient"],   // pack-declared ids — the join key
    "sourceRefs": ["https://docs.aws.amazon.com/…"]
  }
}
```

Two ways this fails the publish, both deliberately loud rather than degrading:

- `correct` naming an option the question does not define, or every option being correct → `400`.
  Unlike a malformed word-order alternative, a broken key would silently mark every learner wrong
  forever.
- `categories` naming an id the pack does not declare → `409`, with the declared list in the
  message. Same rule as a correction's categories, and for the same reason: an invented one would
  accumulate its own history and never join anything.

Returns counts, including `ignoredAlternatives` — alternative word orders dropped because they were
not permutations of the same chunks. An authoring typo degrades an item to single-order rather than
failing the publish, but it is always reported.

A `focus` entry of the form `category:<id>` must name a category the pack declares, or the publish
is a `409`.

### `POST /coach/v1/packs/:packId/reading`

```jsonc
{
  "learnerId": "…",
  "articles": [{
    "slug": "multi-region-failover",
    "labels": ["netwerken", "aws"],
    "bodies": [
      { "language": "nl", "title": "Failover over meerdere regio's", "body": "# …markdown…", "summary": "…" },
      { "language": "en", "title": "Multi-region failover", "body": "# …markdown…" }
    ],
    "source": { "url": "https://aws.amazon.com/blogs/…", "site": "AWS Architecture Blog", "publishedAt": "2026-07-22" },
    "estimatedMinutes": 11
  }]
}
```

Returns `{ added, updated, articleIds }` — not the articles, which the caller just sent.

**The learner is named once, for the batch.** Reading is personalized, and an owner field per
article is one typo away from filing somebody else's reading in a learner's library.

**Idempotent by slug**, as publishing a block is idempotent by position: re-loading a slug replaces
that article in place and leaves the learner's read mark and its position in the library alone. That
is how a bad translation gets corrected — load it again, rather than delete and re-add.

Two variants in the same language is a `400`: resolution is by language, so the second could never
be reached and would silently vanish. A pack that does not exist is a `404`.

`source.url` is not decoration. This surface carries material the product did not write, and where a
piece came from travels with it and is shown next to it.

### `POST /coach/v1/submissions/:id/correction`

```jsonc
{
  "items": [{
    "original": "Ik denk dat het is leuk.",
    "corrected": "Ik denk dat het leuk is.",
    "categories": ["woordvolgorde-bijzin"],
    "explanation": "The verb goes last in a subclause."
  }],
  "ratings": { "fluency": 4, "accuracy": 3, "courage": 5 }
}
```

**The caller supplies judgement; the runtime does the arithmetic.** Categories are reported as
occurrences and the service layer moves the counters, applies the status transitions, and decides
what gets re-drilled. A coach cannot write a counter.

Categories are validated against the pack's declared vocabulary — an invented one is a `400`,
because it would accumulate its own history and never join anything. Correcting a submission twice
is a `409`. Ratings are advisory and never a persisted consequential score.

### `GET /coach/v1/blocks/:blockId/brief`

The hinge of the design. Assembles the three inputs for authoring the next block:

1. **Evidence** — per-lesson category tallies and ratings, the error log, and the re-drill / retire lists
2. **The ramp** — the next block's level, phase and authoring dials
3. **The goal** — the pack's stated objective

Plus `pack.method`, the pack's declared teaching method — lesson arc, authoring rules and per-topic
sequencing — carried verbatim beside the dials, since the ramp says how hard the next block should be
and the method says how it should be built. Absent when the pack declares none.

Plus `suggestions`: what the runtime believes should drive the next block, before an author's
judgement, and `fromReview` — whatever the last review asked for.

`?learnerId` picks the learner. It can be omitted when exactly one learner has work in the pack;
with more than one it is a `400` listing them, because guessing would produce a brief about the
wrong person. "Work" includes a backfilled error log, not only an enrollment.

A brief is **about a person** — it carries their error log and their lesson record — so it needs
`submission:read-all`, the capability that means "may see work that is not yours". `lesson:read`
would not do: that means "may read published content", and every learner holds it.

### `POST /coach/v1/blocks/:blockId/review`

Body is `{ learnerId, whatWentWell?, topErrors?, wordsToRevise?, skillRatings?, nextBlockBrief }`.

Posting a review **closes the block** on the error log: every category that did not appear in it
earns a clean block, which is what eventually retires a mistake. Clean blocks are derived rather
than accumulated, so posting a review twice is harmless.

## The same surface over MCP

`POST /mcp` is the coach API again, as tools ([ADR-0010](../architecture/decisions/0010-mcp-is-a-second-transport.md)).
Streamable HTTP, JSON responses, no session. Mounted only when `MCP_RESOURCE_URL` is set.

| Tool | Capability | Same as |
|---|---|---|
| `list_packs` | `lesson:read` | `GET /coach/v1/packs` |
| `get_block` | `lesson:read` | `GET /coach/v1/blocks/:blockId` |
| `get_brief` | `submission:read-all` | `GET /coach/v1/blocks/:blockId/brief` |
| `get_block_review` | `submission:read-all` | `GET /coach/v1/blocks/:blockId/review` |
| `list_learners` | `submission:read-all` | `GET /coach/v1/learners` |
| `list_submissions` | `submission:read-all` | `GET /coach/v1/submissions` |
| `get_submission` | `submission:read-all` | `GET /coach/v1/submissions/:id` |
| `upsert_pack` | `pack:publish` | `POST /coach/v1/packs` |
| `publish_block` | `pack:publish` | `POST /coach/v1/packs/:packId/blocks` |
| `archive_block` | `pack:publish` | `POST /coach/v1/blocks/:blockId/archive` |
| `list_reading` | `submission:read-all` | `GET /coach/v1/packs/:packId/reading` |
| `upsert_reading` | `pack:publish` | `POST /coach/v1/packs/:packId/reading` |
| `remove_reading` | `pack:publish` | `DELETE /coach/v1/reading/:articleId` |
| `post_correction` | `correction:write` | `POST /coach/v1/submissions/:id/correction` |
| `post_block_review` | `review:write` | `POST /coach/v1/blocks/:blockId/review` |
| `list_term_requests` | `term:suggest` | `GET /coach/v1/term-requests` |
| `suggest_term` | `term:suggest` | `PUT /coach/v1/term-requests/:requestId/suggestion` |

Two gates. The endpoint refuses a token holding no coach capability at all, and each tool then checks
its own — `tools/list` shows only what the caller could actually run. There are no learner tools: a
coach credential cannot practise, and a second transport must not become the way around that.

**What comes back as what.** No token or a bad one is an HTTP `401` carrying
`WWW-Authenticate: Bearer resource_metadata=…`, because that is what starts a client's OAuth flow. A
missing capability, invalid arguments or a domain refusal come back as a tool result with
`isError: true` — a model can read those and act on them.

`GET` and `DELETE` on `/mcp` are `405`: nothing streams, and there is no session to end.

## What is deliberately absent

- No endpoint that generates or corrects anything. See ADR-0001.
- No endpoint that sets an error-log counter directly. Counters are derived from corrections; the
  one exception is the backfill CLI, which is a migration tool and says so.
- No user administration. That is identity-service's, and building it here would duplicate the same
  admin surface over the same data.
