# Guides

A skill's reference guides — the material its flashcards were written from
([ADR-0029](../../architecture/decisions/0029-a-skill-is-a-folder-with-its-guides.md)).

## What the learner sees

A **Guides** tab on the skill, beside Flashcards, whenever the skill has at least one guide. It opens a
list (title and one-line summary, alphabetical) at `/guides/<skillId>`; a guide renders as an article
at `/guides/<skillId>/<slug>`, with headings anchored and code highlighted. Nothing is recorded —
guides are reference, not practice. A card's `details.source` names the guide and section it came
from, so a learner who misses a card knows where to read.

### Practise what this guide teaches

When the skill declares topics with `guides`
([ADR-0032](../../architecture/decisions/0032-a-skill-declares-its-topics.md)), the foot of a guide
lists the topics practised from it — each with `mastered/total` and a bar — and each opens
`/flashcards?blockId=…&topic=…`. The overview's topic tiles link back to the guide, so reading and
practising are one click apart both ways. No such topics, or an api that cannot answer, and the guide
renders without the footer.

## Where they come from

`skills/<id>/guides/*.md`, committed beside the manifest. Each starts with:

```
---
title: Data Vault 2.0 with dbt
summary: Hubs, links and satellites, and how dbt builds them.
---
```

The web reads the folder on the server (`web/src/lib/guides.ts`); the image carries `skills/` at
`/skills`. There is no api for guides and no per-learner state. The api image carries the same folder
for one reason: [search](search.md) indexes the guides, section by section
([ADR-0030](../../architecture/decisions/0030-search-is-lexical-and-held-by-the-api.md)).

## The condition

A guide is impersonal: no employer, prospective employer, client, person, project or job posting, and
no interview positioning. `web/src/lib/guides.test.ts` fails the build on the known names and phrasing.

| | |
|---|---|
| Screens | `web/src/app/(app)/guides/[packId]/page.tsx`, `guides/[packId]/[slug]/page.tsx` |
| Topics a guide is practised in | `topicsOfGuide` in `web/src/lib/topics.ts` |
| Loader | `web/src/lib/guides.ts` |
| Tab | `SURFACES.guides` in `web/src/lib/pack-scope.ts` |
