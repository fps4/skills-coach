/**
 * The learner's domain profile, and the brief that carries it (ADR-0015).
 *
 * A pack says how hard the next block should be and how it should be built. Neither says what it
 * should be *about* — and before this, nothing did: the domain arrived implicitly, through whoever
 * the pack's first learner happened to be. The profile is where it lives now, and the brief is how
 * it reaches whoever authors the block.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, TEST_BLOCK, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

const PROFILE = {
  domain: 'retail leadership and training design',
  background: 'Twenty years on the shop floor and in head office. Trained forty associates last year.',
  targetRole: 'trainer and adviser, working in Dutch',
  register: 'formal in an interview, informal on the floor',
};

describeIfMongo('the learner profile', () => {
  let harness: Harness;
  let learnerId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  const me = async (token = 'learner-token') =>
    harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(token) });

  const setProfileAsCoach = async (profile: Record<string, unknown>) =>
    harness.app.inject({
      method: 'PUT',
      url: `/coach/v1/learners/${learnerId}/profile`,
      headers: auth('coach-token'),
      payload: profile,
    });

  const firstBrief = async () =>
    harness.app.inject({
      method: 'GET',
      url: `/coach/v1/packs/${TEST_PACK.packId}/brief?learnerId=${learnerId}`,
      headers: auth('coach-token'),
    });

  const publish = async (block: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
      headers: auth('coach-token'),
      payload: block,
    });

  beforeEach(async () => {
    await harness.reset();
    await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('coach-token'),
      payload: TEST_PACK,
    });
    learnerId = (await me()).json().learner.learnerId as string;
  });

  // --- writing it -----------------------------------------------------------

  it('lets a learner write their own', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth('learner-token'),
      payload: { profile: PROFILE },
    });

    expect(response.statusCode).toBe(200);
    expect((await me()).json().learner.profile).toEqual(PROFILE);
  });

  it('replaces wholesale rather than merging, so a removed field is removed', async () => {
    await setProfileAsCoach(PROFILE);
    await setProfileAsCoach({ domain: 'something else entirely' });

    expect((await me()).json().learner.profile).toEqual({ domain: 'something else entirely' });
  });

  it('refuses a learner writing somebody else’s', async () => {
    // No `pack:publish` on a learner token — the profile is authoring context, and it carries the
    // authority of publishing the blocks written from it.
    const response = await harness.app.inject({
      method: 'PUT',
      url: `/coach/v1/learners/${learnerId}/profile`,
      headers: auth('learner-token'),
      payload: PROFILE,
    });

    expect(response.statusCode).toBe(403);
  });

  it('reports on the learner list whether one has been written', async () => {
    const before = await harness.app.inject({
      method: 'GET',
      url: '/coach/v1/learners',
      headers: auth('coach-token'),
    });
    expect(before.json().learners.find((l: { learnerId: string }) => l.learnerId === learnerId).hasProfile).toBe(false);

    await setProfileAsCoach(PROFILE);

    const after = await harness.app.inject({
      method: 'GET',
      url: '/coach/v1/learners',
      headers: auth('coach-token'),
    });
    expect(after.json().learners.find((l: { learnerId: string }) => l.learnerId === learnerId).hasProfile).toBe(true);
  });

  it('keeps the profile off the learner list itself', async () => {
    await setProfileAsCoach(PROFILE);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/coach/v1/learners',
      headers: auth('coach-token'),
    });

    // A list is for choosing who to author for; the profile is fetched when you get there.
    expect(response.json().learners[0]).not.toHaveProperty('profile');
  });

  // --- the brief before there is a block ------------------------------------

  it('briefs the first block, which had nowhere to come from before', async () => {
    await setProfileAsCoach(PROFILE);

    const response = await firstBrief();
    const brief = response.json();

    expect(response.statusCode).toBe(200);
    expect(brief.completedBlock).toBeNull();
    expect(brief.nextBlock.order).toBe(1);
    expect(brief.nextBlock.ramp.level).toBe('B1.1');
    expect(brief.nextBlock.ramp.dials).toEqual({ textLength: 'short' });
    expect(brief.learner.profile).toEqual(PROFILE);
    expect(brief.goal).toEqual(TEST_PACK.goal);
  });

  it('carries an empty evidence half rather than omitting it', async () => {
    const brief = (await firstBrief()).json();

    // Same payload as every other brief, so an author reads one shape and not two.
    expect(brief.evidence.lessons).toEqual([]);
    expect(brief.evidence.errorLog).toEqual([]);
    expect(brief.evidence.redrill).toEqual([]);
    expect(brief.evidence.review).toBeNull();
  });

  it('moves to the next position once a block exists for them', async () => {
    await publish({ ...TEST_BLOCK, slug: 'first', learnerId });

    // Asking again proposes block 2 rather than offering to write over block 1.
    expect((await firstBrief()).json().nextBlock.order).toBe(2);
  });

  it('counts only their own blocks when working out where they are', async () => {
    await publish({ ...TEST_BLOCK, slug: 'somebody-elses', learnerId: 'a-different-learner' });

    expect((await firstBrief()).json().nextBlock.order).toBe(1);
  });

  it('refuses a first brief without saying who it is about', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/coach/v1/packs/${TEST_PACK.packId}/brief`,
      headers: auth('coach-token'),
    });

    // No block to infer a learner from, so guessing would silently brief about the wrong person.
    expect(response.statusCode).toBe(400);
  });

  // --- and in the ordinary brief --------------------------------------------

  it('reaches the author through the brief for a finished block too', async () => {
    await setProfileAsCoach(PROFILE);
    const blockId = (await publish({ ...TEST_BLOCK, slug: 'first', learnerId })).json().block.blockId as string;

    const response = await harness.app.inject({
      method: 'GET',
      url: `/coach/v1/blocks/${blockId}/brief?learnerId=${learnerId}`,
      headers: auth('coach-token'),
    });
    const brief = response.json();

    expect(brief.learner.learnerId).toBe(learnerId);
    expect(brief.learner.profile).toEqual(PROFILE);
    // Beside the method, not instead of it: how hard, how built, what about.
    expect(brief.pack.errorCategories).toHaveLength(TEST_PACK.errorCategories.length);
  });
});
