---
title: Vision
status: current
date: 2026-08-01
---

# Vision

## The problem

Skill acquisition that works — a language, a professional certification, a craft — has a shape.
Practice is spaced and repeated. Mistakes are recorded and re-drilled until they stop happening.
Difficulty rises to stay just past comfortable. What comes next is chosen from what actually went
wrong, not from a syllabus written before the learner arrived.

People who do this well end up building it by hand: a folder of lesson notes, a spreadsheet of
vocabulary, a flashcard app, a running list of recurring mistakes, and a conversation partner who
corrects them. It works, and it is almost entirely manual. Every session log is typed twice. Progress
is invisible except as a feeling. The adaptive step — reading months of evidence and deciding what to
teach next — happens only if someone sits down and does it.

The tools that exist take the opposite trade: an app has the scheduling and the progress tracking but
a fixed curriculum, so it cannot teach *your* mistakes, in *your* domain, toward *your* goal.

## What Skills Coach is

A runtime for personal training programs. You bring the program; it runs it, remembers everything,
and does the bookkeeping that adaptation depends on.

It holds the content, schedules the practice, grades everything a rule can grade, keeps a durable
model of what you keep getting wrong, and — when a block ends — assembles the evidence for whoever
writes the next one. That last step is the point: the brief it produces is what turns months of
accumulated mistakes into the specification for what you practise next.

What it deliberately does not do is generate or judge. Authoring lessons and correcting free-form
writing stay outside, behind an API. See
[ADR-0001](../architecture/decisions/0001-runtime-not-agent.md) for why that boundary is where the
value is protected rather than where it is limited.

## Who it is for

**Now:** a learner following a demanding personal program with a coach in the loop — the case that
motivated it is Dutch to a professional standard, with job interviews as the deadline. Someone
willing to do the work daily, who needs the system to remember what they cannot.

**Next:** professional currency — the recurring, evidenced training that regulated roles need, where
the same machinery (spaced practice, error memory, an auditable record of what was covered) is the
requirement rather than a nicety.

## Principles

1. **Lessons, not dates.** Miss a day and you pick up at the next lesson. Nothing falls out of sync,
   because nothing was ever tied to a calendar.
2. **Evidence drives what comes next.** The next block is written from the error log and the ramp, not
   from a plan made before the learner started.
3. **Deterministic where it can be.** Anything a rule can decide is decided by a rule — visibly, the
   same way every time. Judgement is reserved for what genuinely needs it.
4. **The learner's record is the product.** Mistakes, corrections and progress are first-class data a
   person reads, not telemetry.
5. **One skill-agnostic core.** Everything about a particular skill arrives through a pack.

## Explicitly not in scope

- **Generating or correcting content in the runtime** — ADR-0001.
- **Being a general LMS.** No cohorts, enrolment workflows, course catalogues or certificates.
- **Rebuilding spaced repetition as a science project.** The gating rules are the ones the source
  program proved in use; they are deliberately simple.
- **Consequential assessment.** Ratings and mastery signals are advisory learning aids. Skills Coach
  will not produce a persisted competency score about a person that could feed an employment or
  certification decision — see [`../../AGENTS.md`](../../AGENTS.md).
- **Owning identity.** Sign-in, users and roles belong to identity-service — ADR-0002.
- **Speech capture and audio grading.** Speaking practice is real and central, but the learner
  records it themselves and self-reports; the system does not listen. Deferred, not rejected.
