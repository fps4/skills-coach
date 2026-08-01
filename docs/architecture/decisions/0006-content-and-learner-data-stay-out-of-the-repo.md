---
title: Training content and learner data never enter the repository
status: accepted
date: 2026-08-01
---

# ADR-0006 — Content and learner data stay out of the repository

## Context

This repository is public. The first pack is not: it is a personal Dutch program whose lessons are
built around one learner's real employer, a specific job application, and their actual work history.
The accompanying error log and session logs are a verbatim record of that person's mistakes over
months.

There is a weaker reason to separate them too, independent of privacy: content changes on a different
clock than code. A pack gets a new block every week or two; publishing that through a pull request
and a deployment is friction with no benefit, because the runtime does not change.

## Decision

**No real training content and no learner artifacts are committed.** Concretely:

- Only `packs/demo-*` lives in the tree — a small synthetic pack, invented for the purpose, that
  exists so `make up && make seed` yields a working application and so contributors have a worked
  example of the pack format.
- Real packs are imported into MongoDB from a local directory (`make import PACK=/path/to/pack`) and
  live only in the database.
- Learner artifacts — submissions, corrections, session logs, error logs — are created through the
  API and exist only in the database. They are never fixtures, never examples, never test data.
- `.gitignore` ignores `packs/*` and un-ignores `packs/demo-*`, so the default outcome of dropping a
  pack into the tree is that it stays out of git.
- Test data and documentation examples are synthetic. No real person, employer or organisation is
  named anywhere in this repository.

## Consequences

**Good.** The public repository is a clean product with nothing personal in it, and it stays that way
by default rather than by vigilance. Content can be revised continuously without touching the
release. The importer has to be genuinely reusable — it takes a path, not a hardcoded location —
which is a better tool than one built against a directory that happened to be in the tree.

**Costs.** The repository does not demonstrate the system on real material, so the demo pack has to
carry that weight; if it drifts from what real packs look like, the importer will silently stop
matching reality. Content also has no version control unless the author keeps their source directory
in one — the database holds the current state, not the history. And content is now outside the
backup story that covers the repository, so the MongoDB backup is the only copy of anything authored
directly through the coach API.

**When to revisit.** A pack that is genuinely public and impersonal — a shared professional
curriculum, say — could reasonably be committed. That would be an exception granted per pack, not a
change to the default.
