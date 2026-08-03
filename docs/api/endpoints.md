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
| `learner` | `lesson:read` `drill:practice` `submission:write` `progress:read` |
| `coach` | `lesson:read` `pack:publish` `submission:read-all` `correction:write` `review:write` |

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
| GET | `/progress` | `progress:read` | Overview, or one pack with `?packId` |

### `GET /drills`

`?blockId` · `?packId` · `?lessonOrder` · `?kind=term|word-order` · `?stage=1|2` · `?limit`

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

## Coach API — `/coach/v1`

The only way content and corrections enter the system
([ADR-0001](../architecture/decisions/0001-runtime-not-agent.md)).

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/packs` | `lesson:read` | Every pack |
| POST | `/packs` | `pack:publish` | Upsert a pack manifest |
| POST | `/packs/:packId/blocks` | `pack:publish` | Publish a block with lessons and drills → `201` |
| POST | `/blocks/:blockId/archive` | `pack:publish` | Archive a block |
| GET | `/blocks/:blockId` | `lesson:read` | Block with full lessons |
| GET | `/submissions` | `submission:read-all` | The work queue. `?status=pending` first-in-first-out |
| GET | `/submissions/:id` | `submission:read-all` | Submission, correction and the lesson it answers |
| POST | `/submissions/:id/correction` | `correction:write` | Post a correction → `201` |
| POST | `/blocks/:blockId/review` | `review:write` | Post a review; **closes the block** → `201` |
| GET | `/blocks/:blockId/review` | `submission:read-all` | Read a review back |
| GET | `/blocks/:blockId/brief` | `submission:read-all` | The assembled brief for the next block |
| GET | `/learners` | `submission:read-all` | Learner ids and display names. No email |

### `POST /coach/v1/packs/:packId/blocks`

Idempotent. Identifiers are derived from position and content, so republishing a block updates it in
place and a drill item whose text is unchanged **keeps its learner progress**. Vocabulary sections
also contribute `term` drills, so an author never writes a word twice.

Returns counts, including `ignoredAlternatives` — alternative word orders dropped because they were
not permutations of the same chunks. An authoring typo degrades an item to single-order rather than
failing the publish, but it is always reported.

A `focus` entry of the form `category:<id>` must name a category the pack declares, or the publish
is a `409`.

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
| `post_correction` | `correction:write` | `POST /coach/v1/submissions/:id/correction` |
| `post_block_review` | `review:write` | `POST /coach/v1/blocks/:blockId/review` |

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
