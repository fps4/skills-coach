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

/** The current access token, if the request carries a usable one. */
export async function currentToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(TOKEN_COOKIE)?.value;
  return tokenIsFresh(token) ? (token as string) : null;
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
  };

  // identity-service has both snake_case (OAuth) and camelCase (SDK) shapes in circulation.
  const accessToken = body.access_token ?? body.accessToken;
  if (!accessToken) throw new SignInError('no access token in the response', 'unavailable');

  return { accessToken, refreshToken: body.refresh_token ?? body.refreshToken, expiresIn: body.expires_in };
}

export async function setSession(tokens: TokenSet): Promise<void> {
  const store = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = tokens.expiresIn ?? 60 * 60 * 8;

  store.set(TOKEN_COOKIE, tokens.accessToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge });
  if (tokens.refreshToken) {
    store.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export { AUTH_MODE, DEV_TOKEN } from './session';
