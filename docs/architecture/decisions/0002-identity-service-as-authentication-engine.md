---
title: identity-service authenticates; Skills Coach authorizes
status: accepted
date: 2026-08-01
---

# ADR-0002 — identity-service as the authentication engine

## Context

Skills Coach needs sign-in, and it needs to tell a learner from a coach. Building either would mean a
user store, credential handling, password reset and an admin surface — all of it duplicating
[identity-service](https://github.com/fps4/identity-service), which exists to be the shared IdP and
already ships that surface for every consuming product.

identity-service's own [resource-server integration
guide](https://github.com/fps4/identity-service/blob/main/docs/guides/resource-server-integration.md)
defines the contract: it asserts identity and app-scoped roles and gates entitlement at issuance;
consuming products verify the token and make their own authorization decisions.

## Decision

Skills Coach is a **resource server**. It:

1. **Verifies tokens at the edge** — RS256 signature against the JWKS, plus `iss`, `aud` and `exp`.
   Extracts `sub`, `email` and `roles`.
2. **Stores no identity.** The `learners` collection is a thin profile keyed on `sub` (display name,
   UI language preference). No credentials, no role grants, no user administration UI.
3. **Owns its role → capability map** in `api/src/auth/capabilities.ts`, and enforces capabilities on
   every protected operation. `learner` gets practice and submission capabilities; `coach` gets
   publish, queue-read and correction capabilities.
4. **Never calls back to identity-service to make an authorization decision.** Everything needed is
   on the verified token.
5. **Defaults safely.** An unrecognised role maps to no capabilities and is logged. An absent `roles`
   claim means the user is entitled to the app but granted nothing specific, and is treated as
   `learner` — the documented baseline.

Roles are app-scoped, so Skills Coach's role vocabulary is simply its application's catalogue in
identity-service. No namespacing is needed.

**Local development runs `AUTH_MODE=dev`**, which injects a fixed stub principal instead of verifying
a token. That keeps the contributor setup to `make up` without an IdP. It is refused when
`NODE_ENV=production`, so it cannot be switched on by accident in a deployment.

## Consequences

**Good.** No credential handling in this codebase, so no credential-handling bugs. User and role
administration is already built, in the place that owns that data. Adding a role or granting access
is operator configuration in identity-service, not a code change here.

**Costs.** A hard runtime dependency: the JWKS endpoint must be reachable from the api container. On
ds1 that means joining identity-service's Docker network, because the public host is
Cloudflare-fronted and unreachable from inside — hence `infra/docker/compose.ds1.networks.yml`.
Role and entitlement changes also take effect no sooner than the next token refresh; instant
revocation would need introspection or shorter TTLs, deferred until a deployment demands it.

We deliberately do **not** depend on `@fps4/identity-service-react` for the login UI: it publishes to
`npm.pkg.github.com`, and a public repository should not require registry credentials to build. The
web app implements the password grant against identity-service's HTTP endpoints directly, in
`web/src/lib/auth.ts`.
