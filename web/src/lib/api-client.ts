/**
 * Browser-side API access.
 *
 * Requests go to `/api/*` on this same origin — the route handler in `app/api/[...path]/route.ts`,
 * which reads the httpOnly cookie server-side and adds the `Authorization` header. The browser
 * therefore never holds a token.
 *
 * Kept separate from `api.ts` (the server path) so a client component importing this does not drag
 * `next/headers` into the browser bundle.
 */

import type { ApiErrorBody } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

export async function toApiError(response: Response): Promise<ApiError> {
  let code = 'unknown';
  let message = `${response.status} ${response.statusText}`;
  let details: unknown;
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error) {
      code = body.error.code;
      message = body.error.message;
      details = body.error.details;
    }
  } catch {
    // A non-JSON body — keep the status line.
  }
  return new ApiError(response.status, code, message, details);
}

/**
 * True when the call failed because the session behind the httpOnly cookie is gone.
 *
 * Worth distinguishing from any other failure: the middleware only gates *page* requests, so a
 * token that expires while a drill is open surfaces as a failed fetch and nothing navigates. Told
 * "something went wrong", a learner retries forever; told the session expired, they sign in again.
 */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.isUnauthenticated;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  cache?: RequestCache;
}

export async function clientApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Build a query string, dropping anything unset. */
export function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}
