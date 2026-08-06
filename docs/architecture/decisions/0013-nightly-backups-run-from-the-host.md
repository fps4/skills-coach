---
title: Nightly backups run from the host, not the pipeline
status: accepted
date: 2026-08-06
---

# ADR-0013 — Nightly backups run from the host, not the pipeline

## Context

MongoDB is the single store ([ADR-0003](0003-mongodb-single-store.md)) and the repository is public,
so it holds no content and no learner data
([ADR-0006](0006-content-and-learner-data-stay-out-of-the-repo.md)). Together those two decisions
mean the deployed database is not *a* copy of the product's content — it is the *only* copy. A pack
authored through the coach API, a learner's error log, three months of attempts: none of it exists
anywhere else, and none of it can be rebuilt from the tree.

`deploy-ds1` also carries a `reset_mongo_volume` input that deletes that volume deliberately. It
exists for a real failure — a password mangled on the way into an already-initialised volume can
only be fixed by re-initialising — so the destructive path is not hypothetical, it is documented and
occasionally correct.

Everything needed is already on the host. ds1 has a separate backup disk at `/mnt/backup` (932G, 4%
used), and identity-service has been dumping to it nightly at 02:30 for a month.

The pipeline was the obvious place to put this, and it is the wrong one:

- **`on: schedule` is best-effort.** GitHub delays scheduled runs under load, drops them under
  enough of it, and disables scheduled workflows outright after 60 days without repository activity.
  A backup that stops quietly is worse than none, because it is believed.
- **The runner cannot reach the backup disk.** The ds1 runners are containers mounting exactly one
  thing, `/var/run/docker.sock`; host paths do not translate across it (see
  [the deployment guide](../../guides/deployment.md)). The dump would land inside an ephemeral
  container. Reaching `/mnt/backup` from there means a helper container with a host bind-mount —
  more privilege granted to the pipeline than a backup is worth.
- **It puts GitHub in the recovery path.** The mechanism that survives a bad day should not depend
  on a third party being up on that day.

## Decision

**The script is version-controlled; cron runs it.** `infra/docker/backup.sh` lives in this
repository and is reviewed like any other change. A host crontab entry on ds1 invokes it at 03:00,
an hour clear of identity-service's 02:30. `backup.sh verify` is the same script's answer to "did
last night happen".

**Credentials stay inside the container.** Unlike identity-service's database, this one requires
auth, so the dump could have needed a password on the host. It does not: `mongodump` is invoked
*inside* the container and dereferences that container's own `MONGO_INITDB_ROOT_*` environment.
Nothing is written to the crontab, the log, or the script.

**Snapshots are plaintext under a controlled path**, `/mnt/backup/skills-coach`, retained 30 days.
The filesystem's access control is the protection — the same conclusion identity-service reached in
its ADR-0008 after trying an encrypted scheme. A backup nobody can decrypt under pressure is not a
backup.

**A dump is a snapshot only once it is whole.** The archive is written to `.partial` and renamed
only after `gzip -t` passes, because a truncated file otherwise sorts as the newest snapshot present
— exactly the one that would be reached for.

**Installing the cron entry is a host step, not a deploy step**, documented in the deployment guide.
The pipeline cannot write a host crontab without mounting the host filesystem into a runner
container, which is the privilege this ADR just declined.

## Consequences

**Good.** The destructive paths that exist — `reset_mongo_volume`, a bad migration, a lost volume —
stop being one-way. Recovery is one command against a file whose restorability was exercised, not
assumed: the first snapshot was replayed through `mongorestore --dryRun` before this landed.

**Costs.**

*Cron is silent when it fails.* The `verify` subcommand exists to be called by something that is
not silent — a scheduled workflow, a monitor, a human — but nothing calls it yet. Until something
does, a stopped backup is invisible until a restore is needed. This is the open end of this ADR.

*The host copy of the script can drift* from `main`, because ds1 holds a clone that only advances on
`git pull`. Changing `backup.sh` means pulling on ds1; the deployment guide says so, which is
weaker than the pipeline enforcing it.

*One disk, one building.* `/mnt/backup` is a second physical disk in the same machine. That covers
volume loss, a mistaken `down -v`, and corruption — not fire, theft, or the host itself. Off-site
replication of `/mnt/backup` is a separate decision, and would sensibly cover identity-service in
the same move rather than being solved once per product.
