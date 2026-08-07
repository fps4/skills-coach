/**
 * Blocks written for one learner (ADR-0015).
 *
 * A pack holds the methodology — the ramp, the teaching method, the error vocabulary — and every
 * block written from it is about somebody's actual working world. Those two used to be one thing,
 * so a second learner meant a second copy of the whole manifest.
 *
 * Three guarantees carry this, and all three are here. One learner's block is invisible to another,
 * including by guessing its id. Republishing one learner's block cannot reach another's content or
 * the progress attached to it. And the learner's own words keep working inside a block that already
 * belongs to them, which is the case where ADR-0012's `learnerId` stopped being enough on its own.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, TEST_BLOCK, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

describeIfMongo('blocks written for one learner', () => {
  let harness: Harness;
  let mine: string;
  let theirs: string;

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  /** A learner id exists once the learner has been seen, which any request does. */
  const whoAmI = async (token: string): Promise<string> => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(token) });
    return response.json().learner.learnerId as string;
  };

  const publish = async (block: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
      headers: auth('coach-token'),
      payload: block,
    });

  const blocksVisibleTo = async (token: string) => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/packs/${TEST_PACK.packId}`,
      headers: auth(token),
    });
    return (response.json().blocks as { blockId: string; slug: string }[]) ?? [];
  };

  /** The same block content, retitled so the two are told apart by more than an id. */
  const blockFor = (learnerId: string, slug: string, overrides: Record<string, unknown> = {}) => ({
    ...TEST_BLOCK,
    slug,
    title: { en: `Block for ${slug}` },
    learnerId,
    ...overrides,
  });

  beforeEach(async () => {
    await harness.reset();
    await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('coach-token'),
      payload: TEST_PACK,
    });
    mine = await whoAmI('learner-token');
    theirs = await whoAmI('other-token');
  });

  // --- who sees what --------------------------------------------------------

  it('gives two learners their own block 1 in one pack', async () => {
    const first = await publish(blockFor(mine, 'my-first'));
    const second = await publish(blockFor(theirs, 'their-first'));

    expect(first.statusCode).toBe(201);
    // The position (pack, order) is taken, and once it is (pack, owner, order) it is not.
    expect(second.statusCode).toBe(201);
    expect(first.json().block.blockId).not.toBe(second.json().block.blockId);
  });

  it('shows each learner only their own', async () => {
    await publish(blockFor(mine, 'my-first'));
    await publish(blockFor(theirs, 'their-first'));

    expect((await blocksVisibleTo('learner-token')).map((block) => block.slug)).toEqual(['my-first']);
    expect((await blocksVisibleTo('other-token')).map((block) => block.slug)).toEqual(['their-first']);
  });

  it('still gives everyone a block the pack owns', async () => {
    // No `learnerId`: the demo-pack case, and the reason ownership is optional rather than required.
    await publish({ ...TEST_BLOCK, slug: 'for-everyone' });

    expect((await blocksVisibleTo('learner-token')).map((block) => block.slug)).toEqual(['for-everyone']);
    expect((await blocksVisibleTo('other-token')).map((block) => block.slug)).toEqual(['for-everyone']);
  });

  it("is a 404, not a 403, when a learner guesses another's block id", async () => {
    const other = (await publish(blockFor(theirs, 'their-first'))).json().block.blockId as string;

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/blocks/${other}`,
      headers: auth('learner-token'),
    });

    // Whether it exists is not the caller's business (ADR-0012 rule 4).
    expect(response.statusCode).toBe(404);
  });

  it("will not open a lesson inside another learner's block", async () => {
    const other = (await publish(blockFor(theirs, 'their-first'))).json().block.blockId as string;

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${other}.l1`,
      headers: auth('learner-token'),
    });

    expect(response.statusCode).toBe(404);
  });

  it("will not file work against another learner's lesson", async () => {
    const other = (await publish(blockFor(theirs, 'their-first'))).json().block.blockId as string;

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${other}.l1/submissions`,
      headers: auth('learner-token'),
      payload: { answers: [{ ref: 'schrijf', text: 'Ik schrijf vijf zinnen over mijn werk.' }] },
    });

    // Otherwise the evidence lands in somebody else's error log and enrols the writer in a block
    // they cannot open.
    expect(response.statusCode).toBe(404);
  });

  // --- what a republish may touch -------------------------------------------

  it("leaves another learner's block untouched when one is republished", async () => {
    await publish(blockFor(mine, 'my-first'));
    await publish(blockFor(theirs, 'their-first'));

    // Republish mine with one lesson instead of two — a real content drop, the case the sweep runs for.
    const republished = await publish(blockFor(mine, 'my-first', { lessons: [TEST_BLOCK.lessons[0]] }));
    expect(republished.statusCode).toBe(201);

    expect((await blocksVisibleTo('other-token')).map((block) => block.slug)).toEqual(['their-first']);
    const theirLessons = await harness.store.collections.lessons.countDocuments({
      blockId: (await blocksVisibleTo('other-token'))[0]?.blockId,
    });
    expect(theirLessons).toBe(2);
  });

  it("keeps another learner's drill progress through a republish", async () => {
    const myBlock = (await publish(blockFor(mine, 'my-first'))).json().block.blockId as string;
    const theirBlock = (await publish(blockFor(theirs, 'their-first'))).json().block.blockId as string;

    const drills = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${theirBlock}&kind=term&limit=50`,
      headers: auth('other-token'),
    });
    const item = drills.json().items[0] as { drillItemId: string; prompt: { prompt: string } };
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/drills/${item.drillItemId}/attempts`,
      headers: auth('other-token'),
      payload: { stage: 1, given: 'nonsense so the attempt is recorded either way' },
    });

    const before = await harness.store.collections.drillState.countDocuments({ learnerId: theirs });
    expect(before).toBeGreaterThan(0);

    await publish(blockFor(mine, 'my-first', { lessons: [TEST_BLOCK.lessons[0]], drillItems: [] }));

    expect(await harness.store.collections.drillState.countDocuments({ learnerId: theirs })).toBe(before);
    expect(await harness.store.collections.drillItems.countDocuments({ blockId: theirBlock })).toBeGreaterThan(0);
    expect(myBlock).not.toBe(theirBlock);
  });

  // --- the quiz loop, which reads a deck by block ---------------------------

  const QUESTION = {
    payload: {
      kind: 'mcq' as const,
      stem: 'Scenario: a team needs a thing. Which option meets the requirement?',
      options: [
        { ref: 'a', text: 'Option A' },
        { ref: 'b', text: 'Option B' },
      ],
      correct: ['a'],
      explanation: 'Because option A satisfies the stated constraint.',
      categories: ['word-order'],
    },
  };

  const startQuiz = async (blockId: string, token: string) =>
    harness.app.inject({
      method: 'POST',
      url: '/api/v1/quiz/sessions',
      headers: auth(token),
      payload: { blockId, mode: 'practice' },
    });

  it('finds the questions in a block written for the learner sitting it', async () => {
    const myBlock = (await publish(blockFor(mine, 'my-first', { drillItems: [QUESTION] }))).json().block
      .blockId as string;

    // An owned block's questions carry their owner's id, so a deck read without one returns nothing
    // and the learner is told their own block has no questions in it.
    const response = await startQuiz(myBlock, 'learner-token');

    expect(response.statusCode).toBe(201);
    expect(response.json().session.itemIds).toHaveLength(1);
    expect(response.json().current).not.toBeNull();
  });

  it("will not sit a quiz on another learner's block", async () => {
    const other = (await publish(blockFor(theirs, 'their-first', { drillItems: [QUESTION] }))).json().block
      .blockId as string;

    expect((await startQuiz(other, 'learner-token')).statusCode).toBe(404);
  });

  it("keeps a learner's own word inside a block that is already theirs", async () => {
    const myBlock = (await publish(blockFor(mine, 'my-first'))).json().block.blockId as string;

    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/blocks/${myBlock}/terms`,
      headers: auth('learner-token'),
      payload: { term: 'de etalage', translation: 'the shop window' },
    });

    // The sweep now matches on where an item came from, not on whether it names an owner — inside an
    // owned block the published items name one too, so `learnerId` alone would have spared them and
    // the drop below would have been a no-op.
    await publish(blockFor(mine, 'my-first', { lessons: [TEST_BLOCK.lessons[0]], drillItems: [] }));

    const remaining = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/blocks/${myBlock}/terms`,
      headers: auth('learner-token'),
    });
    const words = remaining.json().terms as { payload: { term: string } }[];
    expect(words.map((word) => word.payload.term)).toEqual(['de etalage']);
  });

  it('does not offer a learner the delete button on their own curriculum', async () => {
    const myBlock = (await publish(blockFor(mine, 'my-first'))).json().block.blockId as string;

    const listed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/blocks/${myBlock}/terms`,
      headers: auth('learner-token'),
    });

    // Published vocabulary in an owned block carries this learner's id, so only provenance keeps it
    // out of the list of words they added themselves.
    expect(listed.json().terms).toEqual([]);
  });
});
