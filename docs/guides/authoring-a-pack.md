---
title: Authoring a pack
status: current
date: 2026-08-01
---

# Authoring a pack

A pack is a training program: a manifest, plus one directory per block holding numbered lesson files
and optional drill decks. Everything skill-specific enters the platform this way
([ADR-0004](../architecture/decisions/0004-pack-contract-and-typed-sections.md)) — the runtime never
branches on which pack it is serving.

`packs/demo-conversation-nl/` is a complete worked example, and CI imports it on every run.

## Layout

```
your-pack/
  pack.yaml
  blocks/                     (or blokken/)
    01-introductions/         (or blok-01-introductions/)
      README.md               optional — block title, level, theme, milestone
      les-1.md                or lesson-1.md
      les-2.md
      woordenschat.csv        optional — term drills (or vocabulary.csv, terms.csv)
      zinsvolgorde.csv        optional — word-order drills (or word-order.csv, sentences.csv)
```

Directory and file names are matched case-insensitively against several accepted aliases, so an
existing folder of lessons usually imports without being renamed.

## The manifest

```yaml
packId: your-pack            # lower-case slug; also the URL segment
title: { nl: …, en: … }
contentLanguage: nl          # what the material is written in — never translated (ADR-0005)
translationLanguage: en      # what a term's translation is written in
skill: conversation          # descriptive only
goal: { en: … }              # flows into every next-block brief

framework:
  id: cefr
  levels: [A2, B1.1, B1.2, B2.1]
  ramp:                      # which blocks sit where, and the dials for that stretch
    - fromBlock: 1
      toBlock: 8
      level: B1.1
      phase: Consolidate
      dials: { textLength: "~170 words", grammar: "perfectum, subclause word order" }

errorCategories:             # THE STABLE VOCABULARY — see below
  - id: word-order-sub
    label: { nl: Woordvolgorde bijzin, en: Subclause word order }

sectionMap:                  # optional — override how headings map to section kinds
  - { match: dictee, kind: dictation }

matchArticles:               # optional — leading words ignored when matching an answer
  nl: [de, het, een]
```

The runtime never interprets a dial. It carries them into the brief, so whoever writes the next
block knows which rung they are aiming at.

### `sectionMap` replaces, it does not extend

A manifest's `sectionMap` is used **instead of** the built-in heading map, not in addition to it
(`importer/pack-source.ts`). Declare three entries and `Woordenschat` stops mapping to a vocabulary
section, because the entry that recognised it is no longer in the map. If you need one override,
copy `DEFAULT_SECTION_MAP` from `importer/markdown.ts` in full and add to it — or, better, write
headings the defaults already recognise.

### Committing a manifest

A manifest may live in this repository even though the pack's content may not
([ADR-0008](../architecture/decisions/0008-a-packs-manifest-is-product.md)): the manifest is the
program, the blocks are the learner's content. The grant is per pack, by name, in `.gitignore`, and
only for a manifest that names no person, employer or organisation.

```sh
make validate      # parse and lint every manifest in the tree — also runs in CI
```

The linter checks what the schema cannot: a duplicated error-category id, a ramp step naming a level
the framework does not list, and ramp ranges that overlap or leave a gap. Each of those is resolved
silently at runtime — an overlap means the first step declared wins and the other is unreachable —
so the check is the only place they surface.

### Error categories are a commitment

They are the join key between correction, drilling and next-block generation. **Once a pack is
published, do not rename one.** A rename orphans every existing entry: the old id keeps its history
and never joins anything, while new corrections accumulate under the new one. Adding a category is
always safe.

## Lessons

A lesson is an H1, an optional metadata line, then `##` sections whose headings name what they are:

```markdown
# Les 1 · Introducing yourself

**Niveau:** B1.1 · **Tijd:** ~20 min

## 1. Tekst (lees hardop)

> The passage to read aloud.

## 2. Woordenschat

| Nederlands | English | Voorbeeld |
|---|---|---|
| ingewikkeld | complicated | Dat klinkt ingewikkeld. |

## 3. Begripsvragen

1. Why is this so?

## 4. Schrijf

Write six sentences about yesterday.

- use the perfect tense
```

### The nine section kinds

| Kind | Recognised from | Built from | Produces |
|---|---|---|---|
| `text` | tekst, text, artikel | prose (blockquotes unwrapped) | — |
| `rules` | regels, grammatica, rules | prose | — |
| `vocabulary` | woordenschat, vocabulary | a markdown table | also term drills |
| `questions` | vragen, begripsvragen, bespreek | a numbered list | submission answers |
| `speak` | spreek, speak | prose + bullets as requirements | a self-reported note |
| `write` | schrijf, write | prose + bullets as requirements | **a submission** |
| `listening` | luister, listening | prose + bullets as sources | — |
| `dictation` | dictee, dictation | a numbered list | an answer key |
| `exercise` | oefening, exercise, puzzel | a numbered list; `### Antwoorden` is the key | self-checked |

Matching is by **earliest keyword in the heading**, so "Tekst (lees hardop) — vragen stellen" is a
text section, not a questions one. Add a `sectionMap` entry to override.

Two behaviours worth knowing:

- **An unrecognised heading is kept as text**, and reported as a warning. Losing a lesson's
  structure is recoverable; losing the lesson is not.
- **A heading that maps to a kind it cannot satisfy degrades to text** — a "Zelftest woordenschat"
  heading with no table becomes prose rather than failing the import.

Warnings are always printed. An import that quietly lost something would be worse than one that
complained.

## Drill decks

`woordenschat.csv` — header-aware, so column order does not matter and `Les` is optional:

```csv
Nederlands,English,Voorbeeld,Les
ingewikkeld,complicated,Dat klinkt ingewikkeld.,1
```

`zinsvolgorde.csv` — chunks separated by ` | `:

```csv
Les,Zin,Delen,Vertaling,Tip,DelenB
1,"Morgen begin ik met de cursus.","ik | begin | morgen | met de cursus","Tomorrow I start the course.","Fronting a time phrase inverts subject and verb.","morgen | begin | ik | met de cursus"
```

- **`Delen`** is the primary correct order, and *is* the answer — the trainer shuffles it.
- **`DelenB`** is a second valid order of the **exact same chunks**. If it is not a permutation, it
  is silently ignored and the item becomes single-order; the import reports how many it dropped, so
  a typo is visible. Author chunks in mid-sentence (lower-case) form: whichever lands first is
  capitalised automatically.
- Split subject and verb into separate chunks, or inversion cannot be expressed. Aim for four to
  seven chunks, each an unbreakable unit.

## Importing

```sh
make import PACK=/path/to/your-pack

# a manifest kept apart from content authored elsewhere:
cd api && npm run import:pack -- --source /path/to/content --manifest /path/to/pack.yaml

# see what would happen, and every warning, without publishing:
cd api && npm run import:pack -- --source /path/to/your-pack --dry-run
```

`--only <n>` imports a single block. Publishing is idempotent: identifiers derive from position and
content, so republishing updates in place and a drill item whose text is unchanged **keeps the
learner progress attached to it**.

The importer publishes over HTTP through `/coach/v1`, deliberately — it is just another coach-API
caller, and anything it can do, a person or a service can do too.

## Backfilling an existing error log

For a learner whose history was kept by hand:

```sh
cd api && npm run import:errorlog -- \
  --source /path/to/foutenlog.md --learner <learnerId> --pack your-pack --dry-run
```

This is a migration tool, not part of the loop — it writes counters directly, which nothing else
does. It refuses any heading that does not resolve to a category the pack declares, suggesting what
is available; use `--map "raw heading=declared-id"` for the rest. Run it once: running it again
would double the counts.
