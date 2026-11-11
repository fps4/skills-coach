---
title: A worker beside the runtime fills in the words learners ask for
status: accepted
date: 2026-11-11
---

# ADR-0034 — A worker beside the runtime fills in the words learners ask for

## Context

[ADR-0023](0023-a-coach-fills-in-a-word-the-learner-asked-for.md) made a word request a question the
runtime holds until a coach answers it, and left open who answers and where. Until now the answer was
"a person with Claude over MCP", which in practice meant a word could wait for a day: the learner
pressed *Let the coach fill it in*, the page polled every ten seconds, and nothing came, because
nothing was working the queue.

[ADR-0001](0001-runtime-not-agent.md) still holds: the runtime contains no model client. Whatever fills
the cards in has to reach the system through `/coach/v1` like any other coach.

## Decision

**A separate service, `worker/`, works the queue.** It is its own package with its own image, beside
`api/` and `web/`, and it is the only code in the repository that calls a language model. It polls
`GET /coach/v1/term-requests` every few seconds, asks Claude for each waiting word's card in a fixed
structured shape, and proposes it with `PUT /coach/v1/term-requests/:id/suggestion` — the same endpoint
`suggest_term` writes through over MCP. The learner still reviews and accepts every card; nothing the
worker writes reaches a deck on its own.

**It runs on ds1 in the same compose project**, as the `word-worker` service behind a compose profile
the deploy enables and `make up` does not. It reaches the api over the compose network, so the queue
never leaves the host except as the word itself, sent to the Anthropic API.

**It signs in as the coach automation client**, `skills-coach-coach`, whose secret the deploy already
holds (`COACH_CLIENT_SECRET`) and hands to compose through the job environment, as it does the MongoDB
password. That token carries the `coach` role, which is more than `term:suggest`. A narrower role for
the worker alone is the obvious refinement; it is not done here because it needs a new role and client
in the realm's seed (`fps4/maestro-fps4`), and the worker runs on the same host as the database whose
credentials it would otherwise be denied.

**The Anthropic key is a file on ds1, not an Actions secret.** `scripts/ds1/set-anthropic-key.sh`
writes it over SSH into a mode-600 file the container mounts read-only, and the worker re-reads it
every cycle. Putting a key in place, or rotating it, needs no redeploy; a worker without one logs that
it is waiting and does nothing else.

**What the model sees is the word, its languages and the skill's declared topics** — the queue's own
projection (ADR-0023), which names no learner. The prompt treats the word as data, never as an
instruction. The answer is clipped to the api's limits and a topic is kept only when the skill declares
it, in `worker/src/card.ts`, which is pure and is what the tests read.

**A word that fails waits before it is tried again**, a minute and then twice as long each time up to an
hour, so a word the model declines or a malformed answer neither hammers the API nor holds up the words
behind it. A learner who discards the word meanwhile gets a 409 back to the worker, which lets it go.

## Consequences

**Good.** Asking for a word now takes seconds, which is the latency ADR-0023 promised "with a worker
running". The runtime still generates nothing, CI still needs no key, and swapping the worker for a
person — or for a different model — changes nothing in the api.

**Costs.** One Opus call per requested word, at medium effort; a card is a few hundred tokens out.
Model spend is in the worker's logs (one line per word) rather than in the api. The worker holds a
broader token than it needs (above). Words are filled one at a time; a pasted list of fifty takes a
few minutes, not seconds.

**What this does not decide.** Correction of written answers stays with a coach session: it is
judgement over a learner's own work, and ADR-0001's "when to revisit" for it has not been met.
