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

`skills/demo-conversation-nl/` is a complete worked example, and CI imports it on every run.

## Layout

```
your-skill/
  skill.yaml
  guides/                     optional, committed — curated reference guides (ADR-0029)
    some-topic.md             frontmatter `title` + `summary`; impersonal, no employer or person names
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
title: Dutch in conversation  # one string — a skill is written in one language (ADR-0026)
contentLanguage: nl          # what the material is written in — never translated (ADR-0005)
translationLanguage: en      # what a term's translation is written in
skill: conversation          # descriptive only
goal: …                      # flows into every next-block brief

framework:
  id: cefr
  levels: [A2, B1.1, B1.2, B2.1]
  ramp:                      # which blocks sit where, and the dials for that stretch
    - fromBlock: 1
      toBlock: 8
      level: B1.1
      phase: Consolidate
      dials: { textLength: "~170 words", grammar: "perfectum, subclause word order" }

method:                      # optional — how the material should be taught, see below
  principles: ["Every lesson makes the learner produce, not only read."]
  lessonArc: [input, form, controlled practice, pushed output]
  rules: { newTermsPerLesson: "8–12, as chunks with the article" }
  sequencing: { article: "drilled as a chunk, never taught as a rule" }

errorCategories:             # THE STABLE VOCABULARY — see below. Optional for a skill with
                             # nothing to correct: a word deck, a reading list (ADR-0022)
  - id: word-order-sub
    label: Subclause word order

sectionMap:                  # optional — override how headings map to section kinds
  - { match: dictee, kind: dictation }

matchArticles:               # optional — leading words ignored when matching an answer
  nl: [de, het, een]

presentation:                # optional — how the pack presents itself past the landing page
  palette: blue
  icon: message-circle
  tagline: …
  surfaces: [lessons, drills:terms, drills:word-order]
```

Every text field — `title`, `description`, `goal`, `tagline`, a category's `label` and `group`, and
a block's or lesson's `title` — is **one string**, never one per language
([ADR-0026](../architecture/decisions/0026-a-skill-is-written-in-one-language.md)). The material is in
`contentLanguage`; the name and labels are read inside the English interface, so they are usually
English. A `{ nl: …, en: … }` value is refused with a message saying so.

The runtime never interprets a dial. It carries them into the brief, so whoever writes the next
block knows which rung they are aiming at.

### Method

`method` is the other half of that: the ramp says how *hard* the next block should be, `method` says
how it should be *built* — the lesson arc, how much new vocabulary a lesson carries, how much of the
previous block to recycle, and the sequencing notes for topics that fail when taught in the obvious
order.

Every field is optional and every value is free text. `rules` and `sequencing` are open records, like
a ramp's `dials`, for the same reason: a language pack, a certification syllabus and a craft do not
share a lesson shape. The runtime carries the whole block into `get_brief` under `pack.method` and
parses none of it — the author is the one who acts on it.

The principles worth declaring, and where they come from, are in
[the teaching method](teaching-method.md). Declare in the manifest only what is specific to *this*
pack; the general half is platform, and repeating it per pack means it drifts.

### Presentation

`presentation` is how a pack asks to look and what it offers
([ADR-0009](../architecture/decisions/0009-per-pack-presentation-is-declarative.md)). The landing
tiles stay generic; this governs everything after them.

| Key | Behaviour when unrecognised |
|---|---|
| `palette` | falls back to the default hue, silently — it is a key into the viewer's registry |
| `icon` | falls back to a default icon |
| `tagline` | shown under the pack title |
| `surfaces` | **fails the publish** — a closed set, because the runtime must be able to render it |

**Omitting `surfaces` means all of them.** A pack opts *out* of a surface, never in, so a manifest
with no `presentation` at all renders exactly like every pack does today. Leave out
`drills:word-order` and the rail stops offering it.

**You only have to declare what you want hidden, not what you have not got.** A surface the pack has
no material for is absent whether or not the manifest names it — no word-order sentences, no
Zinspuzzel ([ADR-0019](../architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md)).
Declaring is how you hide a surface you *do* have material for. A surface with material but nothing
to open yet — a block still being written — renders disabled rather than disappearing.

**`progress` is no longer one of them.** The rail is the learner's packs, and what a pack offers one
level under it; a pack lands on its own progress, so progress is not an item beside the others
([ADR-0018](../architecture/decisions/0018-the-rail-is-packs-one-level-deep.md)). The key is still
accepted — a manifest that names it keeps publishing — and moves nothing. Leave it out of new packs.

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

A committed manifest is published on its own, without blocks — that is what makes the pack exist in
a deployment at all:

```sh
cd api && npm run import:pack -- --source ../skills/your-skill --manifest-only --dry-run
```

On ds1 that is the `publish-pack` workflow rather than a local run, because the api binds to
loopback there: `gh workflow run publish-pack.yml -f pack=your-pack -f dry_run=false`.

The linter checks what the schema cannot: a duplicated error-category id, a ramp step naming a level
the framework does not list, and ramp ranges that overlap or leave a gap. Each of those is resolved
silently at runtime — an overlap means the first step declared wins and the other is unreachable —
so the check is the only place they surface.

### Error categories are a commitment

They are the join key between correction, drilling and next-block generation. **Once a pack is
published, do not rename one.** A rename orphans every existing entry: the old id keeps its history
and never joins anything, while new corrections accumulate under the new one. Adding a category is
always safe.

## A skill that is only a deck, or only a reading list

Not every skill is a course ([ADR-0022](../architecture/decisions/0022-a-skill-can-be-only-a-deck-or-a-library.md)).
`skills/woordtrainer-nl` is only a word deck and `skills/data-modelling` only a deck of concept
flashcards: no lessons, no error categories, and a `surfaces` list naming the one thing each does.
A reading-list skill is the same idea with `surfaces: [reading]`.

- **A deck skill** keeps every learner's words in one block with no lessons — its deck block,
  `woordenlijst`, order 1. The words are all learners' own (ADR-0012), so nothing is authored into it
  and no publish can touch them. `npm run migrate:to-skills` creates the deck block the first time it
  runs; publishing a block with `lessons: []` does the same.
- **A library skill** needs no block at all. Articles arrive per learner through `load-reading.yml`,
  exactly as before.

Forking a programme's words and reading into such skills, and removing the programme afterwards, is
the `maintain-skills` workflow — see ADR-0022 for what each task copies and what it deletes.

## A flashcards skill

Every `term` drill item is a flashcard, and one surface practises them all
([ADR-0027](../architecture/decisions/0027-flashcards-are-one-engine-with-two-ways-of-answering.md)).
What a manifest decides is **how its cards are answered**:

```yaml
flashcards:
  grading: self      # or typed — the default, and what a manifest that says nothing gets

presentation:
  surfaces: [drills:terms]   # the flashcard surface; its key predates the name
```

- **`typed`** — the learner types the back and the server matches it tolerantly, with *Accept
  anyway* for what the matching gets wrong. Right for words: a word has one spelling, and direction 2
  exists to drill it. The Woordtrainer is typed.
- **`self`** — the learner turns the card over and says *Got it* or *Missed it*. Right for concepts:
  the back is a sentence nobody would reproduce verbatim, so matching it would only ever be wrong.
  `skills/data-modelling` is self-graded.

Both run the same machine: two in a row clears a direction, direction 2 opens only after direction
1, a miss resets the streak, mastered is final. Both offer **learn mode**, which shows every card
with its answer and records nothing.

**Topics.** A card's `group` is its topic, and a deck can be practised one topic at a time from the
overview's tiles ([ADR-0031](../architecture/decisions/0031-a-deck-is-practised-by-topic.md)). Declare
them in the manifest, in learning order, and every card names one by id
([ADR-0032](../architecture/decisions/0032-a-skill-declares-its-topics.md)):

```yaml
flashcards:
  grading: self
  topics:
    - id: data-vault-mechanics
      title: Data Vault mechanics
      description: Hubs, links, satellites, hash keys, PIT and bridge tables.
      guides: [data-vault-2-dbt]   # slugs of files in guides/ — validate:manifests checks them
```

A published card under an undeclared topic is refused. Renaming a topic is a change to its `title`;
the `id` stays, and with it every card and link.

**The cards are content and are never committed** (ADR-0006). A coach writes them — for an upskilling
deck, from the reference guides — and publishes them into the skill's deck block: order 1, no
lessons, `drillItems` only. Through the coach API or the MCP `publish_block` tool:

```jsonc
{
  "order": 1, "slug": "deck", "title": "Deck", "lessons": [],
  "drillItems": [
    { "payload": {
        "kind": "term",
        "term": "Widget join",
        "translation": "Matching two widget lists on a shared key.",
        "hint": "Works like a zipper.",
        "group": "Basics",
        "details": {
          "analogy": "Like a SQL inner join, but for widgets.",
          "code": "left JOIN right USING (key)",
          "source": "Widgets guide · Joining"
        } } }
  ]
}
```

What each field is for — only `term` and `translation` are ever graded, the rest is shown:

| Field | Shown | What to put in it |
|---|---|---|
| `term` | front, direction 1 | The term as practitioners write it. Its text is the card's identity: change it and the card is new, and its streak does not follow. |
| `translation` | back, direction 1; front, direction 2 | The meaning — for a concept, one sentence, at most two. What it does, not only what it is called. |
| `hint` | behind *Hint*, before answering | A cue, not the answer. The runtime masks the answer out of it in whichever direction would give it away, but write it so it does not need to. |
| `group` | above the front | The guide's section, so a deck reads in the order the guide teaches. |
| `example` | after answering (the hint, when there is no `hint`) | A sentence that uses the term. |
| `details.analogy` | after answering, as *Map onto what you know* | The idea in terms the learner already has — and where the comparison stops holding. |
| `details.code` | after answering, monospace | A short snippet, when seeing it is faster than reading about it. Indentation is kept. |
| `details.source` | after answering, as *From the guide · …* | Where in the source the card came from, so a disputed card is checkable. |
| `details.note`, `forms`, `synonyms`, `antonyms`, `partOfSpeech`, `exampleTranslation` | after answering | A word's card, as before ([ADR-0023](../architecture/decisions/0023-a-coach-fills-in-a-word-the-learner-asked-for.md)). |

The same fields are accepted on a `vocabulary` row, on a learner's own word, and on a coach's
suggestion for a word a learner asked for — a card is one shape wherever it is written.

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
cd api && npm run import:pack -- --source /path/to/content --manifest /path/to/skill.yaml

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

## Handing an old pack's blocks to their learner

A pack published before [ADR-0015](../architecture/decisions/0015-a-block-may-be-owned-by-a-learner.md)
has blocks nobody owns, which means everyone in the pack sees lessons written about one person's job:

```sh
cd api && npm run migrate:block-ownership -- --pack your-pack --learner <learnerId> --dry-run
```

It gives every unowned block in the pack to that learner and **changes no identifier**, so streaks,
submissions and reviews stay attached — which is also why it is safe to re-run, and why it is a
`$set` rather than a republish. Words the learner added themselves are left alone. The learner must
have signed in at least once, because that is what creates their record.

If the pack was a fork made only to give somebody their own domain, fold it back — republish its
blocks into the original pack under a `learnerId`, then:

```sh
cd api && npm run remove:pack -- --pack the-fork --dry-run
```

which refuses outright if anyone has submitted, been corrected, or built a streak in it. History is
archived, never deleted.
