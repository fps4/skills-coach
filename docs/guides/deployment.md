---
title: Deployment
status: current
date: 2026-08-01
---

# Deployment

Skills Coach deploys to the shared `ds1` host through GitHub Actions on a self-hosted runner. A
green `dod` run on `main` triggers `deploy-ds1`.

## The pipeline

```
push to main ──▶ dod ──(success)──▶ deploy-ds1
                 │                    │
                 ├ secret-scan        ├ assemble config/ds1/.env from .env.base + secrets
                 ├ api-build          ├ compose build && up -d
                 ├ web-build          ├ poll api health via docker inspect
                 ├ test               ├ poll web health
                 ├ pack-import        └ delete the assembled .env
                 └ dependency-scan
```

Every `dod` job is blocking. `api-build` and `web-build` are not just "does it compile": the build
stage of each Dockerfile *is* the gate — typecheck, lint, and for web the tests — and the runtime
stage copies from it, so nothing that failed can be shipped.

## Runner constraints that shape everything

The `ds1` runner is itself containerized and talks to the **host** Docker socket. Two consequences
the workflows are written around:

- **No `container:` jobs and no bind-mounts.** Host paths do not translate across the socket. Every
  job works via `docker build` — the context is *streamed* to the daemon — plus sibling containers
  on a per-run network.
- **No network route to the deployed stack.** Health is read through `docker inspect`, not over
  HTTP.

The runner also predates Node 24, hence `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` pinning the
checkout action to the Node 20 it has.

## Configuration

`config/ds1/.env.base` is committed and reviewed in pull requests — non-secret values only. The
deploy assembles `config/ds1/.env` from it plus Actions secrets, and deletes that file afterwards
whatever the outcome.

**One secret is required:**

| Secret | Used for |
|---|---|
| `COACH_MONGO_PASSWORD` | The MongoDB password, and the `MONGO_URI` derived from it |

The deploy **fails** rather than falling back to the default password if it is unset.

There is no `ANTHROPIC_API_KEY` or equivalent, and there will not be: the runtime holds no model
client (ADR-0001). The coach client secret lives with whoever runs the coach loop, not on the
server — the API only ever verifies tokens.

## Networking on ds1

Everything binds to loopback. The shared reverse proxy fronts the domain and routes `/` to `web`. It
needs **no `/api` rule**: the Next server proxies `/api/*` to the api service itself, because that
is what can turn the session cookie into an `Authorization` header (see
[ADR-0002](../architecture/decisions/0002-identity-service-as-authentication-engine.md)).

`compose.ds1.networks.yml` joins the api container to identity-service's Docker network so the JWKS
fetch resolves in-network as `http://identity-service:7305/…`. The public host is Cloudflare-fronted
and unreachable from inside the container. The network name comes from `docker network ls` on ds1.

## First deploy

1. **Check for a conflicting stack.** Compose project name `skills-coach` and ports 8010/8011/27018.
   ```sh
   docker compose -p skills-coach ps
   docker ps --filter publish=8010 --filter publish=8011
   ```
   A stack under the same project name will be *replaced*, which is usually what you want — but
   confirm rather than discover it.

2. **Set `COACH_MONGO_PASSWORD`** in the repository's Actions secrets.

3. **Register the application in identity-service**: audience `skills-coach`, a role catalogue of
   `learner` and `coach`, a web client (`skills-coach-web`, password grant) and a coach client
   (client-credentials). Then assign users. This is operator configuration, not code.

4. **Verify the in-network JWKS fetch** after the first deploy:
   ```sh
   $COMPOSE exec api node -e "fetch(process.env.AUTH_JWKS_URL).then(r=>console.log(r.status))"
   ```

5. **Publish a pack.** The deployment starts empty — no content is committed
   ([ADR-0006](../architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md)).
   Point the importer at the deployed API with a coach token.

## Operating

**Logs** are JSON lines on stdout: `docker logs skills-coach-api`.

**Backups.** MongoDB is the only copy of everything — content, learner state, and history. Content
authored directly through the coach API exists nowhere else. `infra/docker/backup.sh` dumps the
`skills-coach` database to `/mnt/backup/skills-coach` on the host, keeping 30 days.

It runs from the **host crontab**, not from the pipeline — the runner is a container with only the
Docker socket and cannot write host paths, and `on: schedule` is best-effort
([ADR-0013](../architecture/decisions/0013-nightly-backups-run-from-the-host.md)). The host holds a
clone of this repository; `git -C ~/skills-coach pull` is what picks up a change to the script.

```sh
0 3 * * *  /home/<user>/skills-coach/infra/docker/backup.sh backup >> ~/coach-backup.log 2>&1
```

03:00 is deliberate: identity-service backs up at 02:30 to the same disk.

```sh
backup.sh verify                    # is last night's snapshot present, whole, and under 36h old?
backup.sh restore <snapshot.gz>     # confirms first; DROPS the collections it restores over
```

Nothing calls `verify` on a schedule yet, so a stopped backup is currently silent. The database
password never leaves the container: `mongodump` runs inside it and reads its own environment.

**Rollback** is a `workflow_dispatch` of `deploy-ds1` from an earlier commit. Data is unaffected:
there are no schema migrations, and indexes are applied idempotently at boot.

**Audit** lives in the `auditEvents` collection with a TTL index (`AUDIT_RETENTION_DAYS`, default a
year).
