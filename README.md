# Skills Coach

A personalizable, pack-driven training platform. You define a **training pack** — lessons, drills,
and the rules for what counts as progress — and Skills Coach runs the learner through it, records
what happened, and keeps a durable model of what that learner keeps getting wrong.

The first pack is a Dutch conversation program (B1 → B2, aimed at working and interviewing in
Dutch). Nothing in the runtime is specific to Dutch, or to language learning.

## The boundary: a runtime, not an agent

Skills Coach **does not generate or correct anything itself.** It ships no model client.

| Skills Coach owns | An external coach owns |
|---|---|
| Storing packs, lessons and drill decks | Authoring lessons and drills |
| Grading drills (deterministic, rule-based) | Correcting free-form written answers |
| Spaced-repetition gating and streaks | Judging fluency, accuracy, register |
| Error-log counters and status transitions | Categorising a mistake |
| Progression, and assembling the next-block brief | Writing the next block from that brief |

The external coach talks to a versioned **coach API** (`/coach/v1`). Today that caller is a person
driving an LLM CLI; later the runtime may call a model API itself. The contract does not change —
which is the whole point of drawing the line here. See
[ADR-0001](docs/architecture/decisions/0001-runtime-not-agent.md).

## Architecture

```
browser ──▶ web (Next.js, :8011)
              │  server-side /api/* rewrite
              ▼
            api (Fastify, :8010) ──▶ mongodb (:27018)
              │
              ├── verifies RS256 tokens against identity-service JWKS
              └── /coach/v1  ◀── external coach (client-credentials token, role=coach)
```

Authentication is delegated entirely to [identity-service](https://github.com/fps4/identity-service):
it asserts who you are and your roles *in this application*; Skills Coach maps those roles to its own
capabilities and enforces them. Skills Coach stores no credentials and no user table —
[ADR-0002](docs/architecture/decisions/0002-identity-service-as-authentication-engine.md).

All state lives in one MongoDB database, application logs are JSON lines on stdout, and audit events
are an append-only collection with a TTL index —
[ADR-0003](docs/architecture/decisions/0003-mongodb-single-store.md).

## Quick start

```sh
make install     # install api + web dependencies
make up          # mongodb + api + web via docker compose
make seed        # publish the bundled demo pack and enrol the dev learner
open http://localhost:8011
```

Local development runs `AUTH_MODE=dev`, which uses a stub principal — no identity-service needed.
`make dev` runs api and web with hot reload against the compose MongoDB.

```sh
make test        # unit + integration tests (integration needs mongodb up)
make lint        # eslint + prettier check
make typecheck   # tsc --noEmit for api and web
```

`make help` lists every target.

## Repository layout

| Path | What |
|---|---|
| `api/` | Fastify runtime — domain rules, persistence, learner + coach APIs, pack importer |
| `web/` | Next.js learner surface, UI in Dutch and English |
| `packs/demo-conversation-nl/` | A small synthetic pack so the app runs out of the box |
| `infra/docker/` | Compose stack and images for local, CI and ds1 |
| `config/ds1/` | Non-secret deploy configuration (secrets are injected at deploy time) |
| `docs/` | Product intent, architecture, decisions, API reference, guides |

Real training content is **not** committed. It is imported into MongoDB from a local directory —
see [authoring a pack](docs/guides/authoring-a-pack.md) and
[ADR-0006](docs/architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md).

## Where to go next

- [`CODEBASE.md`](CODEBASE.md) — orientation map, read this first
- [`GLOSSARY.md`](GLOSSARY.md) — what a pack, block, lesson, drill and error category mean here
- [`docs/guides/coach-loop.md`](docs/guides/coach-loop.md) — how to drive Skills Coach as the external coach
- [`docs/api/endpoints.md`](docs/api/endpoints.md) — the full API reference
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how changes get made and what the DoD gate checks

## Licence

MIT — see [`LICENSE`](LICENSE).
