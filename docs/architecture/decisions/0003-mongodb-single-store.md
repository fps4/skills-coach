---
title: One MongoDB for everything; logs to stdout; audit as a collection
status: accepted
date: 2026-08-01
---

# ADR-0003 — MongoDB as the single store

## Context

Skills Coach holds three kinds of state: **content** (packs, blocks, lessons, drill decks),
**learner state** (progress, drill streaks, attempts), and **logs** in two different senses — domain
logs (the session log for a lesson, the cumulative error log) and operational logs.

The word "log" doing double duty is the trap here. The domain ones are first-class product data that
users read; the operational ones are observability.

Content is deeply nested and heterogeneous: a lesson is an ordered array of nine possible section
kinds, and pack authors will add more. That is a document, and modelling it relationally would mean
either a table per section kind or a JSON column pretending to be a document.

## Decision

**One MongoDB database holds everything**, with three distinctions:

- **Content and learner state** are ordinary collections. Nested content stays nested; queries are by
  `(learner, block, lesson)`, which indexes cleanly.
- **Domain logs are product data, not logs.** Session logs are derived from `submissions` +
  `corrections`; the error log is a collection keyed `(learnerId, category)`. They are read, queried
  and rendered like everything else.
- **Operational logs go to stdout as JSON lines**, captured by the container runtime. Nothing writes
  application logs to the database.
- **Audit events are an append-only `auditEvents` collection with a TTL index.** Who did what to
  which resource. Bounded by retention rather than by pruning logic.

No Postgres. No migration runner — indexes are declared in `api/src/db/indexes.ts` and applied at
boot, which is idempotent.

## Consequences

**Good.** One datastore means one connection story, one backup, one thing to run in CI and one to
operate on ds1. No ORM and no schema-migration machinery for a product whose content shape is still
moving. Zod schemas at the API edge give validation where it actually matters, and the document
shape can evolve without a migration for every authoring change.

**Costs.** No transactions across documents unless we opt into a replica set; the operations that
need atomicity today (publishing a block's lessons and drill items together) are written to be
idempotent and re-runnable instead. Cross-learner analytical queries will be aggregation pipelines
rather than SQL, which is fine at this scale and would not be at a much larger one. We also lose
schema enforcement at the storage layer — the mitigation is that every write goes through a service
that validates first, and nothing writes to Mongo directly.

**When to revisit.** Add a relational store when someone wants ad-hoc SQL or BI over attempt history
across many learners — that is the point where aggregation pipelines stop being the right tool. It is
an additive change: attempts would be projected into it, and Mongo would remain the system of record.
