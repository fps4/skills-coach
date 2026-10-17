/**
 * Topics through HTTP (ADR-0031).
 *
 * Pinned here: a deck can be practised one topic at a time, in practice and in learn mode; the
 * counts beside it are the topic's while the list of topics stays the deck's; the overview reports
 * the same topics for the deck its Flashcards tab opens; and a learner's own card is sorted by the
 * topic it was given like any published one.
 *
 * Every card here is invented (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

const PACK = {
  ...TEST_PACK,
  packId: 'topic-pack',
  title: 'Widgets by topic',
  contentLanguage: 'en',
  translationLanguage: 'en',
  skill: 'widgets',
  errorCategories: [],
  flashcards: { grading: 'self' },
  presentation: { surfaces: ['drills:terms'] },
};

const CARDS = [
  { kind: 'term', term: 'Widget join', translation: 'Matching widgets on a key.', group: '1 · Basics' },
  { kind: 'term', term: 'Gadget fan-out', translation: 'One gadget event to many consumers.', group: '1 · Basics' },
  { kind: 'term', term: 'Sprocket sharding', translation: 'Splitting sprockets across stores.', group: '10 · Scale' },
  { kind: 'term', term: 'Doohickey', translation: 'A thing without a topic.' },
];

type TopicSummary = { id: string; title?: string; summary: { total: number; mastered: number; stage1Cleared: number } };
type DeckPage = {
  items: { drillItemId: string; prompt: { prompt: string }; card?: { expected: string } }[];
  summary: { total: number; stage1Cleared: number };
  topics: TopicSummary[];
};

describeIfMongo('topics', () => {
  let harness: Harness;
  const blockId = `${PACK.packId}.b1`;

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const pack = await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('coach-token'),
      payload: PACK,
    });
    if (pack.statusCode !== 200) throw new Error(`seed pack failed: ${pack.body}`);
    const block = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${PACK.packId}/blocks`,
      headers: auth('coach-token'),
      payload: { order: 1, slug: 'deck', title: 'Deck', drillItems: CARDS.map((payload) => ({ payload })) },
    });
    if (block.statusCode >= 300) throw new Error(`seed block failed: ${block.body}`);
  });

  const deck = async (query = ''): Promise<DeckPage> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}&kind=term&limit=100${query}`,
      headers: auth('learner-token'),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeckPage;
  };

  const gotIt = async (term: string) => {
    const item = (await deck()).items.find((entry) => entry.prompt.prompt === term);
    if (!item) throw new Error(`no card "${term}"`);
    for (let i = 0; i < 2; i++) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/drills/${item.drillItemId}/attempts`,
        headers: auth('learner-token'),
        payload: { stage: 1, self: 'got' },
      });
      expect(response.statusCode).toBe(200);
    }
  };

  it('lists the deck’s topics in section order, the cards without one last', async () => {
    const { topics } = await deck();
    expect(topics.map((topic) => [topic.id, topic.title, topic.summary.total])).toEqual([
      ['1 · Basics', '1 · Basics', 2],
      ['10 · Scale', '10 · Scale', 1],
      ['_none', undefined, 1],
    ]);
  });

  it('serves only the chosen topic, with its counts, and still lists every topic', async () => {
    const page = await deck(`&topic=${encodeURIComponent('1 · Basics')}`);
    expect(page.items.map((item) => item.prompt.prompt).sort()).toEqual(['Gadget fan-out', 'Widget join']);
    expect(page.summary.total).toBe(2);
    expect(page.topics).toHaveLength(3);
  });

  it('serves the cards without a topic by _none', async () => {
    const page = await deck('&topic=_none');
    expect(page.items.map((item) => item.prompt.prompt)).toEqual(['Doohickey']);
  });

  it('serves nothing for a topic the deck does not have, rather than the whole deck', async () => {
    const page = await deck('&topic=Nonexistent');
    expect(page.items).toEqual([]);
    expect(page.summary.total).toBe(0);
  });

  it('filters learn mode the same way', async () => {
    const page = await deck(`&mode=learn&topic=${encodeURIComponent('10 · Scale')}`);
    expect(page.items.map((item) => item.card?.expected)).toEqual(['Splitting sprockets across stores.']);
  });

  it('counts progress against the topic of the card practised', async () => {
    await gotIt('Widget join');
    const basics = await deck(`&topic=${encodeURIComponent('1 · Basics')}`);
    expect(basics.summary.stage1Cleared).toBe(1);
    expect(basics.topics.find((topic) => topic.id === '10 · Scale')?.summary.stage1Cleared).toBe(0);
  });

  it('reports the same topics on the overview, for the deck its Flashcards tab opens', async () => {
    await gotIt('Sprocket sharding');
    await harness.app.inject({ method: 'GET', url: `/api/v1/packs/${PACK.packId}`, headers: auth('learner-token') });
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/progress?packId=${PACK.packId}`,
      headers: auth('learner-token'),
    });
    expect(response.statusCode).toBe(200);
    const progress = response.json() as { currentBlock: { blockId: string }; decks: { topics: TopicSummary[] } };
    expect(progress.currentBlock.blockId).toBe(blockId);
    expect(progress.decks.topics).toEqual((await deck()).topics);
    expect(progress.decks.topics.find((topic) => topic.id === '10 · Scale')?.summary.stage1Cleared).toBe(1);
  });

  it('sorts a learner’s own card into the topic it was given', async () => {
    const added = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/blocks/${blockId}/terms`,
      headers: auth('learner-token'),
      payload: { term: 'Thingamajig', translation: 'My own card.', group: '10 · Scale' },
    });
    expect(added.statusCode).toBe(201);
    const page = await deck(`&topic=${encodeURIComponent('10 · Scale')}`);
    expect(page.items.map((item) => item.prompt.prompt).sort()).toEqual(['Sprocket sharding', 'Thingamajig']);
  });

  it('refuses a topic that is blank', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}&topic=%20`,
      headers: auth('learner-token'),
    });
    expect(response.statusCode).toBe(400);
  });
});
