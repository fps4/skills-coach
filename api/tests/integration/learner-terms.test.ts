/**
 * A learner's own words (ADR-0012).
 *
 * Two guarantees carry this feature, and both are here. A word one learner adds is invisible to
 * every other learner — including by guessing its id. And **republishing the block does not delete
 * it**, which is the failure the whole `learnerId` field exists to prevent: the publish sweep
 * removes what the pack no longer defines, and a learner's word was never in the pack's payload.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, seed, TEST_BLOCK, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

describeIfMongo("a learner's own words", () => {
  let harness: Harness;
  let blockId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
    ({ blockId } = await seed(harness));
  });

  const add = async (payload: Record<string, unknown>, token = 'learner-token') =>
    harness.app.inject({
      method: 'POST',
      url: `/api/v1/blocks/${blockId}/terms`,
      headers: auth(token),
      payload,
    });

  const listMine = async (token = 'learner-token') =>
    harness.app.inject({
      method: 'GET',
      url: `/api/v1/blocks/${blockId}/terms`,
      headers: auth(token),
    });

  const deck = async (token = 'learner-token') => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}&kind=term&limit=50`,
      headers: auth(token),
    });
    return response.json() as {
      items: { drillItemId: string; prompt: { prompt: string } }[];
      summary: { total: number };
    };
  };

  it('adds a word and returns it', async () => {
    const response = await add({ term: 'de begroting', translation: 'the budget', example: 'De begroting klopt.' });

    expect(response.statusCode).toBe(201);
    const { term } = response.json();
    expect(term.payload).toMatchObject({ kind: 'term', term: 'de begroting', translation: 'the budget' });
    expect(term.learnerId).toBeTruthy();
    expect(term.blockId).toBe(blockId);
  });

  it('puts the word into the deck the learner is practising', async () => {
    const before = await deck();
    await add({ term: 'de begroting', translation: 'the budget' });
    const after = await deck();

    expect(after.summary.total).toBe(before.summary.total + 1);
    expect(after.items.map((item) => item.prompt.prompt)).toContain('de begroting');
  });

  it('is idempotent by content — the same word twice is one item, not two', async () => {
    const first = await add({ term: 'de begroting', translation: 'the budget' });
    const second = await add({ term: 'de begroting', translation: 'the budget' });

    expect(second.statusCode).toBe(201);
    expect(second.json().term.drillItemId).toBe(first.json().term.drillItemId);
    expect((await listMine()).json().terms).toHaveLength(1);
  });

  it('lets a learner correct a translation without losing the item', async () => {
    const first = await add({ term: 'de begroting', translation: 'the budjet' });
    const fixed = await add({ term: 'de begroting', translation: 'the budget' });

    expect(fixed.json().term.drillItemId).toBe(first.json().term.drillItemId);
    const { terms } = (await listMine()).json();
    expect(terms).toHaveLength(1);
    expect(terms[0].payload.translation).toBe('the budget');
  });

  it('grades an own word exactly like a pack word', async () => {
    const { term } = (await add({ term: 'de begroting', translation: 'the budget' })).json();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/drills/${term.drillItemId}/attempts`,
      headers: auth('learner-token'),
      payload: { stage: 1, given: 'budget' },
    });

    // Tolerant matching applies: the article is optional, as it is for the pack's own entries.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ correct: true, expected: 'the budget' });
  });

  it('keeps one learner out of another learner’s words', async () => {
    const { term } = (await add({ term: 'de begroting', translation: 'the budget' })).json();

    expect((await listMine('other-token')).json().terms).toEqual([]);
    expect((await deck('other-token')).items.map((item) => item.prompt.prompt)).not.toContain('de begroting');

    // Not even by guessing the id — practising it, and deleting it, are both a 404.
    const practise = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/drills/${term.drillItemId}/attempts`,
      headers: auth('other-token'),
      payload: { stage: 1, given: 'budget' },
    });
    expect(practise.statusCode).toBe(404);

    const remove = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/terms/${term.drillItemId}`,
      headers: auth('other-token'),
    });
    expect(remove.statusCode).toBe(404);
  });

  it('removes a word and the progress attached to it', async () => {
    const { term } = (await add({ term: 'de begroting', translation: 'the budget' })).json();
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/drills/${term.drillItemId}/attempts`,
      headers: auth('learner-token'),
      payload: { stage: 1, given: 'the budget' },
    });

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/terms/${term.drillItemId}`,
      headers: auth('learner-token'),
    });

    expect(removed.statusCode).toBe(204);
    expect((await listMine()).json().terms).toEqual([]);
    expect(await harness.store.collections.drillState.countDocuments({ drillItemId: term.drillItemId })).toBe(0);
  });

  it('refuses to add a word to a block that does not exist', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/blocks/no-such-block/terms',
      headers: auth('learner-token'),
      payload: { term: 'de begroting', translation: 'the budget' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses an empty word', async () => {
    expect((await add({ term: '   ', translation: 'the budget' })).statusCode).toBe(400);
    expect((await add({ term: 'de begroting', translation: '' })).statusCode).toBe(400);
  });

  it('does not let a coach credential curate a learner deck', async () => {
    expect((await add({ term: 'de begroting', translation: 'the budget' }, 'coach-token')).statusCode).toBe(403);
  });

  // The reason `learnerId` exists at all.
  it('survives a republish of the block, with its progress', async () => {
    const { term } = (await add({ term: 'de begroting', translation: 'the budget' })).json();
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/drills/${term.drillItemId}/attempts`,
      headers: auth('learner-token'),
      payload: { stage: 1, given: 'the budget' },
    });

    const republished = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
      headers: auth('coach-token'),
      payload: TEST_BLOCK,
    });
    expect(republished.statusCode).toBe(201);
    // The sweep must not have counted the learner's word as content the pack dropped.
    expect(republished.json().drillItemsRemoved).toBe(0);

    const { terms } = (await listMine()).json();
    expect(terms).toHaveLength(1);
    expect(terms[0].drillItemId).toBe(term.drillItemId);

    const state = await harness.store.collections.drillState.findOne({ drillItemId: term.drillItemId });
    expect(state?.streak).toBe(1);
  });

  it('keeps a learner’s word out of what the coach surface sees', async () => {
    await add({ term: 'de begroting', translation: 'the budget' });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/coach/v1/blocks/${blockId}`,
      headers: auth('coach-token'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('de begroting');
  });
});
