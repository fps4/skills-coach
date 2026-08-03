/**
 * Runs before any page renders: pick a locale, and gate on a plausible session.
 *
 * The auth check here is a cheap `exp` decode, never a verification — the API verifies properly
 * against the JWKS. Its only job is to avoid server-rendering a page whose API calls are certain to
 * 401, which would surface as a broken page rather than a sign-in prompt. A page rendered on the
 * server cannot recover from that client-side the way a browser-only app could.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale } from './i18n/config';
import { PACK_HEADER, packIdFromUrl } from './lib/pack-scope';
import { AUTH_MODE, DEV_TOKEN, TOKEN_COOKIE, tokenIsFresh } from './lib/session';

/** Paths that never need a session. */
const PUBLIC_SEGMENTS = ['login'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // The API route handler does its own auth; gating it here would break its 401 contract.
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
  const signedIn = AUTH_MODE === 'dev' ? token === DEV_TOKEN : tokenIsFresh(token);

  if (signedIn) {
    // Already signed in — keep them out of the sign-in screen.
    if (isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}`;
      url.search = '';
      return NextResponse.redirect(url);
    }
    return withPackScope(request, pathname);
  }

  if (isPublic) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/login`;
  // Remember where they were headed, so signing in lands them there rather than at the start.
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

/**
 * Tell the shell which pack this URL is inside, before anything renders.
 *
 * The signed-in layout sits above the segment that names the pack, so it cannot work this out for
 * itself — and without it the first paint would use the wrong hue and correct itself a frame later.
 * Deriving it here costs nothing: the middleware already has the URL, and `packIdFromUrl` is the
 * same function the client uses afterwards.
 */
function withPackScope(request: NextRequest, pathname: string): NextResponse {
  const packId = packIdFromUrl(pathname, request.nextUrl.searchParams);
  if (!packId) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set(PACK_HEADER, packId);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except Next internals and static assets. `/api` is matched but returned early above,
  // because excluding it here would also exclude it from future middleware concerns.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};

export const runtime = 'nodejs';

export { DEFAULT_LOCALE };
