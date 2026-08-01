/**
 * Token verification against identity-service (ADR-0002).
 *
 * This is the only place a token is trusted. The web app's middleware also peeks at `exp` to avoid
 * rendering a page that is about to 401 — that is a convenience, never a substitute for this.
 *
 * We do not re-implement JWKS handling beyond what `jose` provides: `createRemoteJWKSet` caches
 * keys, refetches on an unknown `kid`, and rate-limits those refetches, which is exactly the
 * behaviour a resource server needs.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthConfig } from '../config.js';

export interface Principal {
  subject: string;
  email?: string;
  roles: string[];
  /** A user token from a login, or a machine token from a client-credentials grant. */
  kind: 'user' | 'client';
}

export class TokenError extends Error {
  constructor(
    message: string,
    readonly reason: 'missing' | 'invalid' | 'expired',
  ) {
    super(message);
  }
}

/** The fixed principal used when `AUTH_MODE=dev`. Refused in production by `loadConfig`. */
export const DEV_PRINCIPAL: Principal = {
  subject: 'dev-learner@example.invalid',
  email: 'dev-learner@example.invalid',
  // Both roles, so a contributor can drive the learner surface and the coach API without an IdP.
  roles: ['learner', 'coach'],
  kind: 'user',
};

export interface Verifier {
  verify(token: string): Promise<Principal>;
}

function claimRoles(payload: JWTPayload): string[] {
  const roles = payload['roles'];
  if (Array.isArray(roles)) return roles.filter((role): role is string => typeof role === 'string');
  return [];
}

/**
 * A client-credentials token has no human behind it. identity-service issues those without an
 * `email`, so its absence is the signal — used only for audit attribution, never for authorization.
 */
function principalKind(payload: JWTPayload): 'user' | 'client' {
  return typeof payload['email'] === 'string' ? 'user' : 'client';
}

export function createVerifier(config: AuthConfig): Verifier {
  if (config.mode === 'dev') {
    return { verify: async () => DEV_PRINCIPAL };
  }

  // Non-null: `loadConfig` refuses to build a jwks config without these.
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl as string));

  return {
    async verify(token: string): Promise<Principal> {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.audience,
          clockTolerance: config.clockToleranceSeconds,
        });

        if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
          throw new TokenError('token has no subject', 'invalid');
        }

        return {
          subject: payload.sub,
          email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
          roles: claimRoles(payload),
          kind: principalKind(payload),
        };
      } catch (error) {
        if (error instanceof TokenError) throw error;
        const code = (error as { code?: string }).code;
        if (code === 'ERR_JWT_EXPIRED') throw new TokenError('token expired', 'expired');
        throw new TokenError('token verification failed', 'invalid');
      }
    },
  };
}

/** Pull a bearer token out of an Authorization header. */
export function bearerToken(header: string | undefined): string {
  if (!header) throw new TokenError('missing Authorization header', 'missing');
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') throw new TokenError('expected a Bearer token', 'missing');
  return value.trim();
}
