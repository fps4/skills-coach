---
title: The reference library ships with the code
status: accepted
date: 2026-08-08
---

# ADR-0016 — A public reference library is committed, as an exception to ADR-0006

## Context

[ADR-0006](0006-content-and-learner-data-stay-out-of-the-repo.md) keeps training content out of this
repository. Its reasoning is privacy first — the first pack is built around one learner's real
employer and their actual mistakes — and clock second: content changes weekly, the runtime does not,
and coupling the two is friction with no benefit.

It also names its own exception: *"A pack that is genuinely public and impersonal — a shared
professional curriculum, say — could reasonably be committed. That would be an exception granted per
pack, not a change to the default."*

The wiki is that case. It is a set of 28 short technical guides — SQL, dbt, Kafka, TOGAF, feature
stores — written as refreshers for practitioners. Nothing in it is about a person. Nothing in it is
about a learner's progress. It is the kind of material that would be a blog if it were not a wiki.

Two things separate it from a pack, and both matter:

- **It is not teaching material in the pack sense.** It has no blocks, no ramp, no answer keys, no
  error categories. Nothing reads it but a human. It cannot be corrected, submitted, or drilled, so
  none of the machinery ADR-0006 protects applies to it.
- **It changes on the code's clock, not the content clock.** A guide is revised when the technology
  moves — a Databricks rename, a new Airflow minor. That is release cadence, not weekly authoring.

## Decision

**The wiki corpus is committed at `web/content/wiki/*.md` and read from disk by the web service.**
The api is not involved: there is no collection, no endpoint, no importer path. A guide is a file
with frontmatter, and `web/src/lib/wiki.ts` is the only thing that reads it.

The exception is granted to *this library*, on three conditions:

1. **It stays impersonal.** No employer, client, colleague or job posting is named. This is enforced
   by a denylist in `web/src/lib/wiki.test.ts`, which fails the build if one reappears. The condition
   is not a convention someone has to remember — it is a test, because the corpus was sanitised out
   of a private set of notes and the failure mode is a single careless paste.
2. **It carries no learner data.** Nothing about who read what, or how they did. The wiki has no
   progress, by construction — adding any would make it a pack, and packs live in the database.
3. **It stays declarative.** A guide's frontmatter (`topic`, `format`, `tags`) is validated against
   the taxonomy in `wiki-labels.ts` the way a pack manifest is validated by
   `api/src/importer/validate-manifests.ts`. An unknown label fails the build rather than rendering
   an unfilterable tile.

## Consequences

**Good.** The library versions, reviews and deploys with the code that renders it, which is right for
material revised on the same cadence. Reading it costs no request and no database. Articles render
entirely on the server — the guide route ships 182 bytes of client JavaScript, so a 500-line guide
with thirty code blocks costs the browser nothing but markup. And the repository gains a worked
example of substantial content that is genuinely public, which the demo pack cannot be.

**Costs.** Content in the tree means content in code review, which is the right trade for material
revised this rarely but is real friction the database does not have.

**One hazard is real, and it is the `.gitignore`.** ADR-0006's `content/` rule matches a directory of
that name at *any* depth, so `web/content/` is excluded by default and all 28 guides would be
invisible to git — present locally, absent from the commit, and an empty library in every environment
built from a clean checkout. The fix is the same three-line dance the named packs use (re-include the
directory so git walks it, re-ignore its contents, un-ignore the one subdirectory that ships), and it
keeps the default intact: anything else dropped under `web/content/` is still ignored.

This one fails loudly rather than silently, and only because of the corpus test: a CI checkout
without the guides makes `wiki.test.ts`'s non-empty assertion fail. That is the assertion earning its
place — nothing else in the suite notices a missing corpus.

Two further hazards were expected and turned out not to exist. Both were checked rather than assumed,
and the results are recorded here so nobody re-adds a defence against them:

- The root `.dockerignore` ignores `*.md`, which *looks* like it strips the corpus from the build
  context. It does not — Docker's `*` does not match across `/`, so the pattern only covers
  root-level files. Verified by building the web image with and without an un-ignore line: identical
  result, 28 guides either way.
- `outputFileTracingIncludes` looked necessary because the standalone runtime copies only what the
  trace found. Also unnecessary: Next's tracer resolves `content/wiki` on its own, and in any case
  both routes are prerendered, so the runtime never opens the directory. Verified by inspecting the
  emitted `.nft.json` with the entry removed — 28 files traced regardless.

There is also a boundary that will get tested: the wiki is now the easiest place to put anything.
The line is that it holds **reference material a person reads**. The moment something needs to be
answered, scored, tracked, or shown to one learner and not another, it is a pack, and ADR-0006
applies unchanged.

**When to revisit.** If guides start needing per-learner state — bookmarks, read status, "practise
this" — the exception has been outgrown, and the right move is a pack surface, not a database table
bolted onto a file tree.
