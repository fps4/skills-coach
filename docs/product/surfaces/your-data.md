---
title: Jouw gegevens — the portable archive
surface: — (platform-wide)
status: built
---

# Jouw gegevens (your data)

| | |
|---|---|
| **Surface key** | — not declarable; it belongs to the learner, not to a pack |
| **Route** | `/{locale}/archive` |
| **Capability** | `progress:read` to download · `progress:restore` to put one back |
| **Appears when** | always, for every learner |
| **Decides** | nothing on its own — an import writes across every collection the learner owns |

Download everything about yourself as one file, and put one back. This is what makes a learner's work
theirs rather than the deployment's ([ADR-0020](../../architecture/decisions/0020-a-learner-can-take-their-progress-with-them.md)).

## What it is for

Three things a learner reasonably wants and had no way to do: move to a different deployment, keep a
copy of their own, and put a pack down for months without losing the streak on every word in it.

It sits beside the wiki rather than under a pack, for the opposite reason: the wiki belongs to no
pack, and an archive belongs to *every* pack at once. Filing it under one would be filing it under the
wrong one ([ADR-0018](../../architecture/decisions/0018-the-rail-is-packs-one-level-deep.md)).

## The rules

### What is in the file, and what is not

**In** — everything the learner accumulated:

| Section | What it is |
|---|---|
| `learner` | display name, interface language, the domain profile (ADR-0015) |
| `enrollments` | which pack, which block, which lesson |
| `drillState` | stage, streak and mastery per item — the core |
| `ownTerms` | words the learner added themselves (ADR-0012) |
| `attempts` | every answer ever given, with its verdict |
| `submissions` | written work, per lesson |
| `corrections` | the coach's corrections and advisory ratings |
| `errorLog` | categories, counts, status |
| `blockReviews` | end-of-block reviews written for them |
| `quizSessions` | every sitting, with answers |
| `articles` | the reading library, each carrying its own read mark |

**Out**, and neither is an oversight:

- **The pack's material.** No lessons, no vocabulary, no questions. That is the coach's, republished
  from `packs/`, and copying it into a personal file would put content where it does not belong
  ([ADR-0006](../../architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md)).
  The file carries a drill item's *content digest*, never its text.
- **`subject` and `email`.** Identity-service owns who somebody is; this product borrows it
  ([ADR-0002](../../architecture/decisions/0002-identity-service-as-authentication-engine.md)).

Whether an article was read rides on the article rather than in a section of its own. Live they are
two documents on purpose — re-loading a corrected translation must not mark it unread — but in a file
there is nothing to re-load, and splitting them would only invite one to appear without the other.

### References, not identifiers

The heart of it. A `learnerId` is a `randomUUID()` per identity subject, so **the same person on a new
system is a different learner id**, and these identifiers embed a hash of it:

| Identifier | Form | Survives a move? |
|---|---|---|
| A pack's block | `{packId}.b{order}` | yes |
| A pack's drill item | `{blockId}.d.{digest}` | yes |
| A block written for one learner | `{packId}.u{ownerTag}.b{order}` | **no** |
| A learner's own word | `{blockId}.u{ownerTag}.{digest}` | **no** |
| An article | `{packId}.r{ownerTag}.{slug}` | **no** |

So the file stores **what an id is made of** and the import rebuilds it under whoever is importing:

```jsonc
{ "pack": "aws-sap-c02", "block": 1, "owned": false,
  "kind": "term", "digest": "00250fd6b17e", "own": false }
```

`owned` (the block was written for one learner) and `own` (the learner added this word) are recorded
rather than inferred — the pack's block 1 and a learner's own block 1 are both "pack, order 1", and
only these tell them apart.

Their own words and their articles are **re-created** rather than resolved: they exist nowhere but in
the file, so the own words go back in first, before any streak has something to attach to.

### An import re-attaches, it never creates content

A reference to a pack's drill item resolves against material that must already be published on the
target system. When it is not there the row is **reported as unresolved and skipped** — never
invented. A fabricated drill item would be a word the learner never chose to study, sitting in a deck
they trust. Publishing the pack later and re-importing the same file picks the rows up.

### An import never demotes

Where the file and the live account disagree, the further-along side wins:

```
mastered  >  stage 2 cleared  >  stage 1 cleared  >  stage  >  streak
```

Taken **whole**, never field by field — a merge that took `mastered` from one side and `stage` from
the other could produce a state the streak machine has no path to. The two counters are the
exception, and are **maxed rather than summed**: the same practice counted from both sides of a
backup would inflate a number the learner reads as their own history. `correct <= attempts` survives
maxing each independently.

The same floor applies everywhere else it can:

- a **position** moves forward only, comparing block order then lesson order
- a **read mark** stays read; an archive that does not know about one cannot unread it
- an **error-log entry** is taken from whichever side saw it more recently, keeping the earlier
  `firstSeen`; counts are never summed
- **events** — attempts, submissions, corrections, sittings, reviews — are inserted if absent and
  never overwritten
- the **display name, interface language and profile** are filled in only where this system has
  nothing. A setting chosen *here* is not overruled by a file from six months ago.

The property this buys: **importing the wrong file by accident costs nothing.**

### Restoring is never one click

Picking a file always dry-runs it first and shows what it *would* do; a second, deliberate press
writes. A learner must be able to open a file they are unsure of without betting their streaks on
finding out what it holds.

## API

```http
GET  /api/v1/archive                        → the file, as an attachment
POST /api/v1/archive/import?dryRun=true     → ImportReport, writing nothing
POST /api/v1/archive/import                 → ImportReport, having written
```

The envelope:

```jsonc
{
  "kind": "skills-coach.learner-archive",   // refused if it is anything else
  "version": 1,                             // a version this build cannot read is refused whole
  "exportedAt": "2026-08-31T09:12:04.318Z",
  "generator": "skills-coach-api",
  "packs": [{ "packId": "aws-sap-c02", "version": 7 }],   // advisory; nothing is gated on it
  "…": "the sections above"
}
```

The report, per section: `applied`, `unchanged`, `unresolved`, plus up to 25 named `examples` of what
did not resolve and why. An import that silently dropped a third of a deck would otherwise look
identical to one that worked.

Refusals:

- a file that is not an archive, or a malformed row anywhere in it → `400`, and **nothing is applied**.
  A half-applied archive is worse than a rejected one, because nobody can tell which half landed.
- a `version` outside `READABLE_VERSIONS` → `400`, naming what this build reads.
- a coach token → `403` on both routes. This is a learner surface.

`POST /archive/import` carries its own raised body limit: an archive is dominated by `attempts`, and
a learner two years into a pack legitimately has tens of thousands.

## The screen

```
Jouw gegevens
Neem je voortgang mee, of zet een eerder bestand terug.
┌──────────────────────────────────────────────────────────────────────┐
│ ⬇ Downloaden                                                         │
│ Alles wat van jou is in één bestand: … Het lesmateriaal zelf zit er  │
│ niet in — dat komt van het pakket.                                   │
│ [ Download mijn gegevens ]                                           │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ ⬆ Terugzetten                                                        │
│ Kies een bestand. Je ziet eerst wat er zou gebeuren; …               │
│ Terugzetten haalt nooit iets weg: …                                  │
│ [ Kies een bestand ]                                                 │
│ ──────────────────────────────────────────────────────────────────── │
│ Wat er zou gebeuren            Bestand van 30-08-2026 20:11          │
│                        wegschrijven   stond er al   niet gevonden    │
│ Oefenvoortgang                    44             0               0   │
│ Eigen woorden                      7             0               0   │
│ Antwoorden                       612             0               0   │
│ ⚠ Niet teruggezet                                                    │
│   Oefenvoortgang · demo/p1/pab12… — no such drill item on this system│
│ [ Toepassen ]  [ Laat maar ]                                         │
└──────────────────────────────────────────────────────────────────────┘
```

Behaviour the rebuild must keep:

- **Picking a file never writes.** The file input runs a dry run and nothing else. Apply is a separate
  press, and is disabled when the dry run found nothing to do.
- **The download is fetched, not linked.** The proxy adds the bearer token server-side, so a plain
  `<a download>` would arrive unauthenticated and save an error page. The API's
  `content-disposition` is forwarded through the proxy so the file keeps its name.
- **The filename is date-stamped and names nobody** — `skills-coach-2026-08-31.json`. It lands in a
  downloads folder, and a filename is the one part of the transfer that gets read over a shoulder.
- **Sections the file has nothing to say about are left out**, not shown as a row of zeroes.
- **Unresolved rows are shown, named and explained**, not summarised away.
- **A pack whose version has moved on is reported, never used to refuse the import.** A learner whose
  pack was updated should still get their streaks back.

## Deliberate refusals

- **No "replace" mode.** It is the one operation here capable of destroying work, in exchange for a
  rollback a learner asking for one can get by other means. Merge never demotes; that is the whole
  contract.
- **No pack content in a learner's file.** Ever. The digest travels, the text does not.
- **No `subject`, no `email`.** Identity-service owns identity (ADR-0002).
- **Nothing is invented to make the numbers add up.** An unresolved reference is reported.
- **A malformed file is refused whole**, never partly applied.
- **This is not the operator's backup.** [ADR-0013](../../architecture/decisions/0013-nightly-backups-run-from-the-host.md)
  covers the deployment; this covers the person. Neither replaces the other.
- **No import of somebody else's archive into your account by id.** Every route here is scoped to the
  calling learner, like every other learner route — there is no learner id to pass.

## Where the code is

| | |
|---|---|
| References, digests, the merge rule | `api/src/domain/portable.ts` |
| The file's shape | `api/src/domain/schemas.ts` → `archiveSchema` |
| Gathering and re-attaching | `api/src/services/archive.ts` |
| Identifier construction | `api/src/services/context.ts` |
| Routes | `api/src/http/learner.ts` |
| Screen | `web/src/components/archive-panel.tsx` |
| Strings | `web/src/i18n/dictionaries.ts` → `archive` |
