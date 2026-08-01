# Contributing

## Setup

Requires Node 20+ and Docker.

```sh
make install     # api + web dependencies
make up          # mongodb + api + web
make seed        # publish the demo pack, enrol the dev learner
```

`http://localhost:8011` serves the app. Local runs use `AUTH_MODE=dev`, which injects a stub
principal, so you do not need a running identity-service to develop.

For hot reload, `make dev` runs the api (`tsx watch`) and the web dev server against the compose
MongoDB.

## Before you push

```sh
make check       # typecheck + lint + test — the same checks CI runs
```

Integration tests need MongoDB reachable at `MONGO_URI`; they **skip** rather than fail when it
isn't, so `make test` works on a laptop with Docker down. CI always has it, so they always run there.

## Definition of Done

A change is done when all of these hold. `.github/workflows/dod.yml` enforces every one of them on
each pull request:

- [ ] No secrets committed (gitleaks, `--no-git` scan of the tree)
- [ ] `api` and `web` images build
- [ ] Typecheck and lint clean for both packages
- [ ] Unit and integration tests green against a real MongoDB
- [ ] No fixable HIGH or CRITICAL dependency advisories (Trivy, blocking)
- [ ] **Docs updated in the same change as the code they describe**

That last one is not a formality. A new endpoint means a row in `docs/api/endpoints.md`; a decision
that constrains future work means an ADR; a changed drill rule means the mapping table in
`CODEBASE.md`.

## Conventions

- **Domain rules are tested first.** `api/src/domain/` is pure and its tests are the specification of
  how the product behaves. Write the test as the sentence the rule states.
- **Routes are thin.** Validate input, call a service, map errors. Business logic belongs in
  `services/`, decisions in `domain/`.
- ADRs live in `docs/architecture/decisions/`, numbered and never renumbered. Superseding an ADR
  means a new one that says so, not an edit.
- Commit messages describe the behaviour change, not the files touched.

## What must never enter this repository

It is public. Do not commit training content, learner answers, error logs, session logs, or anything
naming a real person or employer — including in test fixtures and doc examples. Real packs are
imported into MongoDB from a local directory; only `packs/demo-*` is committed. See
[ADR-0006](docs/architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md).

## Reporting a security issue

Please do not open a public issue for a vulnerability. Contact the maintainers directly.
