---
title: Architecture overview
status: current
date: 2026-08-01
---

# Architecture overview

## System context

```
        ┌──────────────┐  password grant / refresh   ┌────────────────────┐
        │   learner    │────────────────────────────▶│  identity-service  │
        │  (browser)   │◀──── RS256 access token ────│  (separate repo)   │
        └──────┬───────┘                             └─────────┬──────────┘
               │ Bearer                                        │ JWKS
               ▼                                               │
        ┌──────────────────────────────────────────────────────▼──────────┐
        │                        Skills Coach                             │
        │   ┌──────────┐        ┌──────────┐        ┌──────────────┐      │
        │   │   web    │───────▶│   api    │───────▶│   mongodb    │      │
        │   │ Next.js  │ /api/* │ Fastify  │        │              │      │
        │   └──────────┘        └────▲─────┘        └──────────────┘      │
        └────────────────────────────┼────────────────────────────────────┘
                                     │ /coach/v1 (client-credentials, role=coach)
                            ┌────────┴─────────┐
                            │  external coach  │  authors blocks, corrects submissions
                            │  (LLM CLI today) │  — never inside the runtime (ADR-0001)
                            └──────────────────┘
```

Two actors, two API surfaces, one runtime. The learner reads lessons and practises; the external
coach publishes content and returns corrections. Neither surface can do the other's job: capabilities
are disjoint.

## Containers

| Container | Runtime | Port (loopback) | Responsibility |
|---|---|---|---|
| `web` | Next.js 15 / Node 20 | 8011 | Server-rendered learner surface, `nl`/`en`. Proxies `/api/*` to `api` server-side. |
| `api` | Fastify / Node 20 | 8010 | Domain rules, persistence, both API surfaces, token verification. |
| `mongo` | MongoDB 7 | 27018 | The single store (ADR-0003). |

All three bind to loopback. On ds1 a shared reverse proxy fronts the domain and routes `/` to `web`;
it needs no `/api` rule because the Next server proxies that itself. The proxy target is baked at
build time — Next resolves rewrite destinations during `next build`, so it must be a build argument,
not only a runtime variable.

## Request paths

**Learner request.** Browser → `web` (Next server) → `api` `/api/v1/*`. The Next middleware checks
token freshness before render and redirects to `/[locale]/login` if it is stale, because pages are
server-rendered and would otherwise 401 mid-render. The signed-in layout re-reads the cookie and
redirects again if it has since gone, so the shell is never rendered around a page that cannot load.
`api` verifies the token properly against the JWKS; both checks in `web` are cheap `exp` decodes,
never a substitute for verification.

**Coach request.** External caller → `api` `/coach/v1/*` directly with a client-credentials token.
This path does not pass through `web`.

**Token verification.** `api` fetches the JWKS from identity-service and caches it. On ds1 that fetch
must resolve in-network — the public host is Cloudflare-fronted and unreachable from inside the
container — so `compose.ds1.networks.yml` joins `api` to identity-service's Docker network. Issuer
and audience remain the public claim values; the fetch URL is independent of them.

## Layers inside `api`

```
http/       routes — validate, call a service, map errors. No logic.
services/   domain rules meeting the database. Transport-agnostic.
domain/     pure functions. No I/O. The specification.
db/         collections, indexes, client.
auth/       JWKS verification, role → capability map, fastify plugin.
```

The dependency rule is one-directional and lint-enforced: `domain/` imports nothing from the other
layers. It is the part that decides whether an answer is right, whether a streak survives, and
whether an error category has become recurring — and it is testable with no database, no HTTP and no
model.

`services/` being transport-agnostic is deliberate: the planned MCP server for the coach surface
becomes a second caller of the same functions rather than a parallel implementation.

## The adaptation loop

This is the cycle the whole system exists to run:

1. A learner completes a lesson and submits written answers → `submissions` (`pending`).
2. The external coach pulls the queue, corrects, and posts categorised items.
3. **The runtime** — not the coach — applies the correction to the error log: counters move, statuses
   transition (`new` → `recurring` → `improving` → `mastered`) by rule.
4. Meanwhile every drill attempt updates streaks and stage gating, also by rule.
5. At the end of a block the coach posts a review, and fetches `GET /coach/v1/blocks/:id/brief` —
   which the runtime assembles from error-log state, ramp position and the program goal.
6. The coach authors the next block from that brief and publishes it back.

Step 3 is where the boundary earns itself: the input is a model's judgement, but everything derived
from it is deterministic, reproducible and auditable.

## Operational shape

Application logs are JSON lines on stdout, captured by the container runtime. Audit events — actor,
action, resource — go to an append-only collection with a TTL index. `GET /health` is liveness (the
process is up); `GET /ready` is readiness (MongoDB answers). The deploy pipeline polls container
health through the Docker socket rather than over the network, because the CI runner has no route to
the deployed stack.
