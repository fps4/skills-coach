/**
 * Drill practice through HTTP — the behaviours the browser trainers had, now server-side.
 *
 * The one that matters most: `GET /api/v1/drills` must never contain the answer. The trainers this
 * replaces had to ship it to the page; if a refactor reintroduces that, this test fails.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, seed, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

describeIfMongo('drills', () => {
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

  const fetchDrills = async (query = '') => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}&limit=50${query}`,
      headers: auth('learner-token'),
    });
    return response.json() as {
      items: { drillItemId: string; stage: 1 | 2; prompt: Record<string, unknown> }[];
      summary: Record<string, number>;
    };
  };

  const attempt = async (drillItemId: string, payload: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: `/api/v1/drills/${drillItemId}/attempts`,
      headers: auth('learner-token'),
      payload,
    });

  /** The term item lifted from the vocabulary section. */
  const findTerm = async (term: string) => {
    const { items } = await fetchDrills('&kind=term');
    const found = items.find((item) => item.prompt.prompt === term);
    if (!found) throw new Error(`no drill prompting "${term}"`);
    return found;
  };

  const findSentence = async () => {
    const { items } = await fetchDrills('&kind=word-order');
    const found = items.find((item) => (item.prompt.bank as string[]).length === 4 && item.prompt.leadCue);
    if (!found) throw new Error('no two-order sentence drill');
    return found;
  };

  it('never sends the answer with the prompt', async () => {
    const { items } = await fetchDrills();
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('lead time');
    expect(serialized).not.toContain('Morgen begin ik met de cursus.');
  });

  it('grades a term leniently on shape and strictly on spelling', async () => {
    const item = await findTerm('de doorlooptijd');

    const tolerated = await attempt(item.drillItemId, { stage: 1, given: 'lead time' });
    expect(tolerated.json()).toMatchObject({ correct: true, overridden: false });

    const misspelt = await attempt(item.drillItemId, { stage: 1, given: 'leed time' });
    expect(misspelt.json().correct).toBe(false);
  });

  it('clears a stage after two correct in a row and unlocks the reverse direction', async () => {
    const item = await findTerm('ingewikkeld');

    await attempt(item.drillItemId, { stage: 1, given: 'complicated' });
    const second = await attempt(item.drillItemId, { stage: 1, given: 'complicated' });
    expect(second.json().progress).toMatchObject({ stage1Cleared: true, stage: 2, streak: 0, mastered: false });

    // Stage 2 prompts in the other direction and asks for the Dutch — the spelling drill.
    const { items } = await fetchDrills('&kind=term&stage=2');
    const reversed = items.find((entry) => entry.drillItemId === item.drillItemId);
    expect(reversed?.prompt.prompt).toBe('complicated');
  });

  it('resets the streak on a wrong answer', async () => {
    const item = await findTerm('ingewikkeld');
    await attempt(item.drillItemId, { stage: 1, given: 'complicated' });
    const wrong = await attempt(item.drillItemId, { stage: 1, given: 'simple' });
    expect(wrong.json().progress).toMatchObject({ streak: 0, stage1Cleared: false });
  });

  it('refuses stage 2 until stage 1 is cleared, even when asked for directly', async () => {
    const item = await findTerm('ingewikkeld');
    const response = await attempt(item.drillItemId, { stage: 2, given: 'ingewikkeld' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('locked');
  });

  it('masters an item only after both directions are cleared', async () => {
    const item = await findTerm('ingewikkeld');
    await attempt(item.drillItemId, { stage: 1, given: 'complicated' });
    await attempt(item.drillItemId, { stage: 1, given: 'complicated' });
    await attempt(item.drillItemId, { stage: 2, given: 'ingewikkeld' });
    const last = await attempt(item.drillItemId, { stage: 2, given: 'ingewikkeld' });
    expect(last.json().progress.mastered).toBe(true);

    // A mastered item leaves the rotation.
    const { items } = await fetchDrills('&kind=term');
    expect(items.map((entry) => entry.drillItemId)).not.toContain(item.drillItemId);
  });

  it('records an override as an override while letting it earn the streak', async () => {
    const item = await findTerm('de doorlooptijd');
    const response = await attempt(item.drillItemId, { stage: 1, given: 'cycle time', override: true });
    expect(response.json()).toMatchObject({ correct: true, overridden: true });

    const stored = await harness.store.collections.attempts.findOne({ drillItemId: item.drillItemId });
    expect(stored?.acceptedOverride).toBe(true);
  });

  it('tells a learner their other valid word order is good Dutch in the wrong round', async () => {
    const item = await findSentence();
    const response = await attempt(item.drillItemId, {
      stage: 1,
      given: ['morgen', 'begin', 'ik', 'met de cursus'],
    });
    const body = response.json();
    expect(body.correct).toBe(false);
    expect(body.otherValidOrder).toBe(true);
    expect(body.alternative).toBe('Morgen begin ik met de cursus');
  });

  it('marks each chunk and reveals the tip after a wrong order', async () => {
    const item = await findSentence();
    const response = await attempt(item.drillItemId, { stage: 1, given: ['begin', 'ik', 'morgen', 'met de cursus'] });
    expect(response.json().marks).toEqual([false, false, true, true]);
    expect(response.json().tip).toContain('inverts');
  });

  it('never offers a second order for a single-order sentence', async () => {
    const { items } = await fetchDrills('&kind=word-order&stage=2');
    // Only the two-order sentence can appear at stage 2, and only once unlocked — so none yet.
    expect(items).toHaveLength(0);
  });

  it('counts a deck the way the trainers did — unlocked, not merely present', async () => {
    const item = await findTerm('ingewikkeld');
    await attempt(item.drillItemId, { stage: 1, given: 'complicated' });
    await attempt(item.drillItemId, { stage: 1, given: 'complicated' });

    const { summary } = await fetchDrills();
    expect(summary).toMatchObject({ total: 4, stage1Cleared: 1, stage2Unlocked: 1, mastered: 0 });
  });

  it('resets only the scope it is given, and refuses an unscoped reset', async () => {
    const item = await findTerm('ingewikkeld');
    await attempt(item.drillItemId, { stage: 1, given: 'complicated' });

    const unscoped = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/drills/reset',
      headers: auth('learner-token'),
      payload: {},
    });
    expect(unscoped.statusCode).toBe(400);

    const scoped = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/drills/reset',
      headers: auth('learner-token'),
      payload: { blockId },
    });
    expect(scoped.json().reset).toBe(1);
  });

  it('serves the same chunk bank on a reload rather than reshuffling', async () => {
    const first = await findSentence();
    const second = await findSentence();
    expect(second.prompt.bank).toEqual(first.prompt.bank);
  });
});
