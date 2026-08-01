/**
 * Session facts that are safe everywhere: middleware, route handlers, server and client components.
 *
 * Deliberately free of `next/headers` and of any Node API. Cookie *reading* and *writing* need a
 * server context and live in `auth.ts`; what a token means does not, and putting it here is what
 * keeps the middleware from dragging server-only code into the edge bundle.
 */

export const TOKEN_COOKIE = 'sc_at';
export const REFRESH_COOKIE = 'sc_rt';

/** `dev` skips sign-in entirely; the API is running with its stub principal. */
export const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE === 'component-auth' ? 'component-auth' : 'dev';
export const IDENTITY_BASE_URL = process.env.NEXT_PUBLIC_IDENTITY_BASE_URL ?? '';
export const IDENTITY_CLIENT_ID = process.env.NEXT_PUBLIC_IDENTITY_CLIENT_ID ?? '';

/** The value used in dev mode. The API accepts any bearer when AUTH_MODE=dev. */
export const DEV_TOKEN = 'dev';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Decode `exp` without verifying — the API verifies properly against the JWKS. This only decides
 * whether it is worth rendering a page, never whether a request is allowed.
 */
export function tokenIsFresh(jwt: string | undefined): boolean {
  if (!jwt) return false;
  if (AUTH_MODE === 'dev') return jwt === DEV_TOKEN;

  const payload = jwt.split('.')[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const decoded = JSON.parse(json) as { exp?: number };
    if (!decoded.exp) return false;
    // A little leeway, so a token about to expire counts as expired rather than producing a page
    // that 401s halfway through rendering.
    return decoded.exp * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
}
