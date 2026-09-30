---
title: A coach fills in a word the learner asked for; the learner decides what reaches the deck
status: accepted
date: 2026-09-30
---

# ADR-0023 — A coach fills in a word the learner asked for

## Context

Adding a word to the word trainer meant typing its translation and, optionally, an example — and
nothing else a learner needs to actually use the word: its forms (the article and plural of a noun,
the past tense and auxiliary of a verb), its synonyms and opposite, a note on how it behaves. Those are
exactly the things a language model is good at filling in, and exactly the things that make adding a
word tedious enough that people stop doing it.

[ADR-0001](0001-runtime-not-agent.md) rules out the obvious build: the runtime contains no model
client, and "one endpoint that just calls a model" is the exception AGENTS.md names as the one that
would dissolve that boundary. And [ADR-0012](0012-a-learner-may-add-to-their-own-deck.md) promised
that a learner's own words never reach the coach surface.

## Decision

**A word request is a question the runtime holds until a coach answers it.** The learner names a
word, or pastes a list; the runtime stores a request. A coach — a person with an MCP client, or a
worker calling `/coach/v1` — lists the queue and proposes a card for each: translation, example, and
*details* (part of speech, labelled forms, the example's translation, synonyms, antonyms, a note).
The learner reviews it, edits or unticks any line, and accepts — or asks again, or throws it away.

The lifecycle is `requested → suggested → added`, with `discarded` and a retry back to `requested`,
and it is enforced in `domain/term-request.ts`. Nothing is accepted that was not suggested; nothing is
changed once added (the word is edited in the deck from then on); a coach may replace a suggestion
nobody has acted on.

**Accepting is the only way a suggestion reaches a deck**, and it goes through the same `addTerm` a
hand-typed word does. What is added is the suggestion *as the learner edited it*, minus the fields they
left out — assembled by `acceptedTerm`, which drops empty values and takes the example's translation
away with the example. From then on it is an ordinary own word (ADR-0012).

**Details are shown, never graded.** A card's `term` and `translation` are still the only things
matched. The rest is revealed after an answer and on the review screen. The shape is language-neutral
— a past tense and a plural are both just labelled forms — so nothing in it knows it is holding Dutch
(ADR-0004). Hand-added words and archives carry details too.

**What a coach sees is the word, never the learner.** The queue projects the term, the language it is
in, the language to write glosses in, a status and an opaque request id. No learner id, no deck, no
other words. This narrows ADR-0012's promise rather than breaking it: a learner's words still never
reach the coach surface *unless that learner sends one there*, and then only that one.

**Suggesting is its own capability**, `term:suggest`, granted to `coach`. It is not `pack:publish`:
it writes a proposal into one learner's queue, not content into a pack.

## Consequences

**Good.** Adding a word becomes naming it. The runtime still generates nothing, and whatever fills the
cards in can change — a person today, an automated worker later — without the API changing. A wrong
suggestion costs the learner an untick, never a wrong word in their deck, because nothing lands without
their accepting it.

**The cost is latency.** A card is filled in when a coach gets to it, which is seconds with a worker
running and hours without. The surface is built around that: a requested word goes into "waiting",
the learner carries on, and it comes back under "ready to review" — polled only while something is
waiting and the tab is visible. If instant filling becomes a requirement, ADR-0001's "when to
revisit" applies; this API is what a synchronous caller would call, so the learner's side would not
change.

**What this does not decide.** Who runs the worker, and where. The queue and the MCP tools are enough
for a person with Claude to work it by hand today.
