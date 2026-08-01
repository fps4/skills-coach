/**
 * Integration-test harness.
 *
 * These tests talk to a real MongoDB. When one is not reachable they **skip** rather than fail, so
 * `npm test` works on a laptop with Docker down. CI always has MongoDB, so they always run there —
 * see `.github/workflows/dod.yml`.
 *
 * Requests go through `app.inject`, which exercises the whole fastify stack (routing, hooks, error
 * handling, serialisation) without binding a port.
 */

import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { connect, dropAll, ensureIndexes, type Store } from '../../src/db/client.js';
import type { Principal, Verifier } from '../../src/auth/verifier.js';

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://coach:coach@127.0.0.1:27018/?authSource=admin';
const DB_PREFIX = process.env.MONGO_TEST_DB ?? 'skills-coach-test';

/** Whether a MongoDB is reachable, probed once per run. */
export async function mongoAvailable(): Promise<boolean> {
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 1_500 });
  try {
    await client.connect();
    await client.db(DB_PREFIX).command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export const LEARNER: Principal = {
  subject: 'learner-under-test',
  email: 'learner@example.invalid',
  roles: ['learner'],
  kind: 'user',
};

export const COACH: Principal = {
  subject: 'coach-client-under-test',
  roles: ['coach'],
  kind: 'client',
};

export const OTHER_LEARNER: Principal = {
  subject: 'other-learner-under-test',
  email: 'other@example.invalid',
  roles: ['learner'],
  kind: 'user',
};

/**
 * A verifier that maps a fake bearer token onto a principal, so tests exercise the real capability
 * checks without minting signed tokens. The token *value* selects the caller.
 */
const PRINCIPALS: Record<string, Principal> = {
  'learner-token': LEARNER,
  'coach-token': COACH,
  'other-token': OTHER_LEARNER,
  'roleless-token': { subject: 'roleless-under-test', email: 'roleless@example.invalid', roles: [], kind: 'user' },
  'stranger-token': { subject: 'stranger-under-test', roles: ['auditor'], kind: 'client' },
};

const testVerifier: Verifier = {
  async verify(token: string): Promise<Principal> {
    const principal = PRINCIPALS[token];
    if (!principal) throw new Error('unknown test token');
    return principal;
  },
};

export interface Harness {
  app: FastifyInstance;
  store: Store;
  config: Config;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Build an app against a database of its own.
 *
 * Per-harness rather than per-run: vitest runs test files in parallel, and `reset()` clears every
 * collection — so a shared database would have one file wiping another file's fixtures mid-test.
 * The database is dropped on close.
 */
export async function createHarness(now: () => Date = () => new Date()): Promise<Harness> {
  const config = loadConfig({
    COACH_ENV: 'test',
    MONGO_URI,
    MONGO_DB: `${DB_PREFIX}-${randomUUID().slice(0, 8)}`,
    AUTH_MODE: 'dev',
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);

  const store = await connect(config.mongoUri, config.mongoDb);
  await ensureIndexes(store.db, config.auditRetentionDays);
  const app = await buildApp({ config, store, verifier: testVerifier, now });
  await app.ready();

  return {
    app,
    store,
    config,
    reset: () => dropAll(store.db),
    close: async () => {
      await app.close();
      await store.db.dropDatabase().catch(() => undefined);
      await store.close();
    },
  };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// Synthetic fixtures — invented content only (ADR-0006)
// ---------------------------------------------------------------------------

export const TEST_PACK = {
  packId: 'test-pack',
  title: { en: 'Test pack', nl: 'Testpakket' },
  contentLanguage: 'nl',
  translationLanguage: 'en',
  skill: 'conversation',
  goal: { en: 'Reach the top of the test ladder.' },
  framework: {
    id: 'cefr',
    levels: ['A2', 'B1.1', 'B1.2', 'B2.1'],
    ramp: [
      { fromBlock: 1, toBlock: 2, level: 'B1.1', phase: 'one', dials: { textLength: 'short' } },
      { fromBlock: 3, toBlock: 4, level: 'B1.2', phase: 'two' },
    ],
  },
  errorCategories: [
    { id: 'word-order', label: { en: 'Word order' } },
    { id: 'spelling', label: { en: 'Spelling' } },
    { id: 'articles', label: { en: 'Articles' } },
  ],
};

export const TEST_BLOCK = {
  order: 1,
  slug: 'first-block',
  title: { en: 'First block', nl: 'Eerste blok' },
  level: 'B1.1',
  focus: ['category:word-order'],
  milestone: 'Say three sentences without freezing.',
  status: 'published' as const,
  lessons: [
    {
      order: 1,
      title: { en: 'Lesson one' },
      estimatedMinutes: 20,
      sections: [
        { id: 'tekst', kind: 'text' as const, body: 'Een korte tekst om hardop te lezen.' },
        {
          id: 'woorden',
          kind: 'vocabulary' as const,
          items: [
            { term: 'de doorlooptijd', translation: 'lead time / turnaround', example: 'De doorlooptijd daalde.' },
            { term: 'ingewikkeld', translation: 'complicated', example: 'Dat klinkt ingewikkeld.' },
          ],
        },
        { id: 'vragen', kind: 'questions' as const, items: [{ ref: '1', prompt: 'Waarom?' }] },
        { id: 'schrijf', kind: 'write' as const, prompt: 'Schrijf vijf zinnen.', requirements: ['gebruik een bijzin'] },
        { id: 'spreek', kind: 'speak' as const, prompt: 'Vertel het hardop.' },
      ],
    },
    {
      order: 2,
      title: { en: 'Lesson two' },
      sections: [
        { id: 'regels', kind: 'rules' as const, body: 'De regel van deze les.' },
        {
          id: 'oefening',
          kind: 'exercise' as const,
          items: [{ ref: 'a', prompt: 'Zet in de verleden tijd.' }],
          answers: [{ ref: 'a', answer: 'Het antwoord.' }],
        },
        { id: 'schrijf', kind: 'write' as const, prompt: 'Schrijf een korte tekst.' },
      ],
    },
  ],
  drillItems: [
    {
      lessonOrder: 1,
      payload: {
        kind: 'word-order' as const,
        sentence: 'Morgen begin ik met de cursus.',
        parts: ['ik', 'begin', 'morgen', 'met de cursus'],
        partsAlt: ['morgen', 'begin', 'ik', 'met de cursus'],
        translation: 'Tomorrow I start the course.',
        tip: 'Fronting a time phrase inverts subject and verb.',
      },
    },
    {
      lessonOrder: 2,
      payload: {
        kind: 'word-order' as const,
        sentence: 'Ik denk dat het goed werkt.',
        parts: ['ik denk', 'dat het', 'goed', 'werkt'],
        translation: 'I think it works well.',
      },
    },
  ],
};

/** Publish the synthetic pack and block. Returns the ids the tests need. */
export async function seed(harness: Harness): Promise<{ packId: string; blockId: string; lessonIds: string[] }> {
  const packResponse = await harness.app.inject({
    method: 'POST',
    url: '/coach/v1/packs',
    headers: auth('coach-token'),
    payload: TEST_PACK,
  });
  if (packResponse.statusCode !== 200) throw new Error(`seed pack failed: ${packResponse.body}`);

  const blockResponse = await harness.app.inject({
    method: 'POST',
    url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
    headers: auth('coach-token'),
    payload: TEST_BLOCK,
  });
  if (blockResponse.statusCode !== 201) throw new Error(`seed block failed: ${blockResponse.body}`);

  const blockId = blockResponse.json().block.blockId as string;
  return { packId: TEST_PACK.packId, blockId, lessonIds: [`${blockId}.l1`, `${blockId}.l2`] };
}
