---
title: A skill is a folder, and its guides ship with it
status: accepted
date: 2026-10-11
---

# ADR-0029 — A skill is a folder: `skills/<id>/skill.yaml` and its guides

Amends [ADR-0008](0008-a-packs-manifest-is-product.md) (where a manifest lives) and
[ADR-0028](0028-the-wiki-is-removed.md) (whether any guide is committed). The narrow exception to
[ADR-0006](0006-content-and-learner-data-stay-out-of-the-repo.md) that ADR-0016 granted comes back,
scoped to one skill at a time.

## Context

The upskilling guides became 49 flashcard skills, one per guide (ADR-0027). That was one skill per
technology, which is not how anyone thinks about what they are learning, and the guides themselves
were gone from the app — a learner could practise a card but not read the page it came from. The repo
also said "pack" in one place and "skill" in another for the same thing.

## Decision

- **A skill is a folder.** `skills/<id>/skill.yaml` is the manifest (formerly `packs/<id>/pack.yaml`;
  the schema is unchanged, and the api still calls it a pack). The importer, `validate:manifests`,
  `publish-pack` and `make seed` read `skills/`.
- **Skills are categories, not technologies.** The upskilling material is nine skills —
  architecture & leadership, data modelling, data platforms, data pipelines, streaming & integration,
  governance & compliance, ML & AI engineering, cloud & software engineering, business domains — each
  with one curated deck whose `group`s are concept themes across the technologies in it.
- **Guides ship beside the manifest.** `skills/<id>/guides/*.md` are curated, impersonal reference
  guides with `title` and `summary` frontmatter. The web reads them off disk (`web/src/lib/guides.ts`)
  and shows them on the skill's **Guides** tab at `/guides/<id>` and `/guides/<id>/<slug>`. A skill
  with guides shows the tab whatever its manifest's `surfaces` say.
- **The condition is impersonality, and it is a test.** A guide names no employer, prospective
  employer, client, person, project or job posting, and carries no interview positioning.
  `web/src/lib/guides.test.ts` fails the build on the names and phrasing already known; the full list
  of organisations from the private notes is swept locally before a guide is committed, because
  committing that list would be the leak.
- **Cards are still content.** A deck is published through `/coach/v1` and lives in the database;
  nothing under `skills/` other than `skill.yaml` and `guides/*.md` is committed (the `.gitignore`
  rule is generic, not one stanza per skill). `skills/demo-*` ships whole, as `packs/demo-*` did.

## Consequences

- One mental model: a skill's folder holds what it is (manifest) and what it teaches from (guides);
  its practice material is in the database, written from those guides.
- The web image copies `skills/` to `/skills`, because the shell renders per request and the guide
  pages read the files at runtime.
- The private wiki's copy of the guides is obsolete; the curated copies here are the ones maintained.
