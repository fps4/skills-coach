/**
 * The MCP endpoint over Streamable HTTP.
 *
 * Thin, like every other route file: check the caller, hand the message to `handler.ts`, send back
 * what it returns. The transport owns three things the core deliberately does not — who the caller
 * is, the discovery challenge that lets a client become one, and the browser-origin check.
 *
 * Responses are plain JSON. The spec allows a server to answer a POST with `application/json`
 * instead of opening an SSE stream, and nothing here streams: a tool call is one request and one
 * answer.
 */

import type { FastifyInstance } from 'fastify';

import { requireAuth, type RequestAuth } from '../auth/plugin.js';
import type { Capability } from '../auth/capabilities.js';
import { forbidden } from '../http/errors.js';
import { resourceMetadataUrl } from '../http/well-known.js';
import type { ServiceContext } from '../services/context.js';
import { handleRpc, type JsonRpcRequest } from './handler.js';

export const MCP_PATH = '/mcp';

/**
 * The capabilities that make a caller a coach rather than a learner.
 *
 * This endpoint is the *coach* surface, so the door is shut to anyone without one of these even
 * though two of the tools behind it are harmless content reads a learner may make elsewhere. Each
 * tool still checks its own capability — this is the outer of two gates, not a replacement for it.
 */
const COACH_CAPABILITIES: Capability[] = ['pack:publish', 'submission:read-all', 'correction:write', 'review:write'];

function requireCoach(auth: RequestAuth): RequestAuth {
  if (!COACH_CAPABILITIES.some((capability) => auth.capabilities.has(capability))) {
    throw forbidden('the MCP endpoint is the coach surface — this token holds no coach capability');
  }
  return auth;
}

export function registerMcpRoutes(app: FastifyInstance, ctx: ServiceContext): void {
  const resource = ctx.config.mcp.resourceUrl;
  if (!resource) return;

  const challenge = `Bearer resource_metadata="${resourceMetadataUrl(resource)}"`;

  /**
   * A 401 from this endpoint has to carry the discovery pointer, or a client has no way to find the
   * authorization server and simply fails.
   *
   * A hook rather than a change to the shared error handler: the 401 is raised by the global auth
   * hook before routing, so a route-scoped handler would never see it — and the error envelope is
   * the whole product's, not this transport's.
   */
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode === 401 && request.url.split('?')[0] === MCP_PATH) {
      reply.header('WWW-Authenticate', challenge);
    }
    return payload;
  });

  app.post(MCP_PATH, async (request, reply) => {
    // DNS-rebinding defence: an agent client sends no Origin, and a browser that does must be one
    // we already trust for CORS. Anything else is a page trying to use someone's ambient session.
    const origin = request.headers.origin;
    if (origin && !ctx.config.corsOrigins.includes(origin)) {
      return reply.status(403).send({ error: { code: 'forbidden', message: `origin ${origin} is not permitted` } });
    }

    const auth = requireCoach(requireAuth(request));
    const body = request.body as JsonRpcRequest | JsonRpcRequest[] | undefined;

    if (Array.isArray(body)) {
      // Batching left the spec in 2025-06-18, and a coaching loop never needed it.
      return reply.status(400).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'batched requests are not supported' },
      });
    }

    const response = await handleRpc(body ?? {}, {
      ctx,
      auth,
      log: (error, message) => request.log.error({ err: error }, message),
    });

    // A notification has no reply, and 202 is how the spec says to say so.
    if (!response) return reply.status(202).send();
    return reply.header('content-type', 'application/json').send(response);
  });

  /**
   * The spec's answer for a server that offers no server-initiated stream and keeps no session:
   * both must be refused explicitly, or a client waits on a connection that will never speak.
   */
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({
      method,
      url: MCP_PATH,
      handler: async (_request, reply) =>
        reply
          .status(405)
          .header('allow', 'POST')
          .send({ error: { code: 'invalid_request', message: 'this endpoint accepts POST only' } }),
    });
  }
}
