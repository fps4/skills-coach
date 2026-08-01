/**
 * The whole adaptation loop, end to end through HTTP: publish → learn → submit → correct →
 * error log moves → review closes the block → brief for the next one.
 *
 * This is the test that would catch the boundary in ADR-0001 being broken, because it asserts that
 * the *runtime* moved the counters from a correction that only supplied categories.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, seed, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

if (!available) {
  console.warn('MongoDB unreachable — skipping integration tests. Run `make up` to include them.');
}

describeIfMongo('the coaching loop', () => {
  let harness: Harness;
  let packId: string;
  let blockId: string;
  let lessonIds: string[];

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
    ({ packId, blockId, lessonIds } = await seed(harness));
  });

  // --- publishing -----------------------------------------------------------

  it('publishes a block with its lessons and derives term drills from vocabulary sections', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/blocks/${blockId}`,
      headers: auth('learner-token'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().lessons).toHaveLength(2);

    const drills = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}&limit=50`,
      headers: auth('learner-token'),
    });
    // Two authored word-order items plus two terms lifted from the vocabulary section.
    expect(drills.json().summary.total).toBe(4);
  });

  it('is idempotent — republishing keeps ids, so learner progress survives an edit', async () => {
    const before = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}&limit=50`,
      headers: auth('learner-token'),
    });
    const firstId = before.json().items[0].drillItemId;

    // Practise it once, then republish the same block.
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/drills/${firstId}/attempts`,
      headers: auth('learner-token'),
      payload: { stage: 1, given: 'lead time' },
    });
    await seed(harness);

    const state = await harness.store.collections.drillState.findOne({ drillItemId: firstId });
    expect(state).not.toBeNull();
    expect(state?.attempts).toBe(1);
  });

  it('rejects a block whose focus names a category the pack never declared', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${packId}/blocks`,
      headers: auth('coach-token'),
      payload: { ...(await import('./helpers.js')).TEST_BLOCK, order: 9, slug: 'ninth', focus: ['category:invented'] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('invented');
  });

  // --- the loop -------------------------------------------------------------

  it('runs submit → correct → error log → review → brief', async () => {
    // 1. The learner submits written work.
    const submitted = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('learner-token'),
      payload: {
        answers: [
          { ref: 'vragen.1', text: 'Omdat het is belangrijk.' },
          { ref: 'schrijf', text: 'Ik denk dat het goed is.' },
        ],
        speakingNote: 'Ging redelijk.',
      },
    });
    expect(submitted.statusCode).toBe(201);
    const submissionId = submitted.json().submission.submissionId as string;
    expect(submitted.json().submission.status).toBe('pending');

    // 2. The coach sees it in the queue.
    const queue = await harness.app.inject({
      method: 'GET',
      url: '/coach/v1/submissions?status=pending',
      headers: auth('coach-token'),
    });
    expect(queue.json().submissions.map((s: { submissionId: string }) => s.submissionId)).toContain(submissionId);

    // 3. The coach posts categorised corrections — judgement only, no counters.
    const corrected = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/submissions/${submissionId}/correction`,
      headers: auth('coach-token'),
      payload: {
        items: [
          {
            original: 'Omdat het is belangrijk.',
            corrected: 'Omdat het belangrijk is.',
            categories: ['word-order'],
            explanation: 'Verb goes to the end in a subclause.',
          },
        ],
        ratings: { fluency: 4, accuracy: 3, courage: 5 },
      },
    });
    expect(corrected.statusCode).toBe(201);

    // 4. The RUNTIME moved the counters — this is the ADR-0001 boundary in action.
    const entry = corrected.json().errorLog.find((e: { category: string }) => e.category === 'word-order');
    expect(entry).toMatchObject({ count: 1, status: 'new', cleanBlocks: 0 });

    // 5. The learner reads it back as a session log.
    const log = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/submissions/${submissionId}`,
      headers: auth('learner-token'),
    });
    expect(log.json().submission.status).toBe('corrected');
    expect(log.json().correction.items[0].corrected).toBe('Omdat het belangrijk is.');

    // 6. The block review closes the block and produces the brief.
    const review = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/blocks/${blockId}/review`,
      headers: auth('coach-token'),
      payload: {
        learnerId: log.json().submission.learnerId,
        whatWentWell: 'Full sentences throughout.',
        nextBlockBrief: { redrill: ['word-order'], retire: [], themeAndDifficulty: 'Step up to B1.2.' },
      },
    });
    expect(review.statusCode).toBe(201);

    const brief = await harness.app.inject({
      method: 'GET',
      url: `/coach/v1/blocks/${blockId}/brief`,
      headers: auth('coach-token'),
    });
    expect(brief.statusCode).toBe(200);
    const body = brief.json();

    // The three inputs the brief exists to assemble.
    expect(body.goal.en).toBe(TEST_PACK.goal.en); //                (3) the program goal
    expect(body.nextBlock.ramp.level).toBe('B1.1'); //               (2) the ramp
    expect(body.evidence.errorLog[0].category).toBe('word-order'); //(1) how the learner did
    expect(body.evidence.lessons[0]).toMatchObject({ lessonOrder: 1, status: 'corrected' });
    expect(body.suggestions.fromReview.redrill).toEqual(['word-order']);
    expect(body.nextBlock.order).toBe(2);
  });

  it('refuses a category the pack does not declare, so adaptation cannot silently break', async () => {
    const submitted = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('learner-token'),
      payload: { answers: [{ ref: 'schrijf', text: 'Iets geschreven.' }] },
    });
    const submissionId = submitted.json().submission.submissionId;

    const response = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/submissions/${submissionId}/correction`,
      headers: auth('coach-token'),
      payload: { items: [{ original: 'a', corrected: 'b', categories: ['typo-of-a-category'] }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.unknownCategories).toEqual(['typo-of-a-category']);
  });

  it('refuses to correct the same submission twice', async () => {
    const submitted = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('learner-token'),
      payload: { answers: [{ ref: 'schrijf', text: 'Iets geschreven.' }] },
    });
    const submissionId = submitted.json().submission.submissionId;
    const payload = { items: [{ original: 'a', corrected: 'b', categories: ['spelling'] }] };

    const first = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/submissions/${submissionId}/correction`,
      headers: auth('coach-token'),
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/submissions/${submissionId}/correction`,
      headers: auth('coach-token'),
      payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it('rejects a submission with nothing in it', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('learner-token'),
      payload: { answers: [{ ref: 'schrijf', text: '   ' }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('advances the learner to the next lesson on submission, not on a date', async () => {
    await harness.app.inject({ method: 'GET', url: `/api/v1/packs/${packId}`, headers: auth('learner-token') });
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('learner-token'),
      payload: { answers: [{ ref: 'schrijf', text: 'Klaar.' }] },
    });

    const me = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('learner-token') });
    expect(me.json().enrollments[0]).toMatchObject({ packId, currentLessonOrder: 2 });
  });

  it('reports an answer reference the lesson no longer defines rather than dropping the work', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('learner-token'),
      payload: {
        answers: [
          { ref: 'schrijf', text: 'Goed.' },
          { ref: 'weggehaald.7', text: 'Wees.' },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().unknownRefs).toEqual(['weggehaald.7']);
    expect(response.json().submission.answers).toHaveLength(2);
  });
});
