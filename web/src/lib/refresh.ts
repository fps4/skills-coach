/**
 * Keeping a session alive by spending the refresh token.
 *
 * Sign-in has always stored one — for thirty days — and nothing ever spent it. So the session died
 * with the access token: mid-drill, with no route back but the sign-in form. This is the piece that
 * makes that expiry invisible.
 *
 * Deliberately free of `next/headers`. The only two places allowed to write a cookie are the
 * middleware (page requests) and a route handler or server action (the drills' fetches), and they
 * write them differently — so what they share is the exchange and the cookie attributes, not the
 * writing. A server component must never call this: it cannot persist the result, and discarding a
 * rotated token is the one way to turn a working session into a dead one.
 *
 * **identity-service rotates — the presented refresh token is single-use**
 * (`service/src/oauth/server.ts`: "Rotate: the presented refresh token is single-use", which also
 * cascades to the session). That is what the grace map below exists for. One navigation fires
 * several requests at once — the document, its RSC payload, a prefetch — all carrying the same
 * lapsed cookie, because none of them has seen the `Set-Cookie` yet. Exchanging it more than once
 * would revoke the chain and sign the learner out, which is precisely the failure this file is here
 * to prevent. So an exchange is remembered against the token that bought it, and everyone still
 * holding that token is handed the same answer.
 */

import { AUTH_MODE, IDENTITY_BASE_URL, IDENTITY_CLIENT_ID, REFRESH_COOKIE, TOKEN_COOKIE, type TokenSet } from './session';

/**
 * `rejected` is terminal — the refresh token is spent, revoked or past its thirty days, and the
 * learner must sign in again. `unavailable` is not: identity-service could not be reached, the
 * token is presumably still good, and destroying the session over a blip would be the wrong call.
 */
export type RefreshOutcome = { status: 'refreshed'; tokens: TokenSet } | { status: 'rejected' } | { status: 'unavailable' };

/** How long a spent refresh token keeps answering with what it bought. */
const ROTATION_GRACE_MS = 60_000;

/**
 * Old refresh token → the exchange it started. Process-local, which is enough: the requests that
 * race are the parallel ones inside a single navigation, and those all run in the same process.
 * Next bundles middleware separately from route handlers, so the two surfaces keep their own map —
 * they cannot collide anyway, because whichever refreshes first leaves a fresh cookie for the other.
 */
const attempts = new Map<string, { at: number; outcome: Promise<RefreshOutcome> }>();

function prune(now: number): void {
  for (const [token, attempt] of attempts) {
    if (now - attempt.at > ROTATION_GRACE_MS) attempts.delete(token);
  }
}

export function refreshSession(refreshToken: string): Promise<RefreshOutcome> {
  if (AUTH_MODE === 'dev' || !IDENTITY_BASE_URL || !IDENTITY_CLIENT_ID) {
    return Promise.resolve({ status: 'rejected' });
  }

  const now = Date.now();
  prune(now);

  const seen = attempts.get(refreshToken);
  if (seen) return seen.outcome;

  const outcome = exchange(refreshToken).then((settled) => {
    // A blip must not be remembered: the token was never spent, so the next request is free to try.
    if (settled.status === 'unavailable') attempts.delete(refreshToken);
    return settled;
  });

  attempts.set(refreshToken, { at: now, outcome });
  return outcome;
}

async function exchange(refreshToken: string): Promise<RefreshOutcome> {
  let response: Response;
  try {
    response = await fetch(`${IDENTITY_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: IDENTITY_CLIENT_ID,
        refresh_token: refreshToken,
      }),
      cache: 'no-store',
    });
  } catch {
    return { status: 'unavailable' };
  }

  // 4xx is a verdict on the token; 5xx is identity-service having a bad day and says nothing about it.
  if (!response.ok) return response.status >= 500 ? { status: 'unavailable' } : { status: 'rejected' };

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return { status: 'unavailable' };
  }

  // Both shapes are in circulation across identity-service's OAuth and SDK surfaces.
  const accessToken = (body.access_token ?? body.accessToken) as string | undefined;
  if (!accessToken) return { status: 'unavailable' };

  return {
    status: 'refreshed',
    tokens: {
      accessToken,
      refreshToken: (body.refresh_token ?? body.refreshToken) as string | undefined,
      expiresIn: (body.expires_in ?? body.expiresIn) as number | undefined,
      refreshExpiresIn: (body.refresh_expires_in ?? body.refreshExpiresIn) as number | undefined,
    },
  };
}

export interface SessionCookie {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAge: number };
}

const ACCESS_FALLBACK_MAX_AGE = 60 * 60 * 8;
const REFRESH_FALLBACK_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * What a token set becomes on the wire. One definition, so sign-in, the middleware and the proxy
 * cannot drift into setting three subtly different cookies for the same session.
 *
 * The access cookie is cut to the token's own lifetime on purpose: when it lapses the browser drops
 * it, and a missing `sc_at` next to a live `sc_rt` is exactly the signal that a refresh is due.
 */
export function sessionCookies(tokens: TokenSet): SessionCookie[] {
  const base = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  } as const;

  const cookies: SessionCookie[] = [
    {
      name: TOKEN_COOKIE,
      value: tokens.accessToken,
      options: { ...base, maxAge: tokens.expiresIn ?? ACCESS_FALLBACK_MAX_AGE },
    },
  ];

  if (tokens.refreshToken) {
    cookies.push({
      name: REFRESH_COOKIE,
      value: tokens.refreshToken,
      options: { ...base, maxAge: tokens.refreshExpiresIn ?? REFRESH_FALLBACK_MAX_AGE },
    });
  }

  return cookies;
}
