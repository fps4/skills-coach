/**
 * The word worker (ADR-0034): polls the word-request queue and fills each word in through
 * `/coach/v1`, as a coach would over MCP.
 *
 * The Anthropic key is read from a file on every cycle rather than from the environment, so putting a
 * key in place — or rotating it — takes effect without a redeploy, and a worker started before the
 * key exists waits for it instead of crash-looping.
 */
import { readFile } from 'node:fs/promises';
import { CoachApi } from './coach-api.js';
import { WordWorker, type Logger } from './worker.js';
import { ClaudeCardWriter, type CardWriter } from './writer.js';

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

const POLL_MS = Number(env('WORD_WORKER_POLL_SECONDS', '5')) * 1000;
const KEY_FILE = env('ANTHROPIC_API_KEY_FILE', '/run/secrets/word-worker/anthropic-api-key');
const MODEL = env('WORD_WORKER_MODEL', 'claude-opus-5-5');

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

/** The writer for the key currently on disk; rebuilt only when the key changes. */
let current: { key: string; writer: CardWriter } | undefined;
let reportedState: string | undefined;

async function writerForKey(): Promise<CardWriter | undefined> {
  let key: string;
  try {
    key = (await readFile(KEY_FILE, 'utf8')).trim();
  } catch {
    key = '';
  }
  const state = key ? 'ready' : 'waiting for key';
  if (state !== reportedState) {
    if (!key) log.warn(`no Anthropic key at ${KEY_FILE}; waiting for one`);
    reportedState = state;
  }
  if (!key) return undefined;
  if (current?.key !== key) {
    current = { key, writer: new ClaudeCardWriter(key, MODEL) };
    // scripts/ds1/set-anthropic-key.sh waits for this line.
    log.info('Anthropic key loaded');
  }
  return current.writer;
}

async function main(): Promise<void> {
  const api = new CoachApi({
    apiUrl: env('COACH_API_URL', 'http://api:8000'),
    tokenUrl: env('COACH_TOKEN_URL'),
    clientId: env('COACH_CLIENT_ID', 'skills-coach-coach'),
    clientSecret: env('COACH_CLIENT_SECRET'),
  });
  const worker = new WordWorker(api, log);
  log.info('word worker started', { model: MODEL, pollSeconds: POLL_MS / 1000 });

  let backoff = POLL_MS;
  while (!stopping) {
    const writer = await writerForKey();
    if (!writer) {
      await sleep(30_000);
      continue;
    }
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
