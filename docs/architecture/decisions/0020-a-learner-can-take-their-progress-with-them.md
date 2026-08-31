---
title: A learner can take their progress with them
status: accepted
date: 2026-08-31
---

# ADR-0020 — A learner can take their progress with them

## Context

Everything a learner accumulates here — where they are in a pack, the streak on every word, the words
they added themselves, their reading library, the work they handed in and the coaching that came back
— lives in one MongoDB and nowhere else. There is a nightly backup
([ADR-0013](0013-nightly-backups-run-from-the-host.md)), but that is the *operator's* copy: it
restores a deployment, not a person, and a learner cannot ask for it, read it, or take it anywhere.

That is a poor deal for the person doing the work. A learner who wants to move to a different
deployment, keep a copy of their own, or put a pack down for three months and pick it up later has
no way to do any of it. And this is the kind of data that is genuinely theirs: not a derived score
the product owns, but a record of what they did.

The obstacle is not the reading — it is that **identifiers do not survive the move**. A `learnerId`
is a `randomUUID()` minted the first time a token's `sub` is seen, so the same person on a new
deployment is a different learner. Several ids are built from a hash of that value: a block written
for one person (ADR-0015), a word they added (ADR-0012), an article loaded for them (ADR-0017). A
file full of those ids would restore into an account where none of them match, and every streak in it
would silently detach.

Deterministic content ids are what make this solvable. A pack's block is `{packId}.b{order}` and its
drill item is that block plus a digest of the content
([`services/context.ts`](../../../api/src/services/context.ts)), so the *same* pack published on a
different system produces the *same* ids. Only the owner-scoped part is unstable, and it is
re-derivable from parts the file can carry.

## Decision

**A learner can download everything about themselves as one JSON file, and put one back.**

Four commitments, in the order they matter.

### 1. The archive stores references, never owner-scoped identifiers

Nothing owner-scoped is written to the file. What is written is what the identifier is made of — the
pack, the block's order, the drill item's content digest — and the import rebuilds the id under
whoever is importing. `domain/portable.ts` owns what a reference is; `services/archive.ts` turns one
back into a document.

The digest is deliberately the *content hash* rather than the content: a learner's file therefore
carries no pack material, which keeps a personal export from becoming a copy of the curriculum.

### 2. Everything of the learner's, and nothing of the pack's

In: position, practice state, their own words, their reading library and read marks, attempt history,
submissions, corrections, the error log, block reviews and quiz sittings.

Out: lessons, vocabulary, questions — the coach's material, republished from `packs/` and not the
learner's to carry (ADR-0006). Also out: `subject` and `email`, which identity-service owns and this
product only borrows (ADR-0002).

An import **re-attaches, it never creates pack content**. A reference to material this system does not
have is reported as unresolved and skipped, never invented — a fabricated drill item would be a word
the learner never chose to study, sitting in a deck they trust.

### 3. An import never demotes

The trainer already holds that mastery is a floor: a mastered item is inert and revisiting it cannot
take it back ([`domain/drill-progress.ts`](../../../api/src/domain/drill-progress.ts)). Import obeys
the same rule. Where the file and the live account disagree, the further-along side wins, taken
**whole** rather than field by field — a merge that took `mastered` from one side and `stage` from
the other could produce a state the streak machine has no path to.

The consequence is the property worth having: **importing the wrong file by accident costs nothing.**
Positions move forward only, read marks stay read, and counters are maxed rather than summed so that
re-importing a backup cannot inflate a history the learner reads as their own.

There is deliberately no "replace" mode. It would be the one operation here capable of destroying
work, in exchange for a rollback that a learner asking for one can get by other means.

### 4. Restoring is never one click

The import endpoint takes `?dryRun=true`, and the surface always calls that first: picking a file
reports what *would* happen, and a second, deliberate press writes anything. A learner must be able
to open a file they are unsure of — one of three in a downloads folder, six months old — without
betting their streaks on finding out what it holds.

### The capability

`progress:restore` is its own capability rather than part of `progress:read`, for the reason
`drill:curate` is not part of `drill:practice` (ADR-0012) and `reading:track` is not part of
`lesson:read` (ADR-0017): it writes, and a capability that permits writing is never implied by one
that permits reading. It writes across every collection a learner owns in a single call, which is
more authority than any other learner route holds.

Export sits behind `progress:read`. Leaving with your own work should not need a permission that
reading it does not.

## Consequences

- The file is **versioned** (`kind` + `version`), and an unreadable version is refused whole rather
  than partly applied. Nobody can tell which half of a half-applied archive landed.
- **JSON, not YAML.** The file is machine-written and machine-read, and it is full of short words in
  a foreign language — exactly the payload YAML's implicit typing mangles. A term `no`, `on` or `y`
  read by a YAML 1.1 parser is a boolean, and `1.10` is the number 1.1. Pretty-printed with two
  spaces, because the learner may well open it.
- An archive is dominated by `attempts`, one row per answer ever given, so the import route carries
  its own raised body limit. Refusing somebody's history at the door because it got long would defeat
  the point of keeping it.
- An attempt has no meaningful identity of its own, so a re-import recognises one by the event —
  learner, item, instant. Two attempts on one item inside the same millisecond collapse to one; they
  are a network round trip apart in practice, and that is a far smaller wrong than doubling every
  attempt each time somebody re-imports their own backup.
- A real import is audited; a dry run is not, having decided nothing.
- **This is not the operator's backup and does not replace it.** ADR-0013 still covers the
  deployment. This covers the person.
