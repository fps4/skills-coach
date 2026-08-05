/**
 * Runs before any page renders: pick a locale, renew the session if it has lapsed, and gate.
 *
 * The auth check here is a cheap `exp` decode, never a verification — the API verifies properly
 * against the JWKS. Its only job is to avoid server-rendering a page whose API calls are certain to
 * 401, which would surface as a broken page rather than a sign-in prompt. A page rendered on the
 * server cannot recover from that client-side the way a browser-only app could.
 *
 * **The renewal belongs here** rather than in the render for the same reason the gate does. This is
 * the last point in a page request that may still write a cookie, so it is the only place that can
 * spend a rotating refresh token safely (`lib/refresh.ts`). By the time a server component asks for
 * a token it is too late to get a new one, so the middleware makes sure it never has to.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale } from './i18n/config';
import { PACK_HEADER, packIdFromUrl } from './lib/pack-scope';
import { refreshSession, sessionCookies, type SessionCookie } from './lib/refresh';
import { AUTH_MODE, DEV_TOKEN, REFRESH_COOKIE, TOKEN_COOKIE, tokenIsFresh } from './lib/session';

/** Paths that never need a session. */
const PUBLIC_SEGMENTS = ['login'];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // The API route handler does its own auth *and* its own renewal; gating it here would break its
  // 401 contract, and refreshing here would race its own exchange for the same rotating token.
  if (pathname.startsWith('/api/')) return NextResponse.next();

  const segments = pathname.split('/').filter(Boolean);
  const locale = isLocale(segments[0]) ? segments[0] : null;

  // No locale in the path — negotiate one and redirect, so every URL is unambiguous.
  if (!locale) {
    const chosen = negotiateLocale(
      request.cookies.get(LOCALE_COOKIE)?.value,
      request.headers.get('accept-language') ?? undefined,
    );
    const url = request.nextUrl.clone();
    url.pathname = `/${chosen}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  const rest = segments.slice(1);
  const isPublic = rest.length > 0 && PUBLIC_SEGMENTS.includes(rest[0] as string);

  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  let signedIn = AUTH_MODE === 'dev' ? token === DEV_TOKEN : tokenIsFresh(token);

  // The lapsed access token is not the end of the session — the refresh token outlives it by weeks.
  let renewed: SessionCookie[] = [];
  let spent = false;
  if (!signedIn && AUTH_MODE !== 'dev') {
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (refreshToken) {
      const outcome = await refreshSession(refreshToken);
      if (outcome.status === 'refreshed') {
        renewed = sessionCookies(outcome.tokens);
        signedIn = true;
      } else {
        // Only a verdict on the token clears it. An outage sends them to sign-in for now, but
        // leaves the cookie alone so the session survives identity-service coming back.
        spent = outcome.status === 'rejected';
      }
    }
  }

  /** Whatever this request answers with, the renewal has to ride along on it. */
  const finish = (response: NextResponse): NextResponse => {
    for (const cookie of renewed) response.cookies.set(cookie.name, cookie.value, cookie.options);
    if (spent) {
      response.cookies.delete(TOKEN_COOKIE);
      response.cookies.delete(REFRESH_COOKIE);
    }
    return response;
  };

  if (signedIn) {
    // Already signed in — keep them out of the sign-in screen.
    if (isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}`;
      url.search = '';
      return finish(NextResponse.redirect(url));
    }
    return finish(forward(request, pathname, renewed));
  }

  if (isPublic) return finish(NextResponse.next());

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/login`;
  // Remember where they were headed, so signing in lands them there rather than at the start.
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return finish(NextResponse.redirect(url));
}

/**
 * Hand the render what it needs that the incoming request does not already carry: which pack this
 * URL is inside, and — after a renewal — the token the browser has not been told about yet.
 *
 * The pack scope is here because the signed-in layout sits above the segment that names the pack,
 * so it cannot work this out for itself, and without it the first paint would use the wrong hue and
 * correct itself a frame later. Deriving it costs nothing: the middleware already has the URL, and
 * `packIdFromUrl` is the same function the client uses afterwards.
 *
 * Rewriting the cookie header matters just as much. A `Set-Cookie` on the response only reaches the
 * *next* request; without this, the very render that triggered the renewal would still read the
 * expired token and 401 its way to a broken page.
 */
function forward(request: NextRequest, pathname: string, renewed: SessionCookie[]): NextResponse {
  const packId = packIdFromUrl(pathname, request.nextUrl.searchParams);
  if (!packId && renewed.length === 0) return NextResponse.next();

  const headers = new Headers(request.headers);
  if (packId) headers.set(PACK_HEADER, packId);

  if (renewed.length > 0) {
    const fresh = new Map(renewed.map((cookie) => [cookie.name, cookie.value]));
    const jar = request.cookies.getAll().map(({ name, value }) => [name, fresh.get(name) ?? value] as const);
    for (const [name, value] of fresh) {
      if (!jar.some(([existing]) => existing === name)) jar.push([name, value]);
    }
    headers.set('cookie', jar.map(([name, value]) => `${name}=${value}`).join('; '));
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except Next internals and static assets. `/api` is matched but returned early above,
  // because excluding it here would also exclude it from future middleware concerns.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};

export const runtime = 'nodejs';

export { DEFAULT_LOCALE };
