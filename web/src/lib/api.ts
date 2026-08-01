import 'server-only';

/**
 * Server-side API access.
 *
 * Server components reach the api service directly over the internal network, attaching the token
 * from the httpOnly cookie. No browser hop, and no token ever leaves the server.
 *
 * Client components use `api-client.ts` instead, which goes through the same-origin route handler.
 */

import { AUTH_MODE, DEV_TOKEN } from './session';
import { currentToken } from './auth';
import { ApiError, toApiError, type RequestOptions } from './api-client';

/** Where the api service lives from *inside* the container network. Runtime, not build time. */
export const API_INTERNAL_URL = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8010';

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = AUTH_MODE === 'dev' ? DEV_TOKEN : await currentToken();
  if (!token) throw new ApiError(401, 'unauthenticated', 'no usable token');

  const response = await fetch(`${API_INTERNAL_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // Learner state changes constantly; nothing here is worth caching by default.
    cache: options.cache ?? 'no-store',
  });

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export { ApiError, query } from './api-client';
