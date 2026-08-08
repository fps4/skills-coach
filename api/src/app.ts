/**
 * Application assembly. Wiring only — no logic lives here.
 *
 * Exported separately from `index.ts` so tests can build an app against a test database without
 * starting a listener or touching the process environment.
 */

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Store } from './db/client.js';
import { registerAuth } from './auth/plugin.js';
import { createVerifier, type Verifier } from './auth/verifier.js';
import { registerErrorHandler } from './http/errors.js';
import { registerCoachRoutes } from './http/coach.js';
import { registerLearnerRoutes } from './http/learner.js';
import { PUBLIC_PATHS, registerOpsRoutes } from './http/ops.js';
import { registerWellKnownRoutes, wellKnownPaths } from './http/well-known.js';
import { registerMcpRoutes } from './mcp/route.js';
import { createContext } from './services/context.js';

export interface BuildOptions {
  config: Config;
  store: Store;
  /** Overridden by tests to inject a principal without minting a real token. */
  verifier?: Verifier;
  now?: () => Date;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const { config, store } = options;

  const app = Fastify({
    // JSON lines to stdout (ADR-0003) — the container runtime is the log pipeline.
    logger: { level: config.logLevel },
    // The web app proxies `/api/*` server-side, so requests arrive from the Next server, not the
    // browser. Trusting the proxy is what makes client IPs in the log meaningful.
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    // Fastify defaults this to 100 characters, and an article id is `packId.hash.slug` where the
    // slug is the source article's own — `accelerate-amazon-s3-replication-with-automated-s3-batch-
    // operations-parallelizat` is 112 and entirely ordinary for a blog. Over the limit the router
    // stops matching the route and answers 414 before auth or any handler runs, so the article is
    // not merely unreadable, it is unreachable. Raised rather than shortening the id: the id is
    // readable on purpose, and it is already in learners' read marks and their bookmarks.
    maxParamLength: 512,
  });

  registerErrorHandler(app);

  // Empty in the deployed shape: the browser talks to the web app, which proxies same-origin.
  if (config.corsOrigins.length > 0) {
    await app.register(cors, { origin: config.corsOrigins, credentials: true });
  }

  registerAuth(app, {
    verifier: options.verifier ?? createVerifier(config.auth),
    // Discovery has to be readable without a token — that is the whole point of it (RFC 9728).
    // The list is exact-match, so each path is named in full rather than matched by prefix.
    publicPaths: [...PUBLIC_PATHS, ...wellKnownPaths(config.mcp.resourceUrl)],
  });

  const ctx = createContext(store, config, options.now);
  registerOpsRoutes(app, ctx);
  registerWellKnownRoutes(app, ctx);
  registerLearnerRoutes(app, ctx);
  registerCoachRoutes(app, ctx);
  // Only when a resource URL is configured, so a deployment without an MCP endpoint is byte for
  // byte the app it was before this existed.
  registerMcpRoutes(app, ctx);

  return app;
}
