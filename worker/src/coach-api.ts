/**
 * The worker's only way into Skills Coach: `/coach/v1`, with a coach token (ADR-0001, ADR-0034).
 *
 * The token comes from the realm's client-credentials grant and is held until shortly before it
 * expires. A 401 drops it, so a rotated secret or a revoked token heals on the next cycle.
 */
import type { QueuedTermRequest, TermSuggestion } from './card.js';

export interface CoachApiConfig {
  apiUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

export class CoachApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class CoachApi {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly config: CoachApiConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async listRequested(limit: number): Promise<QueuedTermRequest[]> {
    const body = (await this.call('GET', `/coach/v1/term-requests?status=requested&limit=${limit}`)) as {
      requests: QueuedTermRequest[];
    };
    return body.requests;
  }

  async suggest(requestId: string, suggestion: TermSuggestion): Promise<void> {
    await this.call('PUT', `/coach/v1/term-requests/${encodeURIComponent(requestId)}/suggestion`, suggestion);
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.accessToken();
    const response = await fetch(new URL(path, this.config.apiUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401) this.token = undefined;
    if (!response.ok) {
      throw new CoachApiError(response.status, `${method} ${path.split('?')[0]} → ${response.status}`);
    }
    return response.json();
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new CoachApiError(response.status, `token request → ${response.status}`);

    const body = (await response.json()) as { access_token?: string; accessToken?: string; expires_in?: number };
    const value = body.access_token ?? body.accessToken;
    if (!value) throw new CoachApiError(response.status, 'token response carried no access token');
    // A minute's margin, so a token never expires between being read and being sent.
    const lifetime = Math.max((body.expires_in ?? 300) - 60, 30);
    this.token = { value, expiresAt: this.now() + lifetime * 1000 };
    return value;
  }
}
