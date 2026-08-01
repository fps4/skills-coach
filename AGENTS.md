# Instructions for coding agents

Read [`CODEBASE.md`](CODEBASE.md) for the map and [`GLOSSARY.md`](GLOSSARY.md) for the vocabulary.
This file is the set of rules that override convenience.

## Four rules that are not preferences

1. **The runtime generates nothing.** Do not add a model client, an API key, or any call to a
   language model in `api/`. Correction and authoring reach the system through `/coach/v1` and
   nowhere else. If a feature seems to need generation, it needs a coach-API endpoint instead.
   ([ADR-0001](docs/architecture/decisions/0001-runtime-not-agent.md))

2. **`api/src/domain/` stays pure.** No database, no HTTP, no fastify, no clock reads that aren't
   passed in. It is imported by tests as a specification. If you need persistence, you are writing a
   service, not a domain rule.

3. **This repository is public and holds no content and no personal data.** Do not commit training
   material, learner answers, error logs or session logs — not in fixtures, not in tests, not in
   examples. Test data is synthetic. The only pack in the tree is `packs/demo-*`.
   ([ADR-0006](docs/architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md))

4. **Skills Coach owns no identity.** No user table, no credentials, no password handling, no
   callback to identity-service to make an authorization decision. Everything needed arrives on the
   verified token. An unrecognised role grants no capabilities and is logged.
   ([ADR-0002](docs/architecture/decisions/0002-identity-service-as-authentication-engine.md))

## Assessment output is advisory

Ratings, mastery signals and error-log statuses are learning aids. Do not build a feature that emits
a persisted, consequential competency score about a person — one that could feed an employment,
admission or certification decision. Keep assessment output advisory, keep a human final, and keep it
auditable. This is a legal boundary, not a design taste.

## Working in this repo

- Tests first for anything in `domain/`. The test names should read as the rule they encode.
- When you change behaviour that the original Dutch program specified in prose, update the mapping
  table in `CODEBASE.md` in the same change.
- A new decision that constrains future work gets an ADR. A new endpoint gets a row in
  `docs/api/endpoints.md`. Both in the same PR as the code.
- Prefer extending the pack contract over special-casing a pack. If the Dutch pack needs something,
  ask what the general shape of that need is first.
- Run `make check` before you consider work done — it runs what CI runs.

## What CI enforces

`.github/workflows/dod.yml` blocks a merge on: no committed secrets (gitleaks), both images
building, typecheck and lint passing, unit and integration tests green against a real MongoDB, and no
fixable HIGH/CRITICAL dependency advisories (Trivy). None of these are advisory.
