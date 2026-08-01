---
title: Running Skills Coach locally
status: current
date: 2026-08-01
---

# Running it locally

Requires Node 20+ and Docker.

```sh
make install                 # api + web dependencies
make up                      # mongodb + api + web
make seed                    # publish the bundled demo pack
open http://localhost:8011
```

That is a working application: a pack, a block, two lessons covering every section kind, twenty
vocabulary terms and ten word-order sentences.

## What is running

| Service | Port (loopback) | Notes |
|---|---|---|
| `web` | 8011 | The learner surface. Proxies `/api/*` to the api server-side |
| `api` | 8010 | `GET /health` and `GET /ready` are unauthenticated |
| `mongo` | 27018 | Non-default port, so it cannot collide with a MongoDB you already run |

## Sign-in is skipped locally

Local runs use `AUTH_MODE=dev`, which injects a fixed stub principal holding both the `learner` and
`coach` roles — so you can drive the learner surface *and* the coach API without an identity
provider. The API refuses this combination when `COACH_ENV=production`, so it cannot reach a
deployment.

Any bearer value is accepted in dev mode, which is why the examples use `Bearer dev`.

## Hot reload

```sh
make dev     # api with tsx watch, web with next dev, against the compose MongoDB
```

## Checks

```sh
make check       # typecheck + lint + tests — the same checks CI runs
make test-unit   # domain rules only, no MongoDB needed
```

Integration tests **skip** rather than fail when MongoDB is unreachable, so `make test` works with
Docker down. CI always has MongoDB, so they always run there. Each test file gets its own database:
vitest runs files in parallel and the harness clears collections between tests, so a shared database
would have one file wiping another's fixtures.

## Loading real content

Nothing real is committed ([ADR-0006](../architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md)).
To load a pack from a local directory:

```sh
make import PACK=/path/to/your/pack
```

See [authoring a pack](authoring-a-pack.md) for the format, and [the coach loop](coach-loop.md) for
driving corrections.

## Resetting

```sh
make down    # stop, keep data
make clean   # stop, drop the MongoDB volume and build output
```

## Troubleshooting

**`api` restarts with "AUTH_MODE=dev is refused in production".** Something set
`COACH_ENV=production` locally. Note that `NODE_ENV=production` alone is fine and expected — the
runtime image always sets it, because that is what it means to Node.

**`api` restarts with an "invalid configuration" message.** It validates configuration at boot
rather than failing on the first request that needs a missing value. The message names the variable.

**`web` is healthy but every page redirects to `/nl/login`.** The session cookie is missing or
stale. In dev mode the login page has a single "continue" button that sets it.

**Port already in use.** Override in the environment: `API_PORT`, `WEB_PORT`, `MONGO_PORT`.
