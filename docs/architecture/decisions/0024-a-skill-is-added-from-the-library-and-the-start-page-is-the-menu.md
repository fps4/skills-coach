---
title: A skill is added from the library, and the start page is the menu
status: accepted
date: 2026-09-30
amends: 0021
---

# ADR-0024 — A skill is added from the library, and the start page is the menu

## Context

[ADR-0021](0021-the-menu-is-folders-of-skills.md) split the job three ways. The rail showed the
learner's folders, but only those with a shown skill in them. The "All my skills" page listed only
skills already started. And starting a skill was the landing page's job: it listed every published
skill, started ones first, and opening one enrolled the learner.

In use, each of those read as something broken:

- A folder made on "All my skills" did not appear in the rail, because it was empty — so creating
  it looked as if it had failed.
- A newly published skill did not appear on "All my skills", the page named for *all* of them, so
  the learner could not add it where they were organising.
- The start page mixed what the learner is doing with everything they could do, so it stopped
  being the place that says "carry on" once there were more than a few skills.

## Decision

**"All my skills" lists every published skill, and adding one there is what starts it.** Skills in
the menu are grouped by folder, as before. The rest are listed under them with a folder choice and an
**Add** button, which calls `POST /api/v1/me/menu/skills`: it enrols the learner exactly as opening
the skill would, and places the skill shown — in the chosen folder if it still exists, otherwise
outside any. Adding a skill already started shows it again and does not touch its progress.

It is its own route rather than a side effect of `PUT /me/menu`, which keeps its contract: it
reconciles with what has been started and never starts anything.

**Every folder shows in the rail from the moment it exists**, empty or not, with its count.

**The start page is the menu.** One tile per skill that is in the menu and shown, under the learner's
own folder headings in their order. A hidden or not-yet-added skill has no tile; a folder with
nothing shown has no heading there. With nothing shown, the page points to "All my skills".

Opening a skill directly (`GET /api/v1/packs/:packId`) still enrols, so a shared link keeps working.

## Consequences

- There is one place to find and add a skill, and it is the page that organises them.
- The start page no longer advertises new skills. A newly published skill is found on "All my
  skills", not on arrival — acceptable while the catalogue is small and one person publishes it.
- `arrangeRail` no longer drops empty folders; the start page filters them itself, so the two views
  differ on that one point on purpose.
- Moving "All my skills" and "Your data" behind a settings entry is expected next and is not decided
  here.
