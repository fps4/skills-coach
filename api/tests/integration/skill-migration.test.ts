/**
 * Forking a programme's words and reading into skills of their own, and then removing the programme
 * (ADR-0022).
 *
 * What is pinned: a learner loses nothing they had — every word they could practise, how far along
 * each was, what they had read — the copy is theirs and survives the programme going, running it
 * twice changes nothing, and removal takes every trace of the programme with it.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createContext } from '../../src/services/context.js';
import { migrateToSkills, type MigrationOptions } from '../../src/services/skill-migration.js';
import { countPackFootprint, removePackWithHistory } from '../../src/services/pack-removal.js';
import { auth, createHarness, mongoAvailable, TEST_BLOCK, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

const WORDS = {
  packId: 'words-skill',
  title: { en: 'Word trainer', nl: 'Woordtrainer' },
  contentLanguage: 'nl',
  translationLanguage: 'en',
  skill: 'vocabulary',
  framework: { id: 'cefr', levels: ['B1'] },
  presentation: { surfaces: ['drills:terms'] },
};
const READING = {
  ...WORDS,
  packId: 'reading-skill',
  title: { en: 'Reading' },
  presentation: { surfaces: ['reading'] },
};

const ARTICLE = {
  slug: 'een-artikel',
  labels: ['nieuws'],
  bodies: [
    { language: 'nl', title: 'Een artikel', body: 'Een korte Nederlandse tekst.' },
    { language: 'en', title: 'An article', body: 'A short English text.' },
  ],
};

const OPTIONS: MigrationOptions = {
  from: TEST_PACK.packId,
  words: WORDS.packId,
  reading: READING.packId,
  folder: { nl: 'Nederlands', en: 'Dutch' },
  dryRun: false,
};

describeIfMongo('forking words and reading into skills', () => {
  let harness: Harness;
  let learnerId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  const as = (token: string) => ({ headers: auth(token) });
  const ctx = () => createContext(harness.store, harness.config);

  beforeEach(async () => {
    await harness.reset();
    for (const pack of [TEST_PACK, WORDS, READING]) {
      await harness.app.inject({ method: 'POST', url: '/coach/v1/packs', ...as('coach-token'), payload: pack });
    }
    await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
      ...as('coach-token'),
      payload: TEST_BLOCK,
    });

    const me = await harness.app.inject({ method: 'GET', url: '/api/v1/me', ...as('learner-token') });
    learnerId = me.json().learner.learnerId as string;
    await harness.app.inject({ method: 'GET', url: `/api/v1/packs/${TEST_PACK.packId}`, ...as('learner-token') });

    // A word of their own, next to the block's two.
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/blocks/${TEST_PACK.packId}.b1/terms`,
      ...as('learner-token'),
      payload: { term: 'de vergadering', translation: 'the meeting' },
    });

    // Two right answers clear stage 1 of one word.
    const deck = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${TEST_PACK.packId}.b1&kind=term`,
      ...as('learner-token'),
    });
    const practised = deck
      .json()
      .items.find((item: { prompt: { prompt: string } }) => item.prompt.prompt === 'ingewikkeld');
    for (let i = 0; i < 2; i += 1) {
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/drills/${practised.drillItemId}/attempts`,
        ...as('learner-token'),
        payload: { stage: 1, given: 'complicated' },
      });
    }

    // A reading library with one article read.
    await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${TEST_PACK.packId}/reading`,
      ...as('coach-token'),
      payload: { learnerId, articles: [ARTICLE] },
    });
    const library = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/packs/${TEST_PACK.packId}/reading`,
      ...as('learner-token'),
    });
    const articleId = library.json().articles[0].articleId as string;
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/reading/${articleId}/read`,
      ...as('learner-token'),
      payload: { read: true },
    });
  });

  const wordDeck = async () => {
    const progress = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/progress?packId=${WORDS.packId}`,
      ...as('learner-token'),
    });
    return progress.json();
  };

  it('reports and writes nothing on a dry run', async () => {
    const report = await migrateToSkills(ctx(), { ...OPTIONS, dryRun: true });

    expect(report.deckCreated).toBe(true);
    expect(report.learners).toEqual([{ learnerId, words: 3, wordsWithProgress: 1, attempts: 2, articles: 1, read: 1 }]);
    expect(await harness.store.collections.drillItems.countDocuments({ packId: WORDS.packId })).toBe(0);
    expect(await harness.store.collections.blocks.countDocuments({ packId: WORDS.packId })).toBe(0);
  });

  it('gives the learner every word they could practise, as their own, with their progress', async () => {
    await migrateToSkills(ctx(), OPTIONS);

    const progress = await wordDeck();
    expect(progress.decks.terms).toMatchObject({ total: 3, stage1Cleared: 1 });
    // A deck, not a course: one block, no lessons.
    expect(progress.blocks).toHaveLength(1);
    expect(progress.blocks[0].block.lessonCount).toBe(0);

    const own = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/blocks/${progress.blocks[0].block.blockId}/terms`,
      ...as('learner-token'),
    });
    expect(
      own
        .json()
        .terms.map((item: { payload: { term: string } }) => item.payload.term)
        .sort(),
    ).toEqual(['de doorlooptijd', 'de vergadering', 'ingewikkeld']);
  });

  it('carries the reading library and what was read', async () => {
    await migrateToSkills(ctx(), OPTIONS);

    const library = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/packs/${READING.packId}/reading?unread=false`,
      ...as('learner-token'),
    });
    expect(library.json().articles).toHaveLength(1);
    expect(library.json().articles[0]).toMatchObject({ slug: 'een-artikel' });
    expect(library.json().articles[0].readAt).not.toBeNull();
  });

  it('files both skills in one folder of the learner’s menu', async () => {
    await migrateToSkills(ctx(), OPTIONS);

    const menu = (await harness.app.inject({ method: 'GET', url: '/api/v1/me/menu', ...as('learner-token') })).json()
      .menu;
    expect(menu.folders).toEqual([{ folderId: expect.any(String), name: 'Nederlands' }]);
    const folderId = menu.folders[0].folderId;
    expect(menu.placements).toEqual(
      expect.arrayContaining([
        { packId: WORDS.packId, folderId, hidden: false },
        { packId: READING.packId, folderId, hidden: false },
      ]),
    );
  });

  it('changes nothing on a second run, and never demotes practice done in between', async () => {
    await migrateToSkills(ctx(), OPTIONS);
    const deckBlock = (await wordDeck()).blocks[0].block.blockId as string;

    // Clear stage 1 of another word in the new skill.
    const deck = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${deckBlock}&kind=term`,
      ...as('learner-token'),
    });
    const next = deck
      .json()
      .items.find((item: { prompt: { prompt: string } }) => item.prompt.prompt === 'de vergadering');
    for (let i = 0; i < 2; i += 1) {
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/drills/${next.drillItemId}/attempts`,
        ...as('learner-token'),
        payload: { stage: 1, given: 'the meeting' },
      });
    }

    const second = await migrateToSkills(ctx(), OPTIONS);

    expect(second.deckCreated).toBe(false);
    expect((await wordDeck()).decks.terms).toMatchObject({ total: 3, stage1Cleared: 2 });
    const menu = (await harness.app.inject({ method: 'GET', url: '/api/v1/me/menu', ...as('learner-token') })).json()
      .menu;
    expect(menu.folders).toHaveLength(1);
  });

  it('keeps everything once the programme is removed, history and all', async () => {
    await migrateToSkills(ctx(), OPTIONS);

    const footprint = await countPackFootprint(ctx(), TEST_PACK.packId);
    expect(footprint).toMatchObject({
      blocks: 1,
      enrollments: 1,
      drillState: 1,
      attempts: 2,
      articles: 1,
      readingState: 1,
    });

    await removePackWithHistory(ctx(), TEST_PACK.packId);

    expect(Object.values(await countPackFootprint(ctx(), TEST_PACK.packId)).every((count) => count === 0)).toBe(true);
    expect(await harness.store.collections.packs.findOne({ _id: TEST_PACK.packId })).toBeNull();

    expect((await wordDeck()).decks.terms).toMatchObject({ total: 3, stage1Cleared: 1 });
    const menu = (await harness.app.inject({ method: 'GET', url: '/api/v1/me/menu', ...as('learner-token') })).json()
      .menu;
    expect(menu.placements.map((entry: { packId: string }) => entry.packId)).not.toContain(TEST_PACK.packId);
  });
});
