/**
 * The word worker (ADR-0034): polls the word-request queue and fills each word in through
 * `/coach/v1`, as a coach would over MCP.
 *
 * A worker started without its secrets (the Anthropic key, the coach client secret) does not
 * crash-loop: it says once which are missing and waits to be stopped, so a deploy can bring it up
 * before they are put in place.
 */
import { CoachApi } from './coach-api.js';
import { WordWorker, type Logger } from './worker.js';
import { ClaudeCardWriter } from './writer.js';

const env = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim() || fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

const log: Logger = {
  info: (msg, fields) => write(30, msg, fields),
  warn: (msg, fields) => write(40, msg, fields),
  error: (msg, fields) => write(50, msg, fields),
};

function write(level: number, msg: string, fields: Record<string, unknown> = {}): void {
  // pino's line shape, so the worker's logs read like the api's.
  process.stdout.write(`${JSON.stringify({ level, time: Date.now(), name: 'word-worker', msg, ...fields })}\n`);
}

const POLL_MS = Number(env('WORKER_POLL_SECONDS', '5')) * 1000;
const MODEL = env('WORKER_MODEL', 'claude-opus-5-5');
const API_KEY = process.env.ANTHROPIC_API_KEY?.trim() ?? '';

let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });

async function main(): Promise<void> {
  const missing = [
    ...(API_KEY ? [] : ['ANTHROPIC_API_KEY']),
    ...(process.env.COACH_CLIENT_SECRET?.trim() ? [] : ['COACH_CLIENT_SECRET']),
  ];
  if (missing.length > 0) {
    log.warn('not configured; waiting idle — set these and recreate the container', { missing });
    while (!stopping) await sleep(60 * 60_000);
    return;
  }

  const api = new CoachApi({
    apiUrl: env('COACH_API_URL', 'http://api:8000'),
    tokenUrl: env('COACH_TOKEN_URL'),
    clientId: env('COACH_CLIENT_ID', 'skills-coach-coach'),
    clientSecret: env('COACH_CLIENT_SECRET'),
  });
  const writer = new ClaudeCardWriter(API_KEY, MODEL);
  const worker = new WordWorker(api, log);
  log.info('word worker started', { model: MODEL, pollSeconds: POLL_MS / 1000 });

  let backoff = POLL_MS;
  while (!stopping) {
    try {
      const result = await worker.cycle(writer);
      if (result.suggested + result.failed > 0) log.info('cycle done', { ...result });
      backoff = POLL_MS;
    } catch (error) {
      // The queue or the account is unreachable for every word alike: back off as a whole.
      backoff = Math.min(backoff * 2, 5 * 60_000);
      log.error('cycle failed', {
        error: error instanceof Error ? error.message : String(error),
        retryInSeconds: Math.round(backoff / 1000),
      });
    }
    await sleep(backoff);
  }
  log.info('word worker stopped');
}

main().catch((error: unknown) => {
  log.error('word worker could not start', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
