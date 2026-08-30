---
title: Lessen — the lesson reader
surface: lessons
status: built
---

# Lessen (lesson reader)

| | |
|---|---|
| **Surface key** | `lessons` |
| **Routes** | `/{locale}/blocks/{blockId}` (the block's lesson list) · `/{locale}/lessons/{lessonId}` |
| **Capability** | `lesson:read` to read · `submission:write` to hand work in |
| **Appears when** | the block has at least one lesson, and the pack has not opted out ([ADR-0019](../../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)) |
| **Decides** | `submissions` — nothing else. Reading a lesson writes nothing. |

A lesson is read top to bottom, section by section, and ends in a submission: the learner's written
work, handed to the coaching loop.

## The one structural idea

**A lesson is an ordered array of typed sections, and there is one renderer per kind**
([ADR-0004](../../architecture/decisions/0004-pack-contract-and-typed-sections.md)). That is what
lets the surface display *any* pack correctly the day it is imported — a new pack needs content, not
a new component.

The set is **closed**. Adding a kind is a platform change with a renderer behind it, and a typo in a
manifest fails the publish rather than silently rendering nothing.

| Kind | Carries | Rendered as | Feeds |
|---|---|---|---|
| `text` | `body` | prose | — |
| `rules` | `body` | prose, highlighted as the explanation | — |
| `vocabulary` | `items[]` of `{term, translation, example?}` | a table | **`term` drill items** |
| `questions` | `items[]` of `{ref, prompt}` | prompts with an answer box each | a submission |
| `speak` | `prompt`, `minSentences?`, `requirements?` | a spoken task | — |
| `write` | `prompt`, `minSentences?`, `requirements?` | one answer box | a submission |
| `listening` | `prompt`, `sources?[]` of `{title, note?}` | a task with its source list | — |
| `dictation` | `sentences[]`, `prompt?` | a task; **sentences behind a reveal** | a submission |
| `exercise` | `items[]`, `answers?[]`, `prompt?` | prompts with boxes; **answers behind a reveal** | a submission |

Every section carries a slug-like `id`, an optional `title` and an optional `instruction`.

### Answer keys are delivered, and hidden

`dictation.sentences` and `exercise.answers` are **answer keys**, and they are sent to the browser
with the lesson. That is faithful to the source material, where answers were printed at the bottom
of the lesson file — but the surface keeps them behind a *reveal*, so a learner has to choose to
look.

This is a different decision from the drills, where the answer never reaches the page at all. The
difference is what the two are for: a drill is a test and its integrity depends on the answer being
absent; a lesson is study material, and the answers at the bottom are part of it.

## The rules

### Position, never dates

> Lessons, not weekdays. One lesson ≈ one sitting. Skip a day and you simply pick up at the next
> lesson — nothing falls out of sync.

Every progression function is a function of **position**, never of elapsed time. There is no streak
to break, no "you missed a day", no decay.

### What "next" means

`nextLessonOrder` is the first lesson in the block that has been neither corrected nor submitted —
so a lesson waiting on a coach does not block the learner, and does not get offered again either.

**A block is complete when every lesson has been corrected.** Pending submissions do not count: the
work is not done until the feedback exists, because the feedback is what the next block gets written
from.

### What a submission may contain

Answer references follow one scheme, and the surface and the API agree on it without translation in
between:

```
write, dictation      → the section id                  e.g. "opdracht-3"
questions, exercise   → "{sectionId}.{itemRef}"         e.g. "vragen.b"
```

`expectedAnswerRefs` derives the legitimate set from the lesson. A submission carrying a reference
the lesson does not define is **reported, not rejected** — a lesson can be re-published with a
section renamed, and losing a learner's answers to that would be worse than carrying an orphan
reference.

Empty answers are dropped before sending. A submission with nothing in it is refused client-side
with an explanation rather than filed as an empty one for a coach to open.

### One submission per lesson, in the surface

Once a lesson has a submission, the form is replaced by the answers as given plus a link to the
session log. The lesson stays readable; the writing does not reopen. What happens next belongs to
the [coach loop](../../guides/coach-loop.md).

## The screen

```
Les 4 · B1.2 · 45 min                                          ← subtitle
[← Terug naar het blok]
┌─ 📖 Tekst ────────────────────────────────────────────────┐
│ prose, lang=contentLanguage                               │
└───────────────────────────────────────────────────────────┘
┌─ 🔤 Woordenschat ─────────────────────────────────────────┐
│ term │ vertaling │ voorbeeld                              │
└───────────────────────────────────────────────────────────┘
┌─ ✏️ Schrijven ────────────────────────────────────────────┐
│ prompt · min. 5 zinnen                                    │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ jouw antwoord                     lang=contentLanguage│ │
│ └───────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
┌─ 🎧 Luisteren ─┐ ┌─ ✍️ Dictee ──────────┐
│                │ │ ▸ Antwoorden (reveal)│
└────────────────┘ └──────────────────────┘
  Spreeknotitie: [                    ]
  [ Inleveren ]
```

Behaviour the rebuild must keep:

- **`lang={contentLanguage}` on every piece of pack material**, including the answer boxes. A Dutch
  passage is announced as Dutch by a screen reader and spellchecked as Dutch even when the interface
  is English — which is [ADR-0005](../../architecture/decisions/0005-ui-language-vs-content-language.md)
  holding on the page.
- **Drafts are kept in `localStorage`**, keyed `sc.draft.{lessonId}`, debounced 400 ms, restored on
  mount only, and cleared on a successful submit. Losing a page of carefully written Dutch to a stray
  reload is the kind of thing that stops someone coming back tomorrow. A corrupt draft is not
  surfaced — the learner simply starts fresh.
- **Drafts are not restored once a submission exists**, or the learner would be shown their old
  working copy beside the thing they handed in.
- **Submitting navigates to the session log**, which is where the correction will appear.
- The speaking note is one line, optional, and attached to the submission. It is offered on every
  lesson rather than only on ones with a `speak` section — it is the record that speaking happened,
  not a transcript of it, and a learner who spoke anyway should be able to say so.

## Deliberate refusals

- **No dates, no streaks, no decay.**
- **No auto-submit**, and no partial submit on navigation.
- **No renderer that branches on which pack it is serving.** If a pack needs something rendered
  differently, that is a new section kind with its own renderer, not a conditional in an existing
  one.
- **Reading a lesson records nothing.** There is no "lesson viewed" event, no time-on-page. The
  evidence this product keeps is work handed in and answers given, not attention measured.

## Where the code is

| | |
|---|---|
| Section kinds (the contract) | `api/src/domain/schemas.ts` → `sectionSchema` |
| Next lesson, block completion, answer refs | `api/src/domain/progression.ts` |
| Lessons and blocks | `api/src/services/content.ts`, `progress.ts` |
| Routes | `api/src/http/learner.ts` |
| Screens | `web/src/app/[locale]/(app)/lessons/[lessonId]/page.tsx`, `blocks/[blockId]/page.tsx` |
| Renderers | `web/src/components/section-view.tsx`, `lesson-form.tsx` |
| Strings | `web/src/i18n/dictionaries.ts` → `lesson` |
