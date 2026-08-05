---
title: Sessions renew where cookies can be written
status: accepted
date: 2026-08-05
---

# ADR-0011 — Sessions renew where cookies can be written

## Context

identity-service issues a **15-minute** access token and a **30-day** refresh token
(`OAUTH_ACCESS_TOKEN_TTL_SEC`, `OAUTH_REFRESH_TOKEN_TTL_SEC`). Sign-in stored both — and nothing ever
spent the second one. So the session ended with the access token: a quarter of an hour, then the
sign-in form, typically in the middle of a drill. The learner surface was the only thing that
noticed, and all it could say was "Er ging iets mis".

Two facts constrain where the fix can live.

**Only some places may write a cookie.** Next allows it in middleware, a route handler and a server
action. A server component render may not. So the obvious shape — refresh lazily, wherever a token is
next needed — is not available: `lib/api.ts` runs inside renders.

**identity-service rotates.** `oauth/server.ts` marks the presented refresh token revoked before
minting the replacement — "the presented refresh token is single-use" — and revocation cascades to
the session. A refresh whose result is discarded therefore does not fail harmlessly; it destroys the
session it was trying to save. That rules out refreshing anywhere the outcome cannot be persisted,
and it makes concurrent refreshes of the same token actively dangerous rather than merely wasteful.

## Decision

**Renewal happens in exactly two places, both of which can persist the result.**

1. **`middleware.ts`, for page requests.** It already decodes `exp` to gate; now, when the access
   token has lapsed and a refresh token is present, it spends it before deciding. The new cookies go
   on the response *and* on the forwarded request headers — a `Set-Cookie` only reaches the next
   request, so without the rewrite the very render that triggered the renewal would still read the
   expired token.
2. **`app/api/[...path]/route.ts`, for the drills' fetches.** A page can be perfectly valid when it
   renders and lapse while the learner works. The proxy calls `ensureToken()`, which refreshes and
   writes; server components keep the read-only `currentToken()`.

**`lib/refresh.ts` owns the exchange, and remembers it for 60 seconds.** One navigation fires several
requests at once — document, RSC payload, prefetch — all carrying the same lapsed cookie, because
none has seen the `Set-Cookie` yet. Each is keyed on the token it presented and handed the same
outcome, so the chain is spent once.

**A failure to reach identity-service is not a verdict on the token.** The outcome is three-valued:
`refreshed`, `rejected` (4xx — spent, revoked, or past thirty days: clear the cookies) and
`unavailable` (network error or 5xx: gate this request, but leave the session intact and do not
remember the attempt).

## Consequences

**Good.** A learner signs in once and stays signed in for the session's absolute 30-day lifetime.
Nothing in the drills, the lessons or the progress surfaces has to know a token exists.

**Costs.** The middleware may now make a network call — once per access-token lifetime, on the one
request that finds the cookie gone. The grace window is process-local memory, which is enough because
the requests that race are the parallel ones inside a single navigation; it is not a distributed
lock, and this deployment is a single container.

The session's 30 days are **absolute**, not sliding: `issueUserTokens` reuses the existing session's
`expiresAt` across refreshes. Thirty days after signing in, a learner signs in again — which is when
the expired-session prompt in `drill-chrome.tsx` is the honest answer rather than a papered-over
failure, and why it stays.
