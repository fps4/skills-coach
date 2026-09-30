---
title: The menu is folders of skills; a skill's surfaces are its tabs
status: accepted; amended by 0024
date: 2026-09-29
supersedes: 0018
---

# ADR-0021 — The menu is folders of skills

## Context

[ADR-0018](0018-the-rail-is-packs-one-level-deep.md) made the rail two levels: a pack, then the
surfaces that pack offers. It assumed a learner works through a few large programmes — a Dutch
B1→B2 course, a certification — and that the rail's job was to name the one in scope.

That is not how the product is going to be used. Packs are becoming small and narrowly focused: a
word trainer, a set of strong verbs, a reading list, one exam domain. A learner will have many of
them, study a handful at a time, and want to group them the way they think about them — "Dutch",
"AWS" — rather than the way they were published. A flat list of every started pack does not survive
that, and a third level of nesting (folder → pack → surface) is where a sidebar stops being
readable.

The word *pack* no longer fits either. It suggests a bundle you download, not a thing you practise.

## Decision

**What the learner sees is called a skill.** `pack` stays the word in code, in the API and in the
archive format: a coach still publishes a pack, `packId` is still the reference an exported file
carries ([ADR-0020](0020-a-learner-can-take-their-progress-with-them.md)), and renaming either would
break every archive already written. The glossary records the mapping.

**The rail is two levels: a folder, then the skills in it.** Folders are the learner's own — they
create, name, order and delete them. A skill may also sit outside any folder.

**Each skill is shown or hidden.** Hidden skills leave the menu and wait on an "All my skills" page,
progress intact; the rail says how many are hidden. Starting a *new* skill is still the landing page's
job, not the menu's.

**A skill's surfaces are tabs on its own page, not items in the rail.** The page opens on an
overview (what ADR-0018 called landing on its progress), and the lessons, reading, word trainer,
sentence puzzle and practice test follow as tabs. Which tabs appear is decided exactly as the rail
items were — [ADR-0019](0019-a-surface-appears-when-the-pack-has-material-for-it.md)'s three questions,
answered in `web/src/lib/pack-scope.ts` and nowhere else.

**The arrangement belongs to the learner, never to a pack.** It is stored as `menu` on the learner
document — folders in order, and one placement per started skill naming its folder and whether it is
hidden. A pack has no idea which folder it is in, and no manifest field can put it anywhere.

One rule keeps that safe, and it lives in `api/src/domain/menu.ts::normalizeMenu`: **every skill the
learner has started is placed exactly once.** It is applied on read as well as on write, so a skill
started since the menu was saved shows up loose, a placement for a skill they left is dropped, and a
placement naming a folder that no longer exists moves out of it. Deleting a folder therefore never
hides or loses a skill; its skills stay where they were in the order, outside any folder.

The menu is written whole (`PUT /api/v1/me/menu`), the way a profile is. Moving one skill changes the
order of the others, and a patch language for that would be more code than the menu itself.

## Consequences

**Good.** A learner with thirty small skills sees the five they are studying. Grouping is theirs, so
it can follow how they think rather than how a coach published. The rail regains a level for folders
by giving up one that belonged on the skill's page anyway: the tabs sit next to the content they
switch between, and a phone — which never had the rail — now gets them too.

**The cost.** A skill's surfaces are one click further from anywhere outside that skill: getting to
the practice test of another skill means opening it first. The rail used to indent them only for the
skill in scope, so this is the same number of clicks as before for everything but the skill already
open.

**The menu travels in the archive.** It names skills by `packId`, which is portable already, so a
restored file puts folders back as they were; a folder naming a skill this system does not have
simply shows without it.

**What stays from ADR-0018.** The landing page lists what can be started; the wiki and the archive
sit beside the menu, not in it; `progress` remains an accepted key in a manifest's `surfaces` that
the viewer ignores; a skill opened for the first time is not in the rail until the next render.
