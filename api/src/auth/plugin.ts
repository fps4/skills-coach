/**
 * The fastify side of authentication: verify once per request, then let a route declare the
 * capability it needs.
 *
 * Routes never inspect roles. They ask for a capability, which keeps the role → capability map
 * (ADR-0002) the single place that decides what a role means.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../http/errors.js';
import { resolveCapabilities, type Capability } from './capabilities.js';
import { bearerToken, TokenError, type Principal, type Verifier } from './verifier.js';

export interface RequestAuth {
  principal: Principal;
  capabilities: Set<Capability>;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: RequestAuth;
  }
}

export interface AuthPluginOptions {
  verifier: Verifier;
  /** Paths that carry no token at all — health checks and readiness probes. */
  publicPaths: string[];
}

export function registerAuth(app: FastifyInstance, options: AuthPluginOptions): void {
  const { verifier, publicPaths } = options;

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '';
    if (publicPaths.includes(path)) return;

    let principal: Principal;
    try {
      principal = await verifier.verify(bearerToken(request.headers.authorization));
    } catch (error) {
      if (error instanceof TokenError) {
        throw new ApiError('unauthenticated', error.message, { reason: error.reason });
      }
      throw error;
    }

    const { capabilities, unknownRoles, usedDefault } = resolveCapabilities(principal.roles);

    // A role we do not recognise grants nothing — but silence would hide a provisioning mistake,
    // so it is logged every time rather than swallowed.
    if (unknownRoles.length > 0) {
      request.log.warn(
        { subject: principal.subject, unknownRoles },
        'token carries roles this product does not recognise',
      );
    }
    if (usedDefault) {
      request.log.info({ subject: principal.subject }, 'token carries no roles — applying the baseline role');
    }

    request.auth = { principal, capabilities };
  });
}

/** The authenticated caller, or a 401 if the hook did not run. */
export function requireAuth(request: FastifyRequest): RequestAuth {
  if (!request.auth) throw new ApiError('unauthenticated', 'authentication required');
  return request.auth;
}

/** Assert a capability, returning the caller so a route can use it in one expression. */
export function requireCapability(request: FastifyRequest, capability: Capability): RequestAuth {
  const auth = requireAuth(request);
  if (!auth.capabilities.has(capability)) {
    throw new ApiError('forbidden', `this operation requires the ${capability} capability`);
  }
  return auth;
}
