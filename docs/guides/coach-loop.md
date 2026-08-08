---
title: Driving Skills Coach as the external coach
status: current
date: 2026-08-01
---

# The coach loop

Skills Coach generates nothing ([ADR-0001](../architecture/decisions/0001-runtime-not-agent.md)).
Authoring lessons and correcting free-form writing happen on the other side of `/coach/v1` — today
by a person driving an LLM, later possibly by a service. This is the operating manual for that side.

The loop is four steps, and it repeats per block:

```
        ┌──────────────────────────────────────────────────┐
        │  1. pull the queue      GET  /submissions?pending │
        │  2. correct             POST /…/correction        │  ← judgement
        │  3. close the block     POST /…/review            │
        │  4. author the next     GET  /…/brief  → POST     │  ← generation
        └──────────────────────────────────────────────────┘
                    everything else is the runtime's
```

## Driving it as an agent instead

Everything below is also available as MCP tools at `/mcp`
([ADR-0010](../architecture/decisions/0010-mcp-is-a-second-transport.md)), which turns the four steps
into one conversation rather than a shuttle of pasted JSON:

```sh
claude mcp add --scope user --transport http skills-coach https://coach-mcp.fps4.nl/mcp \
  --client-id skills-coach-mcp-operator --callback-port 9415
```

Then ask for the brief, write the block, and publish it without leaving the session. The tools are
the routes below, one for one, behind the same capabilities — `get_brief`, `publish_block`,
`list_submissions`, `post_correction`, `post_block_review`.

Three things have to exist first, and none of them live in this repository:

1. a public hostname routed to the api container, and `MCP_RESOURCE_URL` set to it;
2. `skills-coach-mcp-operator` registered in identity-service as a public `authorization_code`
   client with the loopback redirect `http://localhost:9415/callback` — redirect URIs are
   exact-matched, so the port is pinned and must match `--callback-port`;
3. the **`coach` role assigned to the person signing in**. The credential is not the authority; the
   assignment is. Without it the login succeeds and every tool still refuses.

The rest of this guide is the HTTP surface, which is what the tools call and what to reach for when
there is no agent in the loop.

## Getting a token

The coach surface authenticates with a **client-credentials** token from identity-service, carrying
`aud=skills-coach` and the `coach` role:

```sh
TOKEN=$(curl -s -X POST https://auth.fps4.nl/oauth2/token \
  -H 'content-type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"skills-coach-coach","client_secret":"…","scope":["coach"]}' \
  | jq -r '.access_token // .accessToken')

API=https://coach.example.com
```

Locally, `AUTH_MODE=dev` accepts any bearer:

```sh
TOKEN=dev API=http://127.0.0.1:8010
```

The secret belongs to whoever runs the loop, never to the server — the API only ever *verifies*
tokens.

## 1. Pull the queue

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$API/coach/v1/submissions?status=pending" | jq
```

Oldest first, so nothing starves. Then fetch one with the lesson it answers, so the prompts sit
alongside the answers:

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$API/coach/v1/submissions/$SUB" | jq
```

## 2. Correct

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "items": [{
    "original": "Ik denk dat het is leuk.",
    "corrected": "Ik denk dat het leuk is.",
    "categories": ["woordvolgorde-bijzin"],
    "explanation": "The verb goes to the end in a subclause."
  }],
  "ratings": { "fluency": 4, "accuracy": 3, "courage": 5 }
}' "$API/coach/v1/submissions/$SUB/correction" | jq '.errorLog'
```

**Supply judgement, not counters.** Each item names the categories it belongs to; the runtime moves
the counts, applies the status transitions, and decides what gets re-drilled. The response shows
what moved.

Three things to get right:

- **Use the pack's declared category ids.** An invented one is rejected — it would accumulate its
  own history and never join anything.
- **One item per mistake**, not per sentence. Two mistakes in one sentence are two items, or the
  counts under-report.
- **Ratings are advisory.** They are a learning aid, never a persisted score about a person.

Correcting a submission twice is a `409`.

## 3. Close the block

When every lesson has been corrected:

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "learnerId": "…",
  "whatWentWell": "Full sentences throughout; no freezing.",
  "nextBlockBrief": {
    "redrill": ["woordvolgorde-bijzin"],
    "retire": ["perfectum-imperfectum"],
    "themeAndDifficulty": "Step up to B1.2; introduce the passive."
  }
}' "$API/coach/v1/blocks/$BLOCK/review"
```

This is what makes a mistake retire: every category that did *not* appear in the block earns a clean
block, and two clean blocks means mastered. The response lists which categories changed status.

Skipping the review means nothing ever retires — the error log grows and the re-drill list stops
being a signal. Clean blocks are derived rather than accumulated, so posting a review twice is safe.

## 4. Author the next block

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$API/coach/v1/blocks/$BLOCK/brief" | jq
```

The brief assembles the three inputs the program named for generating the next block:

| In the payload | Is |
|---|---|
| `evidence.errorLog`, `evidence.lessons` | how the learner actually did |
| `nextBlock.ramp` — level, phase, `dials` | the next rung |
| `goal` | what the whole program is for |
| `suggestions` | what the runtime believes should drive it, before your judgement |
| `evidence.review.nextBlockBrief` | what the last review asked for |

Write the block from that, then publish it:

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d @block-03.json "$API/coach/v1/packs/$PACK/blocks" | jq
```

Or author it as files and use the importer — see
[authoring a pack](authoring-a-pack.md).

Check the response: `ignoredAlternatives` counts word orders dropped for not being permutations of
the same chunks, and `drillItemsRemoved` counts drills the new version dropped, along with the
learner progress attached to them.

**Only the current block need exist.** Generating whole phases in advance locks in a difficulty
guess and ignores what actually happened — which is the thing this loop exists to avoid.

## Loading reading material

Separate from the four-step loop, and deliberately: a block is a taught unit, and volume of input is
not one. A learner reads far more than six lessons a month, on subjects nobody is going to
hand-author. That is what the reading library is for
([ADR-0017](../architecture/decisions/0017-reading-is-personalized-parallel-text.md)).

An article is **parallel text**: the same piece in the language being learned and in its original,
with the interface language switch flipping between them. So the job is scrape → convert to markdown
→ translate → load, and only the last step touches this API.

Files on disk, one per article *per language*:

```
articles/
  multi-region-failover.nl.md
  multi-region-failover.en.md
```

Each with frontmatter and then markdown:

```markdown
---
title: Failover over meerdere regio's
summary: Hoe je een uitval van een hele regio opvangt.
labels: [netwerken, aws]
source:
  url: https://aws.amazon.com/blogs/architecture/…
  site: AWS Architecture Blog
  publishedAt: 2026-07-22
estimatedMinutes: 11
---

Een organisatie die op één regio draait, …
```

Then:

```sh
cd api && npm run import:reading -- \
  --source ~/reading/aws --pack dutch-conversation-nl --learner "$LEARNER" --dry-run
```

`--dry-run` reports what it found, which single-language articles the switch will not flip, and which
carry no source url. Drop it to load. Or do the same through the `upsert_reading` MCP tool, which is
the same service function behind the same capability.

Four things to get right:

- **Name the learner.** Reading is personalized; there is no "everyone" here.
- **Keep the slug stable.** Loading a slug again replaces that article in place and keeps the
  learner's read mark and its position in the library — which is how a bad translation gets fixed.
  A new slug is a new article, arriving unread at the top.
- **Carry `source.url`.** This surface holds material the product did not write.
- **Translate, do not summarize.** A parallel text only works when the two sides say the same thing;
  a Dutch précis beside an English original teaches the learner to read the English.

## A prompt that works

When driving this with a language model, the shape that holds up:

> You are correcting written Dutch for a learner working toward B2.
> Here is the lesson they answered: `<lesson JSON>`
> Here are their answers: `<submission JSON>`
> Here are the categories this pack declares: `<ids>`
>
> Return JSON matching the correction schema. One item per mistake, not per sentence. Use only the
> category ids listed. Keep explanations to one sentence and in the learner's interface language.
> Do not invent mistakes: if a sentence is correct, leave it out.

That last instruction matters more than it looks. A model asked to correct will find something to
correct, and inflated counts distort what gets re-drilled.

## The loop for a pack that quizzes

A pack whose blocks are question banks rather than lessons runs the same loop with one step removed:
there is no correction, because the judgement was authored into each question's key
([ADR-0014](../architecture/decisions/0014-an-authored-answer-key-may-write-the-error-log.md)).

1. The learner takes a sitting. Every wrong answer records an error-log occurrence against the
   categories that question tags, with no coach involved.
2. `GET /coach/v1/blocks/:id/brief` carries the error log **and** `evidence.quiz` — per-category
   accuracy, weakest first. The error log says which categories keep costing marks; the accuracy
   says how close to right the learner is on each, which a status alone cannot.
3. Author block N+1 against `suggestions.redrill` and the weakest rows, and publish it.
4. **Post the block review.** This is the step it is tempting to skip, and skipping it means nothing
   ever retires — a category only earns a clean block when a block is closed.

Read the previous block with `get_block` before authoring: it returns the drill deck, and writing
questions without seeing the ones already written is how a bank fills up with near-duplicates.

A prompt that holds up for question authoring:

> You are writing 20 practice questions for `<pack goal>`.
> Here is the brief: `<brief JSON>`
> Here are the questions already in the bank: `<drillItems JSON>`
>
> Author from AWS documentation only — never reproduce a real exam question. At least a third must
> target the categories in `suggestions.redrill`. Tag every question with the task-statement ids it
> tests, using only ids the pack declares. Every incorrect option needs a one-line `why`. Cite at
> least one docs URL per question in `sourceRefs`. Match the `dials` for the ramp rung in the brief.

## What the coach cannot do

- Set an error-log counter, or a status
- Practise as a learner, or read a learner's drill progress
- See a learner's own words, or their quiz sittings
- Administer users or roles — that is identity-service's

These are not gaps. They are what keeps adaptation deterministic even though its input is judgement.
