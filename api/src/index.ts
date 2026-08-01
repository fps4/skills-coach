/**
 * Process entrypoint: load configuration, connect, apply indexes, listen, shut down cleanly.
 */

import { buildApp } from './app.js';
import { loadConfig, ConfigError } from './config.js';
import { connect, ensureIndexes } from './db/client.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Before the logger exists, so this is the one place stderr is written directly.
    process.stderr.write(`${error instanceof ConfigError ? error.message : String(error)}\n`);
    process.exit(1);
    return;
  }

  const store = await connect(config.mongoUri, config.mongoDb);
  // Idempotent, and applied at boot rather than by a migration runner (ADR-0003).
  await ensureIndexes(store.db, config.auditRetentionDays);

  const app = await buildApp({ config, store });

  if (config.auth.mode === 'dev') {
    app.log.warn('AUTH_MODE=dev — every request runs as the stub principal. Never use this in a deployment.');
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ env: config.env, db: config.mongoDb, authMode: config.auth.mode }, 'skills-coach api listening');
}

main().catch((error) => {
  process.stderr.write(`failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
