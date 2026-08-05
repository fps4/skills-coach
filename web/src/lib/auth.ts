import 'server-only';

/**
 * Sign-in against identity-service, and the cookie handling around it.
 *
 * Server-only: it reads and writes cookies, which needs a request context. What a token *means*
 * lives in `session.ts`, so the middleware and the client can use that without pulling this in.
 *
 * Written here rather than pulled from `@fps4/identity-service-react`, which publishes to
 * `npm.pkg.github.com` — a public repository should not need registry credentials to build
 * (ADR-0002).
 *
 * The access token lives in an **httpOnly** cookie, so page code and browser JavaScript can never
 * read it. That is also why the API is reached through a route handler rather than a rewrite: the
 * handler can turn the cookie into an `Authorization` header, and a rewrite cannot.
 */

import { cookies } from 'next/headers';
import { refreshSession, sessionCookies } from './refresh';
import {
  AUTH_MODE,
  DEV_TOKEN,
  IDENTITY_BASE_URL,
  IDENTITY_CLIENT_ID,
  REFRESH_COOKIE,
  TOKEN_COOKIE,
  tokenIsFresh,
  type TokenSet,
} from './session';

export class SignInError extends Error {
  constructor(
    message: string,
    readonly reason: 'credentials' | 'unavailable' | 'not-configured',
  ) {
    super(message);
  }
}

/**
 * The current access token, if the request carries a usable one.
 *
 * Read-only, and that is load-bearing. A server component render may not write cookies, so it must
 * not refresh either — identity-service rotates, and a refresh whose result cannot be persisted
 * revokes the chain and kills the session. Renders rely on the middleware having refreshed first;
 * anything that may legally write cookies calls `ensureToken()` instead.
 */
export async function currentToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(TOKEN_COOKIE)?.value;
  return tokenIsFresh(token) ? (token as string) : null;
}

/**
 * The access token, refreshed first if it has lapsed.
 *
 * **Only from a route handler or a server action** — it writes cookies. This is what keeps a drill
 * alive: the page was fine when it rendered, the token expired while the learner was working, and
 * the next fetch quietly renews it instead of failing.
 */
export async function ensureToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(TOKEN_COOKIE)?.value;
  if (tokenIsFresh(token)) return token as string;

  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;

  const outcome = await refreshSession(refreshToken);
  if (outcome.status !== 'refreshed') {
    // Spent or revoked: drop the cookies so the next page request goes straight to sign-in rather
    // than paying for a refresh that cannot succeed. An outage leaves them be — it may yet work.
    if (outcome.status === 'rejected') await clearSession();
    return null;
  }

  for (const cookie of sessionCookies(outcome.tokens)) {
    store.set(cookie.name, cookie.value, cookie.options);
  }
  return outcome.tokens.accessToken;
}

/** The OAuth password grant against identity-service. */
export async function signIn(email: string, password: string): Promise<TokenSet> {
  if (AUTH_MODE === 'dev') return { accessToken: DEV_TOKEN };
  if (!IDENTITY_BASE_URL || !IDENTITY_CLIENT_ID) {
    throw new SignInError('identity-service is not configured', 'not-configured');
  }

  let response: Response;
  try {
    response = await fetch(`${IDENTITY_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'password', client_id: IDENTITY_CLIENT_ID, username: email, password }),
      cache: 'no-store',
    });
  } catch {
    throw new SignInError('could not reach identity-service', 'unavailable');
  }

  if (!response.ok) throw new SignInError('sign-in rejected', 'credentials');

  const body = (await response.json()) as {
    access_token?: string;
    accessToken?: string;
    refresh_token?: string;
    refreshToken?: string;
    expires_in?: number;
    refresh_expires_in?: number;
  };

  // identity-service has both snake_case (OAuth) and camelCase (SDK) shapes in circulation.
  const accessToken = body.access_token ?? body.accessToken;
  if (!accessToken) throw new SignInError('no access token in the response', 'unavailable');

  return {
    accessToken,
    refreshToken: body.refresh_token ?? body.refreshToken,
    expiresIn: body.expires_in,
    refreshExpiresIn: body.refresh_expires_in,
  };
}

export async function setSession(tokens: TokenSet): Promise<void> {
  const store = await cookies();
  for (const cookie of sessionCookies(tokens)) {
    store.set(cookie.name, cookie.value, cookie.options);
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export { AUTH_MODE, DEV_TOKEN } from './session';
