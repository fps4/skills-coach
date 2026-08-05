/**
 * The API proxy for browser-side calls.
 *
 * This exists so the access token can stay in an httpOnly cookie. A Next `rewrites()` proxy would
 * forward the request but could not turn that cookie into the `Authorization: Bearer` header the
 * API requires — and putting the token somewhere JavaScript can read it, purely to add a header,
 * would trade away the reason for the httpOnly cookie in the first place.
 *
 * Only the learner API is reachable this way. `/coach/v1` is not proxied: the coach surface is a
 * separate caller with its own client credentials, and exposing it through a learner's browser
 * session would let a learner with the coach role publish content from a page (ADR-0002).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { API_INTERNAL_URL } from '@/lib/api';
import { AUTH_MODE, DEV_TOKEN } from '@/lib/session';
import { ensureToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Only these prefixes are proxied. Everything else is refused. */
const ALLOWED_PREFIXES = ['v1/'];

function unauthorized(): NextResponse {
  return NextResponse.json({ error: { code: 'unauthenticated', message: 'sign in again' } }, { status: 401 });
}

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const suffix = path.join('/');
  if (!ALLOWED_PREFIXES.some((prefix) => suffix.startsWith(prefix))) {
    return NextResponse.json({ error: { code: 'not_found', message: `not proxied: /${suffix}` } }, { status: 404 });
  }

  // A route handler may write cookies, so this is allowed to renew rather than merely read. It is
  // what keeps a drill alive when the token lapses between one answer and the next.
  const token = AUTH_MODE === 'dev' ? DEV_TOKEN : await ensureToken();
  if (!token) return unauthorized();

  const target = `${API_INTERNAL_URL}/api/${suffix}${request.nextUrl.search}`;
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();

  const response = await fetch(target, {
    method: request.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': request.headers.get('content-type') ?? 'application/json' }),
    },
    body,
    cache: 'no-store',
  });

  const text = await response.text();
  return new NextResponse(text || null, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context): Promise<NextResponse> {
  return proxy(request, (await context.params).path);
}
export async function POST(request: NextRequest, context: Context): Promise<NextResponse> {
  return proxy(request, (await context.params).path);
}
export async function PATCH(request: NextRequest, context: Context): Promise<NextResponse> {
  return proxy(request, (await context.params).path);
}
export async function DELETE(request: NextRequest, context: Context): Promise<NextResponse> {
  return proxy(request, (await context.params).path);
}
