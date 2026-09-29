# Documentation

Start with [`../CODEBASE.md`](../CODEBASE.md) for the repository map and
[`../GLOSSARY.md`](../GLOSSARY.md) for what the domain words mean.

## Product — why this exists

- [`product/vision.md`](product/vision.md) — the problem, who it is for, what is explicitly not in scope
- [`product/prd/0001-dutch-conversation-coach.md`](product/prd/0001-dutch-conversation-coach.md) — the first pack, and what M0 must do
- [`product/surfaces/`](product/surfaces/README.md) — **one spec per function**, each complete enough
  to rebuild that function: the Woordtrainer, the Zinspuzzel, the Oefentoets, the reading library,
  the lesson reader, the session log, progress and the rail, the wiki, and the portable archive

## Architecture — how it is built

- [`architecture/overview.md`](architecture/overview.md) — system context and containers
- [`architecture/data-model.md`](architecture/data-model.md) — collections, relationships, indexes

### Decisions

| ADR | Decision |
|---|---|
| [0001](architecture/decisions/0001-runtime-not-agent.md) | The runtime generates nothing; coaching enters through an API |
| [0002](architecture/decisions/0002-identity-service-as-authentication-engine.md) | identity-service authenticates; Skills Coach authorizes |
| [0003](architecture/decisions/0003-mongodb-single-store.md) | One MongoDB; logs to stdout; audit as a collection |
| [0004](architecture/decisions/0004-pack-contract-and-typed-sections.md) | Skills enter through a pack contract; lessons are typed sections |
| [0005](architecture/decisions/0005-ui-language-vs-content-language.md) | UI language and content language are separate |
| [0006](architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md) | Content and learner data never enter the repository |
| [0007](architecture/decisions/0007-token-driven-theme-with-a-palette-axis.md) | One token theme, two independent axes (theme × palette) |
| [0008](architecture/decisions/0008-a-packs-manifest-is-product.md) | A pack's manifest is product; its blocks are content |
| [0009](architecture/decisions/0009-per-pack-presentation-is-declarative.md) | A pack declares how it presents itself; the viewer resolves it |
| [0010](architecture/decisions/0010-mcp-is-a-second-transport.md) | MCP is a second transport over the same services, hand-written |
| [0011](architecture/decisions/0011-sessions-renew-where-cookies-can-be-written.md) | Sessions renew where cookies can be written |
| [0012](architecture/decisions/0012-a-learner-may-add-to-their-own-deck.md) | A learner may add words to their own deck |
| [0013](architecture/decisions/0013-nightly-backups-run-from-the-host.md) | Nightly backups run from the host |
| [0014](architecture/decisions/0014-an-authored-answer-key-may-write-the-error-log.md) | An authored answer key may write the error log |
| [0015](architecture/decisions/0015-a-block-may-be-owned-by-a-learner.md) | A block may be owned by a learner |
| [0016](architecture/decisions/0016-the-reference-library-ships-with-the-code.md) | The reference library ships with the code |
| [0017](architecture/decisions/0017-reading-is-personalized-parallel-text.md) | Reading is personalized parallel text; the interface language selects the variant |
| [0018](architecture/decisions/0018-the-rail-is-packs-one-level-deep.md) | ~~The rail is packs, one level deep; a pack lands on its progress~~ — superseded by 0021 |
| [0019](architecture/decisions/0019-a-surface-appears-when-the-pack-has-material-for-it.md) | A surface appears when the pack has material for it |
| [0020](architecture/decisions/0020-a-learner-can-take-their-progress-with-them.md) | A learner can take their progress with them |
| [0021](architecture/decisions/0021-the-menu-is-folders-of-skills.md) | The menu is folders of skills; a skill's surfaces are its tabs |
| [0022](architecture/decisions/0022-a-skill-can-be-only-a-deck-or-a-library.md) | A skill can be only a deck or only a library, and a programme's can be forked out of it |

## Reference

- [`api/endpoints.md`](api/endpoints.md) — every route, its capability, and its shapes

## Guides

- [`guides/setup.md`](guides/setup.md) — running it locally
- [`guides/authoring-a-pack.md`](guides/authoring-a-pack.md) — the pack format and the importer
- [`guides/teaching-method.md`](guides/teaching-method.md) — how a block should be built, and why;
  the didactic half of authoring
- [`guides/coach-loop.md`](guides/coach-loop.md) — driving Skills Coach as the external coach
- [`guides/authoring-with-an-agent.md`](guides/authoring-with-an-agent.md) — the same loop over MCP,
  written for the model doing the authoring
- [`guides/deployment.md`](guides/deployment.md) — the ds1 pipeline and what it needs

## Conventions

Docs change in the same pull request as the code they describe — see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md). ADRs are numbered and never renumbered; superseding one
means writing a new ADR that says so.
