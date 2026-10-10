# Surface specs

One file per **function** of the product — what it is for, the rules it enforces, its API, its
screen behaviour, and the things it deliberately refuses. Each is written to be enough to **rebuild
that function** without reading the implementation first.

They are separate files rather than one per pack on purpose: a pack *declares* which of these it
offers, but the behaviour belongs to the platform, and every pack that offers a surface gets exactly
the same one. There is no per-pack branching anywhere in the runtime.

| Function | Surface key | Route |
|---|---|---|
| [Lessons — the lesson reader](lessons.md) | `lessons` | `/lessons/{lessonId}` |
| [Session log — hand in, read back](session-log.md) | part of `lessons` | `/sessions/{submissionId}` |
| [Reading — the reading library](reading.md) | `reading` | `/reading` |
| [Word trainer](word-trainer.md) | `drills:terms` | `/drills/words` |
| [Sentence puzzle](sentence-puzzle.md) | `drills:word-order` | `/drills/sentences` |
| [Practice test](quiz.md) | `quiz` | `/quiz` |
| [Progress and the menu](progress-and-navigation.md) | — (not declarable) | `/` · `/skills` · `/progress` |
| [Wiki — the reference library](wiki.md) | — (platform-wide) | `/wiki` |
| [Your data — the portable archive](your-data.md) | — (the learner's, not a pack's) | `/archive` |

Screen sketches in these files that show Dutch labels predate
[ADR-0025](../../architecture/decisions/0025-the-interface-is-english-only.md): the interface is now
English only, and the labels are the ones in `web/src/i18n/dictionaries.ts`.

## How a surface comes to exist

The set of declarable surfaces is **closed**:

```
lessons · reading · drills:terms · drills:word-order · quiz · progress
```

Closed for the same reason the section kinds are
([ADR-0004](../../architecture/decisions/0004-pack-contract-and-typed-sections.md)): a surface the
runtime cannot render is the failure the pack contract exists to prevent, so a typo must fail the
publish rather than silently hide a tab. `progress` is retained only for packs published
before [ADR-0018](../../architecture/decisions/0018-the-rail-is-packs-one-level-deep.md) named it;
the viewer ignores the key.

**Adding a surface is a platform change with a renderer behind it** — one entry in
`web/src/lib/pack-scope.ts` answering two questions (does the pack offer it, does the pack have any),
plus a count in the material payload if it needs a new one. No new endpoint, and no branch anywhere
on which pack is being served.

Whether a surface *appears* for a given learner is decided in one place and by three questions —
see [Progress and the menu](progress-and-navigation.md#when-a-surface-appears)
([ADR-0019](../../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)).

## What every surface has in common

These hold across all of them, and a rebuild that drops one has changed the product:

- **The runtime carries and counts; it never generates or judges.** Content and judgement enter
  through `/coach/v1` ([ADR-0001](../../architecture/decisions/0001-runtime-not-agent.md)).
- **Answers are graded on the server.** For the drills and the quiz the key never reaches the page
  before the learner commits. (A lesson's printed answer key is the deliberate exception — see
  [lessons.md](lessons.md#answer-keys-are-delivered-and-hidden).)
- **Progression is position, never dates.** No streak-of-days, no decay, no "you missed a week".
- **Nothing derived is stored.** Scores, statuses and breakdowns are computed on read, so they cannot
  disagree with the evidence they come from.
- **The interface is English; each skill is in one language.** There is no interface-language
  setting and no language in the URL
  ([ADR-0025](../../architecture/decisions/0025-the-interface-is-english-only.md)). Pack material
  announces its own language with `lang` on the element, so Dutch is read as Dutch inside the English
  chrome ([ADR-0005](../../architecture/decisions/0005-ui-language-vs-content-language.md)).
- **Filter state lives in the URL**, so a view is bookmarkable and shareable.
- **Content another learner owns is a `404`**; a non-content resource that is theirs is a `403`.
- **No engagement metrics.** No time-on-page, no scroll tracking, no inferred completion.

## Writing one of these

Keep the sections in this order, and keep the last one:

1. The table — surface key, routes, capability, when it appears, what it writes
2. What it is for — one or two paragraphs, the pedagogical reason
3. Data it needs — the payload, annotated
4. The rules — the rebuild-critical part; state machines, quantifiers, orderings, thresholds
5. API — routes and shapes, with the refusals
6. The screen — a sketch, then the behaviours a rebuild must keep
7. **Deliberate refusals** — what it will not do, and why. This is the section that stops a rebuild
   quietly becoming a different product.
8. Where the code is
