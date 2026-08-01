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
  });

  registerErrorHandler(app);

  // Empty in the deployed shape: the browser talks to the web app, which proxies same-origin.
  if (config.corsOrigins.length > 0) {
    await app.register(cors, { origin: config.corsOrigins, credentials: true });
  }

  registerAuth(app, { verifier: options.verifier ?? createVerifier(config.auth), publicPaths: PUBLIC_PATHS });

  const ctx = createContext(store, config, options.now);
  registerOpsRoutes(app, ctx);
  registerLearnerRoutes(app, ctx);
  registerCoachRoutes(app, ctx);

  return app;
}
