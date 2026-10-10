---
title: Flashcards are one engine with two ways of answering
status: accepted
date: 2026-10-10
---

# ADR-0027 — Flashcards are one engine with two ways of answering

## Context

The word trainer practises `term` drill items: type the translation, two right in a row clears a
direction, the reverse direction is gated behind the forward one, a miss resets the streak. Grading
is server-side and tolerant in shape, with an "I was right" override for what tolerance gets wrong.

The owner now wants upskilling decks built from the technical reference guides — concept cards in
English: a term on the front, what it means on the back, with a cue, an analogy to what the learner
already knows, sometimes a code snippet, and where in the guide it came from. The approved design
(the "index card" treatment) puts both kinds of deck on one surface, renamed *Flashcards*.

Three things do not fit the word trainer as it stands:

1. **Typing does not work for concepts.** The back of a concept card is a sentence. Nobody reproduces
   it verbatim, so server-side matching would reject every right answer and the override would become
   the only button anyone presses.
2. **A card has more on it than a word.** A cue, an analogy, a snippet, a source, a section label.
3. **Learners want to study a deck before being tested on it.** The surface has only ever asked.

A second engine for concepts would mean a second streak machine, a second gate, a second deck
summary — exactly the drift `drill-progress.ts` exists to prevent between the word trainer and the
sentence puzzle.

## Decision

1. **One engine.** A concept card is a `term` drill item. It is stored, served, gated and scheduled
   by the code that serves words; `drill-progress.ts` is untouched. Two stages (direction 1 front →
   back, direction 2 back → front), `CLEAR_STREAK` 2, a miss to zero, mastered inert, least-practised
   first. The surface key stays `drills:terms` — it is in every published manifest and renaming it
   would buy nothing but a migration; the route and the name the learner sees become *Flashcards*
   (`/flashcards`, with `/drills/words` redirecting).

2. **A card carries optional fields, one shape everywhere.** `hint` (a cue before answering) and
   `group` (the section label, on the front) sit beside `example`; `analogy`, `code` and `source` join
   the details shown after answering (ADR-0023). The same `TermCardFields` shape is accepted on a
   published drill item, a `vocabulary` row, a learner's own word and a coach's suggestion, and every
   write goes through one `termPayload` builder — a field added there reaches every path. Only `term`
   and `translation` are ever graded.

3. **The pack declares how its cards are answered**: `flashcards: { grading: typed | self }`,
   default `typed`. A manifest that says nothing keeps the Woordtrainer's behaviour exactly.
   - `typed` — today's: tolerant matching on the server, and *Accept anyway* (the override, recorded
     as one).
   - `self` — the learner turns the card over with an explicit **reveal**, then answers
     `{ self: got | missed }`. That verdict enters the same machine as a typed one and the attempt is
     recorded with `selfGraded: true`.

   A self grade is **accepted only on a `self` pack** — a `400` on a typed one, where it would be a
   way round the spelling the deck exists to drill — only on a `term` item, and never with an
   override. The rule is a pure function (`domain/flashcards.ts::checkAnswerMode`) the service calls.

4. **The reveal records nothing.** `POST /drills/:id/reveal { stage }` returns the back of the card
   and writes no attempt and no state; it is logged like any read. It passes the gates an attempt
   passes — someone else's own word is a `404`, a locked direction 2 is a `400` — and it is refused on
   a typed pack, where a card is revealed by answering it. In practice mode `GET /drills` still
   returns prompts and never answers, and a cue that contains the answer of the stage being asked is
   masked, as the example always was in stage 2.

5. **Learn mode** (`GET /drills?mode=learn`) serves each card with its back — answer, cue, analogy,
   code and details, unmasked — and **records nothing**: no attempt, no streak, nothing in drill
   state. It serves only `term` items and still respects the stage gate. Both typed and self-graded
   decks offer it.

   This is a **deliberate exception** to "the browser never sees the answer before the learner
   commits". That rule exists so the page cannot grade, and so a learner cannot be shown an answer
   they did not ask for while being tested. In learn mode nothing is being graded and the learner
   asked to see the answers; the guarantee that matters — that a streak can only be earned by
   answering a card whose back was not on screen — is kept by learn mode writing nothing, and by
   practice mode never carrying the back.

6. **Every action has a key**, shown on its button as a `<kbd>` badge and announced with
   `aria-keyshortcuts`: F or Space show the answer, H the hint, G got it, M missed it, N next card or
   next batch, B back (learn), L learn, P practise, D switch direction; in typed mode Enter checks and
   then advances, A accepts anyway. Keys with Ctrl, ⌘ or Alt are ignored, and so is anything typed
   into an editable field; a typed card's answer box turns read-only after the verdict and keeps
   focus, so N and A work, and Esc leaves the box so the letter keys — the hint among them — can be
   used before answering. The listener is bound while the surface is mounted and removed with it.

## Consequences

**Good.** One machine, so a concept deck and a word deck cannot drift apart in how a card is
cleared. A Woordtrainer learner sees the same deck, the same matching and the same streaks; what
changed for them is the name, the address and the keyboard. A coach publishes a concept deck with
the endpoint and MCP tool they already use. A learner can study a deck in learn mode without
anything they do there counting for or against them.

**Costs.** A self grade is the learner's word, not the server's. That is the nature of a concept
card, and it is recorded as such (`selfGraded`) rather than dressed up as a verdict — the same honesty
that records an override. Mastery on a self-graded deck is advisory, like every rating here
(AGENTS.md), and nothing consequential may be built on it. Learn mode means the back of a card can be
on the page; the protection is that nothing on that page writes. The surface key `drills:terms` and
the API's `translation` field keep their word-trainer names for a card that is not a word — the cost
of not migrating every stored manifest and item.

**Rejected.** A second drill kind (`concept`) with its own engine: it would duplicate the stage gate,
the streak machine and the deck summary for no behavioural difference. Grading mode per card rather
than per pack: a deck mixing typed and self-graded cards would make the same keys mean different
things card to card, and the owner's decks are one or the other. Server-side matching of concept
answers by keyword: it would be wrong in both directions and invite overriding by reflex.
