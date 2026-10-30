---
title: Deployment
status: current
date: 2026-10-30
---

# Deployment

This repository builds and publishes Skills Coach's images. It does not deploy them. A green `dod`
on `main` triggers `publish-images`, which pushes both images to GHCR. A private operations
repository deploys them by digest to the self-hosted Docker host. This repository is public, so
nothing in it runs on that host, and it holds no deploy credential
([fps4/maestro ADR-0017](https://github.com/fps4/maestro/blob/main/docs/decisions/0017-the-tenant-repository-runs-the-pipeline.md)).

## The pipeline

```
push to main ──▶ dod ──(success)──▶ publish-images ──▶ ghcr.io/fps4/skills-coach-{api,web}
                 │                    │                    :<sha>, then :main
                 ├ secret-scan        ├ build each image
                 ├ api-build          ├ scan it (a fixable critical blocks)
                 ├ web-build          ├ CycloneDX SBOM
                 ├ test               ├ push :<sha>, attest provenance + SBOM
                 ├ pack-import        └ move :main once both are published
                 └ dependency-scan
                                      ▼
                    operations repository: resolve :main → digest, verify provenance,
                    deploy by digest, check the public URLs
```

Every `dod` job is blocking, and every job runs on GitHub-hosted runners. `api-build` and
`web-build` check more than that the code compiles: the build stage of each Dockerfile *is* the
gate (typecheck, lint, and for web the tests), and the runtime stage copies from it, so nothing that
failed can be shipped.

## Published images

| Image | Tags |
|---|---|
| `ghcr.io/fps4/skills-coach-api` | `:<commit sha>`, `:main` |
| `ghcr.io/fps4/skills-coach-web` | `:<commit sha>`, `:main` |

Each image is scanned before the push, carries a CycloneDX SBOM, and has build provenance attested
against its digest. `:main` moves only after both images of a commit are published, so it never
pairs an api and a web from different commits. To check one:

```sh
gh attestation verify oci://ghcr.io/fps4/skills-coach-api:main --repo fps4/skills-coach
```

The deploy accepts an image only with provenance from this repository's `publish-images` on `main`,
built on a GitHub-hosted runner.

## Configuration

**Build time.** The web image's browser-facing values are build arguments from
`infra/docker/web.production.env`. Next inlines them into the bundle, so they are public by
construction.

**Run time.** Runtime configuration lives with the deployment, not here: the non-secret values in
the operations repository, and the secrets in a file on the host only. The api needs
`MONGO_PASSWORD`, and the deploy fails rather than falling back to the default if it is unset.

There is no `ANTHROPIC_API_KEY` or equivalent, and there will not be: the runtime holds no model
client (ADR-0001). The api only ever verifies tokens.

## Networking

Everything binds to loopback. The shared reverse proxy fronts the domain and routes `/` to `web`. It
needs **no `/api` rule**: the Next server proxies `/api/*` to the api service itself, because that
is what can turn the session cookie into an `Authorization` header (see
[ADR-0002](../architecture/decisions/0002-identity-service-as-authentication-engine.md)).

Identity is the fps4 realm on AWS, reached at its public issuer. The api fetches the JWKS from
there like any other client.

## Operator tasks

Four writes to the live deployment run as named, manually dispatched tasks in the operations
repository, dry by default. Each one runs the deployed api image on the host:

| Task | What it does |
|---|---|
| `publish-pack` | Publishes `skills/<id>/skill.yaml` as baked into the running api image (ADR-0029). It never publishes blocks. |
| `load-reading` | Loads a directory of prepared articles on the host into one learner's library (ADR-0017) |
| `remove-pack` | Deletes a pack, and optionally every learner's work in it |
| `retopic-cards` | Moves a deck's cards onto the topic ids its manifest declares (ADR-0032) |

`publish-pack` and `load-reading` need a coach token. The coach client secret that mints it stays on
the host: the token is minted there and is never written anywhere. `remove-pack` and
`retopic-cards` use the api container's own environment, so no credential is handled at all.

Because `publish-pack` reads the manifest from the deployed image, a new or changed manifest is
merged and deployed first, then published.

## First deploy

1. **Register the application in identity-service.** It needs audience `skills-coach`, a role
   catalogue of `learner` and `coach`, a web client (`skills-coach-web`, password grant) and a coach
   client (client-credentials). Then assign users. This is operator configuration, not code.

2. **Publish a pack.** The deployment starts empty: no content is committed
   ([ADR-0006](../architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md)).
   Run the `publish-pack` operator task, then author blocks through the coach API with a coach token.

## Operating

**Logs** are JSON lines on stdout: `docker logs skills-coach-api`.

**Backups.** MongoDB is the only copy of everything: content, learner state, and history. Content
authored directly through the coach API exists nowhere else. `infra/docker/backup.sh` dumps the
`skills-coach` database to `/mnt/backup/skills-coach` on the host, keeping 30 days.

It runs from the **host crontab**, not from a pipeline, because a pipeline cannot write host paths
and `on: schedule` is best-effort
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

**Rollback** means redeploying an earlier digest. Every published commit keeps its `:<sha>` tag.
Data is unaffected: there are no schema migrations, and indexes are applied idempotently at boot.

**Audit** lives in the `auditEvents` collection with a TTL index (`AUDIT_RETENTION_DAYS`, default a
year).

**Search** is an index in the api's memory, built at boot from MongoDB and the guides in the image
([ADR-0030](../architecture/decisions/0030-search-is-lexical-and-held-by-the-api.md)). There is
nothing to back up or migrate. A write through the api is searchable at once. One made by an
operator script appears at the next rebuild (`SEARCH_REBUILD_MINUTES`, default 15), or restart the
api to rebuild now. `search index built` in the api log gives the document count and how long it
took.
