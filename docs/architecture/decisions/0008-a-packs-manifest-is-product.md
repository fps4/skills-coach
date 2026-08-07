---
title: A pack's manifest is product; its blocks are content
status: accepted
date: 2026-08-03
---

# ADR-0008 — A pack's manifest is product, its blocks are content

## Context

[ADR-0006](0006-content-and-learner-data-stay-out-of-the-repo.md) keeps training content and learner
artifacts out of this public repository, and it is right about why: the first pack's lessons are built
around one learner's real employer, a specific job application and their actual work history, and the
error log is a verbatim record of that person's mistakes.

But it treats a pack as one indivisible thing, and a pack is not one thing. Its manifest declares the
program: the CEFR ladder and the ramp of dials that climbs it, the error-category vocabulary, the
article lists used for tolerant matching, the goal every next-block brief is written against. None of
that is about a person. Its blocks are the lessons, and those are entirely about a person.

The consequence of not separating them is visible: `packs/dutch-conversation-nl/pack.yaml` — the file
that decides what "recurring mistake" means for the only real program on the platform — lived
untracked on a single laptop. No review, no history, no backup, and an error-category rename (which
orphans every existing entry, silently) would land unnoticed.

ADR-0006 anticipated this and left the door open: *"A pack that is genuinely public and impersonal …
could reasonably be committed. That would be an exception granted per pack, not a change to the
default."*

## Decision

**A pack's manifest may be committed; its blocks may not.**

- The split is by artifact, not by pack: `pack.yaml` is the product contract, everything under
  `blocks/` is content. No pack ever commits a lesson, a drill CSV, a session log or an error log.
- The exception is granted **per pack, by name**, in `.gitignore`. Dropping a new pack into the tree
  still results in all of it staying out, which is ADR-0006's default and stays ADR-0006's default.
- A manifest earns the exception only if it names no person, employer, organisation or application.
  `goal` describing "a job interview" is a program outcome; `goal` naming the company is content.
- `packs/dutch-conversation-nl/pack.yaml` is the first grant. `packs/demo-*` is unchanged — it is
  synthetic and ships for a different reason (a worked example, and something for `make seed`).
- Every committed manifest is checked in CI by `npm run validate:manifests`, which parses it through
  the same `loadManifest` the importer uses and then lints what the schema cannot see.

The `.gitignore` stanza is three lines in a load-bearing order, because git does not descend into an
excluded directory: re-include the directory, re-ignore its contents, un-ignore the one file.

## Consequences

**Good.** The vocabulary that the whole adaptation loop joins on is now reviewed like code, with
history. A category rename shows up in a diff, which is the only place it can be caught — at runtime
it is silent. The manifest is inside the repository's backup story rather than outside it. And a
second pack for the same skill starts by copying a reviewed file instead of a remembered one.

**Costs.** Two artifacts of one pack now live in two places, and an author has to know which is which;
the importer already supported this (`--source` and `--manifest` are separate flags), but it is one
more thing to hold. The per-pack grant is manual, so a new impersonal pack does not get committed by
default — deliberate, but it means the decision gets made again each time. And a manifest is only
impersonal until someone writes something personal into `goal` or a category label; the check is a
human reading the diff, which is exactly the check ADR-0006 says a public repository needs.

**Not decided here.** Whether a manifest can be a *template* other packs inherit from. With one real
pack there is nothing to inherit; the manifest is the template, copied. Revisit if a second variant
of the same program appears.

## Postscript — resolved by ADR-0015

A second variant appeared: the same Dutch B1→B2 programme, needed for a second learner whose lessons
had to be about their own work rather than the first learner's. Copying the manifest was the only
way, and it duplicated the error-category vocabulary this ADR put in git precisely so that it would
exist once and be reviewed once.

[ADR-0015](0015-a-block-may-be-owned-by-a-learner.md) answers the deferred question by not needing a
template at all: **a block may be owned by a learner**, and the domain their lessons are written
about moves to a profile on the learner. One manifest, several learners, each with their own blocks.
The split this ADR drew — manifest is product, blocks are content — turned out to be exactly right;
what was missing was that blocks are content *about somebody*, and nothing said whom.
