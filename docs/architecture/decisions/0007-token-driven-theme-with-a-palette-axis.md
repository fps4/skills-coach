---
title: One token theme, two independent axes
status: accepted
date: 2026-08-01
---

# ADR-0007 — A token-driven theme with a palette axis

## Context

The learner surface is used for an hour a day, often in the evening, and it is read rather than
skimmed. It also has to work for packs that are not language packs at all, in deployments that may
want to look like themselves rather than like us.

The first cut styled components directly — colours chosen per component, light-first, following the
operating system's preference. It worked, but re-skinning meant editing every component, and there
was no way to answer "can this look different for a different deployment" short of a rewrite.

There was also a working answer available: an earlier iteration of this product had already settled
a design system — a dark ground with an orange accent, semantic tokens, shadcn-style primitives, and
a left rail. Reusing a system that has been lived with beats re-deriving one.

## Decision

**Everything visual is driven by CSS variables, and components name roles rather than colours.**

`bg-background`, `text-primary`, `border-border`, `text-muted-foreground` — never a hex value, never
a Tailwind palette shade. The tokens live in `web/src/app/globals.css`, mapped to semantic Tailwind
names in `tailwind.config.ts`. Re-skinning the product is a change to those values and nothing else.

Tokens are stored as bare HSL channels rather than finished colours, which is what makes opacity
modifiers work: `bg-primary/10`, `border-destructive/40`.

**Two axes compose, and they are independent:**

| Axis | Attribute | What it changes |
|---|---|---|
| Theme | `data-theme="dark\|light"` | the neutral surfaces |
| Palette | `data-palette="orange\|blue\|emerald\|violet"` | *only* the hue tokens — primary, accent, ring |

Neutrals and the status colours (success, destructive) are shared across palettes, so a palette
change cannot make "wrong" stop reading as wrong. Both attributes are applied by a pre-paint script
before React hydrates, so there is no flash of the wrong colours, and both persist per browser.

**Dark is the default, and the app does not follow the operating system.** The theme is an explicit
choice with an explicit toggle. A learner reading Dutch prose for an hour should get the ground the
product was designed on, not whatever their laptop decided this morning.

**Primitives are shadcn-shaped** — `Button` with variants, `Card` with header/title/content, `Input`
and `Textarea`, combined through a `cn()` helper that merges conflicting Tailwind classes. Small,
copied into the repository rather than depended upon, and free to diverge.

## Consequences

**Good.** A new palette is a data entry in `lib/theme/palettes.ts` with no build step and no
component change. A deployment that wants its own look changes token values. Because components
never name a colour, "does this work in light mode / in violet" stops being a per-component
question. Semantic status colours stay legible on both grounds by construction.

**Costs.** Two axes mean four combinations to keep honest, and only the default is exercised
routinely — a palette that reads badly in light mode would not be caught by CI. The indirection also
has a real cost when debugging: what you see in dev tools is `hsl(var(--primary))`, not a colour,
and tracing it back is a step of work.

Committing to dark-first means a learner who wants light has to find the toggle once. That is a
deliberate trade against following `prefers-color-scheme`, and it is the decision most likely to be
revisited if it annoys people.

**Discipline required.** The moment a component hardcodes a colour, the system is broken for
everything downstream and nothing will fail to warn you. Review for it.
