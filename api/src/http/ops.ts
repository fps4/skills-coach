/**
 * Liveness and readiness.
 *
 * They answer different questions, and conflating them is how a deploy hangs: `/health` says the
 * process is up (so the container is not restarted while MongoDB is briefly unavailable), `/ready`
 * says it can actually serve (so a load balancer holds traffic back).
 *
 * Both are unauthenticated — a probe has no token, and neither reveals anything.
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from '../services/context.js';

export const PUBLIC_PATHS = ['/health', '/ready'];

export function registerOpsRoutes(app: FastifyInstance, ctx: ServiceContext): void {
  app.get('/health', async () => ({ status: 'ok', env: ctx.config.env }));

  app.get('/ready', async (_request, reply) => {
    try {
      await ctx.store.db.command({ ping: 1 });
      return { status: 'ready', mongo: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'not-ready', mongo: 'unreachable' });
    }
  });
}
