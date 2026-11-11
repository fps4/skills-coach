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

**It ships as a third image, `ghcr.io/fps4/skills-coach-worker`**, built, scanned and attested by
`publish-images` with the api and web, and deployed with them by the operations repository as one
more service of the same stack. It reaches the api over the compose network, so the queue never leaves
the host except as the word itself, sent to the Anthropic API.

**It signs in as the coach automation client**, `skills-coach-coach`. That puts the coach client
secret into a container for the first time — until now the deployment minted coach tokens on the host
and gave the secret to nothing — and the token carries the whole `coach` role, more than the
`term:suggest` the worker uses. That is accepted for now, deliberately: a narrower credential needs a
new role here and a new client in the realm's seed, and the worker shares a host with the database it
could otherwise reach anyway. A `word-assist` role and its own client is the refinement when it is
worth a realm change.

**The Anthropic key is a deployment secret like the others**: `ANTHROPIC_API_KEY` in the stack's
host-only secrets file, handed to the worker's environment by the deploy. A worker started without
it — or without the coach secret — logs which is missing and does nothing else, so the service can
be deployed before they exist. Rotating the key means recreating the container.

**What the model sees is the word, its languages and the skill's declared topics** — the queue's own
projection (ADR-0023), which names no learner. The prompt treats the word as data, never as an
instruction. The answer is clipped to the api's limits and a topic is kept only when the skill declares
it, in `worker/src/card.ts`, which is pure and is what the tests read.

**A word that fails waits before it is tried again**, a minute and then twice as long each time up to an
hour, so a word the model declines or a malformed answer neither hammers the API nor holds up the words
behind it. If the learner discards the word meanwhile, the api answers the worker with a conflict and the worker lets it go.

## Consequences

**Good.** Asking for a word now takes seconds, which is the latency ADR-0023 promised "with a worker
running". The runtime still generates nothing, CI still needs no key, and swapping the worker for a
person — or for a different model — changes nothing in the api. The api image still has no model
client and no key; only the worker image does.

**Costs.** One Opus call per requested word, at medium effort; a card is a few hundred tokens out.
Model spend is in the worker's logs (one line per word) rather than in the api. The worker holds a
broader token than it needs, and the coach secret now lives in a container (above). Words are filled one at a time; a pasted list of fifty takes a
few minutes, not seconds.

**What this does not decide.** Correction of written answers stays with a coach session: it is
judgement over a learner's own work, and ADR-0001's "when to revisit" for it has not been met.
