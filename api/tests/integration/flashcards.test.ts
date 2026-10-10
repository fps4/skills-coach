/**
 * Flashcards through HTTP and MCP (ADR-0027).
 *
 * One engine, two ways of answering. Pinned here: a concept deck published through MCP comes back
 * as cards with their extra fields; practice still never sends the back of a card; a reveal and
 * learn mode show it and write nothing; a self grade is taken only on a pack that declares it, and
 * is recorded as one.
 *
 * Every card here is invented (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, seed, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

const CONCEPT_PACK = {
  ...TEST_PACK,
  packId: 'concept-pack',
  title: 'Widgets for architects',
  contentLanguage: 'en',
  translationLanguage: 'en',
  skill: 'widgets',
  errorCategories: [],
  flashcards: { grading: 'self' },
  presentation: { surfaces: ['drills:terms'] },
};

const CARDS = [
  {
    kind: 'term',
    term: 'Widget join',
    translation: 'Matching two widget lists on a shared key.',
    hint: 'A widget join works like a zipper.',
    group: 'Basics',
    details: {
      analogy: 'Like a SQL inner join, but for widgets.',
      code: 'left JOIN right USING (key)',
      source: 'Widgets guide · Joining',
    },
  },
  {
    kind: 'term',
    term: 'Gadget fan-out',
    translation: 'Sending one gadget event to many consumers.',
    group: 'Basics',
  },
];

describeIfMongo('flashcards', () => {
  let harness: Harness;
  let conceptBlockId: string;
  let wordBlockId: string;

  beforeAll(async () => {
    harness = await createHarness(undefined, { MCP_RESOURCE_URL: 'https://coach-mcp.example.invalid/mcp' });
  });
  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    ({ blockId: wordBlockId } = await seed(harness));

    const pack = await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('coach-token'),
      payload: CONCEPT_PACK,
    });
    if (pack.statusCode !== 200) throw new Error(`seed concept pack failed: ${pack.body}`);

    // Published through the second door, the way a coach's agent would (ADR-0010).
    const published = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...auth('coach-token'), accept: 'application/json, text/event-stream' },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'publish_block',
          arguments: {
            packId: CONCEPT_PACK.packId,
            block: { order: 1, slug: 'deck', title: 'Deck', drillItems: CARDS.map((payload) => ({ payload })) },
          },
        },
      },
    });
    if (published.statusCode !== 200 || published.json().result?.isError) {
      throw new Error(`publish_block failed: ${published.body}`);
    }
    conceptBlockId = `${CONCEPT_PACK.packId}.b1`;
  });

  type Item = {
    drillItemId: string;
    stage: 1 | 2;
    prompt: Record<string, unknown>;
    card?: Record<string, unknown>;
  };

  const deck = async (blockId: string, query = '') => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}&kind=term&limit=100${query}`,
      headers: auth('learner-token'),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { items: Item[]; summary: Record<string, number> };
  };

  const post = (url: string, payload: Record<string, unknown>) =>
    harness.app.inject({ method: 'POST', url, headers: auth('learner-token'), payload });

  const card = async (term: string) => {
    const found = (await deck(conceptBlockId)).items.find((item) => item.prompt.prompt === term);
    if (!found) throw new Error(`no card prompting "${term}"`);
    return found;
  };

  /** Everything a learner's practice can have written, so "records nothing" can be asserted exactly. */
  const written = async () => ({
    attempts: await harness.store.collections.attempts.countDocuments({}),
    state: await harness.store.collections.drillState.countDocuments({}),
  });

  describe('practice', () => {
    it('serves the front of a card with its section and cue, never its back', async () => {
      const { items } = await deck(conceptBlockId);
      const join = items.find((item) => item.prompt.prompt === 'Widget join');
      expect(join?.prompt).toMatchObject({ group: 'Basics', hint: 'A widget join works like a zipper.' });
      expect(join?.card).toBeUndefined();

      const serialized = JSON.stringify(items);
      expect(serialized).not.toContain('Matching two widget lists');
      expect(serialized).not.toContain('USING (key)');
      expect(serialized).not.toContain('SQL inner join');
    });
  });

  describe('reveal', () => {
    it('turns a card over and writes nothing', async () => {
      const join = await card('Widget join');
      const response = await post(`/api/v1/drills/${join.drillItemId}/reveal`, { stage: 1 });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        drillItemId: join.drillItemId,
        stage: 1,
        expected: 'Matching two widget lists on a shared key.',
        group: 'Basics',
        details: { analogy: 'Like a SQL inner join, but for widgets.', code: 'left JOIN right USING (key)' },
      });
      expect(await written()).toEqual({ attempts: 0, state: 0 });
    });

    it('is refused on a typed pack — a word is revealed by answering it', async () => {
      const { items } = await deck(wordBlockId);
      const response = await post(`/api/v1/drills/${items[0]!.drillItemId}/reveal`, { stage: 1 });
      expect(response.statusCode).toBe(400);
    });

    it('holds the gate: the second direction cannot be revealed before the first is cleared', async () => {
      const join = await card('Widget join');
      const response = await post(`/api/v1/drills/${join.drillItemId}/reveal`, { stage: 2 });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('self-grading', () => {
    it('takes "got it" and "missed it" on a self pack, records them as self-graded, and moves the streak', async () => {
      const join = await card('Widget join');

      const got = await post(`/api/v1/drills/${join.drillItemId}/attempts`, { stage: 1, self: 'got' });
      expect(got.statusCode).toBe(200);
      expect(got.json()).toMatchObject({ correct: true, selfGraded: true, progress: { streak: 1 } });

      const missed = await post(`/api/v1/drills/${join.drillItemId}/attempts`, { stage: 1, self: 'missed' });
      expect(missed.json()).toMatchObject({ correct: false, selfGraded: true, progress: { streak: 0 } });

      const rows = await harness.store.collections.attempts.find({ drillItemId: join.drillItemId }).toArray();
      // Both written within the same millisecond, so compare as a set rather than by insertion order.
      expect(rows.map((row) => [row.correct, row.selfGraded, row.acceptedOverride]).sort()).toEqual([
        [false, true, false],
        [true, true, false],
      ]);
    });

    it('clears direction 1 after two in a row and opens direction 2 exactly as typing does', async () => {
      const join = await card('Widget join');
      await post(`/api/v1/drills/${join.drillItemId}/attempts`, { stage: 1, self: 'got' });
      const second = await post(`/api/v1/drills/${join.drillItemId}/attempts`, { stage: 1, self: 'got' });
      expect(second.json().progress).toMatchObject({ stage1Cleared: true, stage: 2, streak: 0 });

      const reverse = (await deck(conceptBlockId, '&stage=2')).items.find(
        (item) => item.drillItemId === join.drillItemId,
      );
      expect(reverse?.prompt.prompt).toBe('Matching two widget lists on a shared key.');
      // The cue names the answer in this direction, so it arrives masked.
      expect(reverse?.prompt.hint).toBe('A … works like a zipper.');
    });

    it('is refused on a typed pack', async () => {
      const { items } = await deck(wordBlockId);
      const response = await post(`/api/v1/drills/${items[0]!.drillItemId}/attempts`, { stage: 1, self: 'got' });
      expect(response.statusCode).toBe(400);
      expect(await written()).toEqual({ attempts: 0, state: 0 });
    });

    it('is refused alongside an override', async () => {
      const join = await card('Widget join');
      const response = await post(`/api/v1/drills/${join.drillItemId}/attempts`, {
        stage: 1,
        self: 'got',
        override: true,
      });
      expect(response.statusCode).toBe(400);
    });

    it('leaves a typed word deck exactly as it was — typed and not self-graded', async () => {
      const { items } = await deck(wordBlockId);
      const word = items.find((item) => item.prompt.prompt === 'ingewikkeld')!;
      const response = await post(`/api/v1/drills/${word.drillItemId}/attempts`, { stage: 1, given: 'complicated' });
      expect(response.json()).toMatchObject({ correct: true, selfGraded: false });
    });
  });

  describe('learn mode', () => {
    it('serves each card front and back together, and writes nothing', async () => {
      const { items } = await deck(conceptBlockId, '&mode=learn');
      expect(items).toHaveLength(2);
      const join = items.find((item) => item.prompt.prompt === 'Widget join');
      expect(join?.card).toMatchObject({
        expected: 'Matching two widget lists on a shared key.',
        hint: 'A widget join works like a zipper.',
        details: { source: 'Widgets guide · Joining' },
      });
      expect(await written()).toEqual({ attempts: 0, state: 0 });
    });

    it('works on a typed deck too — the learner asked to see the answers', async () => {
      const { items } = await deck(wordBlockId, '&mode=learn');
      expect(items.find((item) => item.prompt.prompt === 'ingewikkeld')?.card?.expected).toBe('complicated');
    });

    it('keeps the second direction locked', async () => {
      const { items } = await deck(conceptBlockId, '&mode=learn&stage=2');
      expect(items).toHaveLength(0);
    });

    it('shows only cards — a question bank in learn mode would be an answer sheet', async () => {
      const response = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/drills?blockId=${wordBlockId}&mode=learn&limit=100`,
        headers: auth('learner-token'),
      });
      const kinds = (response.json().items as Item[]).map((item) => item.prompt.kind);
      expect(new Set(kinds)).toEqual(new Set(['term']));
    });
  });

  describe('a learner’s own card', () => {
    it('carries the concept fields like a published one', async () => {
      const added = await post(`/api/v1/blocks/${conceptBlockId}/terms`, {
        term: 'Sprocket cache',
        translation: 'A cache in front of the sprocket store.',
        hint: 'Read-through.',
        group: 'Mine',
        details: { analogy: 'Like a CDN for sprockets.' },
      });
      expect(added.statusCode).toBe(201);
      expect(added.json().term.payload).toMatchObject({ hint: 'Read-through.', group: 'Mine' });
    });
  });
});
