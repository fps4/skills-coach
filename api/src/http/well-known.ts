/**
 * OAuth protected-resource metadata (RFC 9728).
 *
 * This is how an MCP client that arrives with no token finds out who can issue it one: it reads this
 * document, learns which authorization server guards the resource, and starts the flow there. Served
 * unauthenticated, necessarily — requiring a token to discover how to get a token is a closed loop.
 *
 * identity-service publishes the same shape for its own management MCP; this is the mirror of it on
 * the resource side. We are only ever the *resource*: Skills Coach issues nothing and verifies
 * everything (ADR-0002).
 *
 * Served only when `MCP_RESOURCE_URL` is configured, because the document's whole content is that
 * URL. A deployment with no MCP endpoint advertises none.
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from '../services/context.js';

/**
 * Both paths a client may ask for.
 *
 * RFC 9728 says a resource with a path component (`https://host/mcp`) is discovered at
 * `/.well-known/oauth-protected-resource/mcp`, but clients in the wild also try the bare path — so
 * both are served rather than betting on which.
 */
export function wellKnownPaths(resourceUrl: string | undefined): string[] {
  if (!resourceUrl) return [];
  const paths = ['/.well-known/oauth-protected-resource'];
  try {
    const suffix = new URL(resourceUrl).pathname.replace(/\/+$/, '');
    if (suffix && suffix !== '/') paths.push(`/.well-known/oauth-protected-resource${suffix}`);
  } catch {
    // An unparseable URL is a configuration error, not a reason to serve nothing at all.
  }
  return paths;
}

/** The absolute URL of the document, for the `WWW-Authenticate` challenge on a 401. */
export function resourceMetadataUrl(resourceUrl: string): string {
  const paths = wellKnownPaths(resourceUrl);
  const path = paths[paths.length - 1] as string;
  try {
    return `${new URL(resourceUrl).origin}${path}`;
  } catch {
    return path;
  }
}

export function registerWellKnownRoutes(app: FastifyInstance, ctx: ServiceContext): void {
  const resource = ctx.config.mcp.resourceUrl;
  if (!resource) return;

  const document = {
    resource,
    authorization_servers: ctx.config.auth.issuer ? [ctx.config.auth.issuer] : [],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/fps4/skills-coach/blob/main/docs/guides/coach-loop.md',
  };

  for (const path of wellKnownPaths(resource)) {
    app.get(path, async (_request, reply) => {
      // Discovery is public and stable; letting a client cache it saves a round trip per session.
      return reply.header('cache-control', 'public, max-age=3600').send(document);
    });
  }
}
