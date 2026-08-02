# Codebase map

Orientation for humans and agents. Read [`GLOSSARY.md`](GLOSSARY.md) first for what the domain terms
mean, then this for where they live.

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
    schemas.ts         zod — the validation boundary for everything entering the system
    matching.ts        tolerant answer comparison
    drill-progress.ts  the stage/streak/mastery machine, shared by both drill kinds
    word-order.ts      order checking, alternative orders, per-chunk marks
    grading.ts         what to ask, what counts, what the learner is told
    error-log.ts       counter and status-transition rules
    progression.ts     next lesson, block completion, answer references
    ramp.ts            position on a pack's competency ramp

  db/                collections, indexes, the Mongo client
  services/          domain rules + persistence, transport-agnostic
  auth/              JWKS verification, role → capability map, fastify plugin
  http/              route definitions only — thin, delegating to services
  importer/          local markdown/CSV → pack payload → coach API
```

**The important line is `domain/`.** Everything that decides whether an answer is right, whether a
streak survives, or whether an error category has become recurring lives there as pure functions with
no dependencies. That is what the unit tests in `api/tests/unit/` pin down, and it is why those tests
are the real specification of the product's behaviour.

`services/` is where domain rules meet the database. Keeping it transport-agnostic is what makes the
planned MCP server additive: it will be a second caller of the same service functions, not a fork.

## `web/` — the learner surface

```
web/src/
  app/[locale]/      all routes live under a locale segment (`nl` | `en`)
    layout.tsx         the document: <html lang>, theme and palette. No chrome.
    (app)/             everything that needs a session — header, rail, content
                       `(app)/page.tsx` is the landing surface: one tile per pack, started
                       ones first, then the rest of the published catalogue
    (auth)/            everything that does not — the centred sign-in surface
  i18n/              typed dictionaries + the locale negotiator
  lib/               api (server) / api-client (browser) / auth (server-only) / session (shared)
    theme/palettes   the hue axis — a palette is data, not code
  components/
    ui/              Button, Card, Input, Textarea — shadcn-shaped, copied not depended on
    atoms.tsx        Pill, Meter, Stat, PageShell — the vocabulary above the primitives
    app-header.tsx   sticky brand header with the accent wordmark
    learner-rail.tsx your packs · lessons · the two drills · progress
  middleware.ts      locale negotiation + auth gate, before render
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
| "answers are matched tolerantly (case, articles, `to …`, `a / b`)" | `domain/matching.ts`, `tests/unit/matching.test.ts` |
| "for anything it wrongly rejects, hit 'I was right'" | `domain/grading.ts` — `override`, recorded as one |
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
