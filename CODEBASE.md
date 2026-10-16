# Codebase map

Orientation for humans and agents. Read [`GLOSSARY.md`](GLOSSARY.md) first for what the domain terms
mean, then this for where they live.

For what each function of the product actually *does* — the flashcards' streak machine, the
quiz's selection rule, the reading library's filters — see
[`docs/product/surfaces/`](docs/product/surfaces/README.md). One file per function, each written to
be enough to rebuild it.

## Two packages, no workspace

`api/` and `web/` each have their own `package.json` and lockfile and are built by their own
Dockerfile. There is deliberately no npm workspace: each image's build context is streamed to the
Docker daemon on the CI runner, and independent lockfiles keep those contexts small and the two
builds genuinely independent.

## `api/` — the runtime

```
api/src/
  config.ts          env → typed config, validated at boot
                     (logging is fastify's built-in pino, configured in app.ts —
                      JSON lines to stdout, ADR-0003)
  app.ts             fastify app factory — wiring only
  index.ts           process entrypoint

  domain/            PURE. No I/O, no database, no fastify. This is the spec.
    types.ts           core entities and the nine section kinds
    pack-text.ts       a skill is written in one language: reading a legacy `{nl, en}` title or label as
                       one string, at the read boundary in services/content.ts (ADR-0026)
    schemas.ts         zod — the validation boundary for everything entering the system
    matching.ts        tolerant answer comparison
    drill-progress.ts  the stage/streak/mastery machine, shared by all drill kinds
    flashcards.ts      a card answered typed or self-graded, per pack; the reveal and learn mode, which
                       record nothing; the one builder every card payload goes through (ADR-0027)
    word-order.ts      order checking, alternative orders, per-chunk marks
    mcq.ts             answer keys: set-equality grading, deterministic option shuffle
    reading.ts         which language variant a learner is shown, and the library's three filters
    quiz.ts            assembling a sitting from weakness, and scoring one
    grading.ts         what to ask (masking a cue that holds the answer), what counts — typed,
                       overridden or self-graded — and what the learner is told
    error-log.ts       counter and status-transition rules
    progression.ts     next lesson, block completion, answer references
    ramp.ts            position on a pack's competency ramp
    menu.ts            the learner's folders of skills: every started skill placed exactly once (ADR-0021)
    term-request.ts    a word asked for, suggested by a coach, accepted by the learner — the lifecycle,
                       and how an accepted card is assembled from suggestion and edits (ADR-0023)
    search.ts          what search finds and how it shows why: a guide as sections anchored the way the
                       page renders them, a card as a document, who may see a result, the snippet's
                       marked words (ADR-0030)
    portable.ts        what a reference is, once it has to outlive a learner id —
                       content digests, and the never-demote merge rule (ADR-0020)

  db/                collections, indexes, the Mongo client
  services/          domain rules + persistence, transport-agnostic
    term-requests.ts   word requests: the learner's queue, and the coach's view of it — which names
                       the word and its languages and never the learner (ADR-0023)
    search.ts          the search index, held in memory: built at boot, told by the services that change
                       cards (`ctx.search.blockChanged`), rebuilt on a timer for writes made by scripts.
                       Derived, never stored (ADR-0030)
    learner-terms.ts   the words a learner adds themselves — owned, private, and
                       untouched by a republish (ADR-0012)
    error-log.ts       the ONE place counters are written — a coach's correction and a
                       wrong answer against a key both go through it (ADR-0014)
    reading.ts         a learner's own library of articles: parallel text, loaded for one
                       person, and read state kept apart from the content (ADR-0017)
    quiz.ts            sittings: start, answer, finish. Grading delegates to drills.ts,
                       so a question answered in a sitting and one answered outside it
                       move identical state
    skill-migration.ts forking a programme's words and reading into skills of their own — copies
                       every learner's words, progress and library, never deletes (ADR-0022)
    pack-removal.ts    deleting a pack *with* everyone's history in it — reachable only through
                       `remove-pack --including-history`, never through an API (ADR-0022)
    archive.ts         a learner's work in and out of a file: gathers everything of
                       theirs, carries no pack material and no owner-scoped id, and
                       re-derives every reference on the way back in (ADR-0020)
  auth/              JWKS verification, role → capability map, fastify plugin
  http/              route definitions only — thin, delegating to services
  mcp/               the same coach surface as tools — `handler.ts` is transport-agnostic,
                     `route.ts` is the fastify bridge (ADR-0010)
  importer/          local markdown/CSV → pack payload → coach API
                     (also `validate-manifests.ts`, the linter CI runs over every
                      committed `skills/*/skill.yaml` — ADR-0008, ADR-0029)
                     `migrate-to-skills.ts` runs services/skill-migration.ts; `remove-pack.ts` deletes a
                      pack — both inside the api container, via the `maintain-skills` workflow
                     `reading-source.ts` / `import-reading.ts` are the same idea for a
                      library: `<slug>.<lang>.md` files → articles → coach API
```

**The important line is `domain/`.** Everything that decides whether an answer is right, whether a
streak survives, or whether an error category has become recurring lives there as pure functions with
no dependencies. That is what the unit tests in `api/tests/unit/` pin down, and it is why those tests
are the real specification of the product's behaviour.

`services/` is where domain rules meet the database. Keeping it transport-agnostic is what made the
MCP server additive: `mcp/tools.ts` is a second caller of the same service functions, behind the same
capability gate and writing the same audit trail, not a fork.

## `web/` — the learner surface

```

skills/<id>/         one folder per skill (ADR-0029): `skill.yaml` is the manifest, `guides/*.md` the
                     curated reference guides its cards are written from. Cards are content and are
                     not here; `skills/demo-*` is the one skill committed whole

web/src/
  app/               no locale segment — the interface is English only (ADR-0025)
    layout.tsx         the document: <html lang="en">, theme and palette. No chrome.
    (app)/             everything that needs a session — header, rail, content
                       `(app)/page.tsx` is the landing surface: one tile per pack, started
                       ones first, then the rest of the published catalogue
    (auth)/            everything that does not — the centred sign-in surface
  i18n/              the one English dictionary — chrome strings in one typed place
  lib/               api (server) / api-client (browser) / auth (server-only) / session (shared)
    refresh.ts       spending the rotating refresh token — middleware and route handler only (ADR-0011)
    theme/palettes   the hue axis — a palette is data, not code
    menu.ts          grouping the rail by the learner's menu — pure, unit-tested
    legacy-locale.ts which old `/nl/…` `/en/…` paths the middleware redirects — pure, unit-tested
    search.ts        where a search result leads, how results group, which keys reach for the bar (ADR-0030)
    guides.ts        a skill's guides, read off `skills/<id>/guides/` (server-only, ADR-0029); its test
                     is the impersonality guard over every committed guide
  components/
    ui/              Button, Card, Input, Textarea — shadcn-shaped, copied not depended on
    atoms.tsx        Pill, Meter, Stat, PageShell — the vocabulary above the primitives
    app-header.tsx   sticky brand header with the accent wordmark, the search bar, and sign-out
    search-bar.tsx   search as you type, a popover of the best results, `/` and ⌘K to reach it (ADR-0030)
    search-result.tsx one result's title, where it lives, and its snippet — shared by the bar and `/search`
    learner-rail.tsx the learner's menu: their folders, then the skills in them — two levels, never three
    skill-header.tsx a skill's name, its folder, and its surfaces as tabs (ADR-0021)
    menu-editor.tsx  "All my skills": folders, which folder a skill is in, and what shows
    flashcards.tsx   the flashcard surface: practise (typed or self-graded) and learn, one card at a
                     time, every action on a key (ADR-0027). The keyboard map and the status line are
                     pure, in lib/flashcards.ts
    own-words.tsx    the entry form for your own words, under a typed deck
    word-assist.tsx  "Add cards": ask a coach to fill cards in, then review each one before it lands
    term-card.tsx    a word's example, forms, synonyms and note — shown once it has been answered
    read-toggle.tsx  marking an article read, and putting it back. Never inferred from scrolling
    quiz-runner.tsx  the practice-test surface: practice / exam modes, an optional clock
    quiz-results.tsx score, per-category breakdown, and every question back for review
    ui/option-list.tsx  radio or checkbox options, and the per-question strip
  middleware.ts      old /nl/ and /en/ URLs redirected + session renewal + auth gate, before render
```

**Styling is token-driven (ADR-0007).** Components name roles — `bg-background`, `text-primary`,
`border-border` — never colours. The tokens are CSS variables in `app/globals.css`; two independent
attributes compose over them, `data-theme` (dark by default, light opt-in) and `data-palette` (four
hues, changing only primary/accent/ring). A component that hardcodes a colour breaks the system for
everything downstream and nothing will warn you, so watch for it in review.

Pages are server components calling `lib/api.ts` (which reaches the api service directly); the drill
surfaces are client components calling `lib/api-client.ts`, which goes through
`app/api/[...path]/route.ts` — a route handler that turns the httpOnly session cookie into an
`Authorization` header. Grading is **server-side**, so the browser never learns the answer before
the learner does.

The `lib` split is load-bearing: anything importing `next/headers` cannot be reached from a client
component, so server-only code lives in `api.ts`/`auth.ts` and shared facts in `session.ts`.

**The `(app)` / `(auth)` split is the auth gate, not a folder preference.** Route groups do not
appear in the URL, so this is free structurally, and it buys the one guarantee CSS cannot: the header
and rail exist only inside `(app)/layout.tsx`, which awaits `currentToken()` before it returns
anything. A visitor without a session never receives markup containing them, so there is nothing to
hide and nothing to flash. Put a new route in the group that matches whether it needs a session, and
add public paths to `PUBLIC_SEGMENTS` in the middleware.

## Where the rules from the original program live

The Dutch program this replaces specified its drill behaviour in prose. Those specifications are now
executable:

| Original prose | Now |
|---|---|
| "2 correct in a row → the word is hidden" | `domain/drill-progress.ts`, `tests/unit/drill-progress.test.ts` |
| "EN→NL is gated behind NL→EN" | same — the `stage` concept, one machine for both drills |
| "a wrong answer resets that word's streak to 0" | same |
| "answers are matched tolerantly (case, articles, `to …`, `a / b`)" | `domain/matching.ts`, `tests/unit/matching.test.ts` — a key listing several meanings (`/`, `,`, `;`) is satisfied by any one of them |
| "for anything it wrongly rejects, hit 'I was right'" | `domain/grading.ts` — `override`, recorded as one; labelled *Accept anyway* on the flashcards (ADR-0027) |
| "DelenB must be a permutation of the same chunks, else ignored" | `domain/word-order.ts::usableAlternative` |
| "↔ ook goed Nederlands — but this round we practise the other order" | same — `otherValidOrder` in the result |
| "each part turns green/red so you see where the order went wrong" | same — `marks` |
| "3+ 🔁 in a category → re-drill next block" | `domain/error-log.ts`, `tests/unit/error-log.test.ts` |
| "2 blocks with no new error → ✅, drops out of active drills" | same |
| "the top-3 recurring categories drive the next block's grammar theme" | same — `topRecurring` |

## Conventions

- **Docs change in the same PR as the code they describe.** This is part of the DoD.
- Modules that implement a decision carry a header comment naming the ADR. Keep that link when
  editing — it is how the *why* survives.
- ADRs are `docs/architecture/decisions/NNNN-*.md`, zero-padded, never renumbered.
- `domain/` must not import from `db/`, `services/`, `http/` or `fastify`. A lint rule enforces this.
- Every route is thin: validate, call a service, map errors. No business logic in `http/`.
