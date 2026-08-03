/**
 * Authorization at the edge (ADR-0002): capabilities are disjoint, an unknown role grants nothing,
 * and one learner cannot reach another's work.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, seed, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

describeIfMongo('authorization', () => {
  let harness: Harness;
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
    ({ blockId, lessonIds } = await seed(harness));
  });

  it('lets health and readiness through without a token', async () => {
    expect((await harness.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await harness.app.inject({ method: 'GET', url: '/ready' })).json().mongo).toBe('ok');
  });

  it('rejects a request with no token', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
  });

  it('rejects a malformed Authorization header', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Basic learner-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('stops a learner publishing content', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('learner-token'),
      payload: { packId: 'sneaky' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('pack:publish');
  });

  it('stops a learner reading the whole submission queue', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/coach/v1/submissions',
      headers: auth('learner-token'),
    });
    expect(response.statusCode).toBe(403);
  });

  /**
   * A brief is about a *person*: it carries their error log and their lesson record. `lesson:read`
   * — which every learner holds, because it is what lets them read published content — must not be
   * enough to open one, or a learner reads whoever else is working through that pack.
   */
  it('stops a learner reading a brief about someone', async () => {
    // Another learner does a lesson, so there is evidence for a brief to be about.
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('other-token'),
      payload: { answers: [{ ref: 'q1', text: 'Ik ben gisteren naar de winkel geweest.' }] },
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/coach/v1/blocks/${blockId}/brief`,
      headers: auth('learner-token'),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('submission:read-all');
  });

  it('stops a learner reading a block review about someone', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/coach/v1/blocks/${blockId}/review`,
      headers: auth('learner-token'),
    });

    expect(response.statusCode).toBe(403);
  });

  it('still lets a coach read both', async () => {
    for (const url of [`/coach/v1/blocks/${blockId}/brief`, `/coach/v1/blocks/${blockId}/review`]) {
      const response = await harness.app.inject({ method: 'GET', url, headers: auth('coach-token') });
      // 404 where nobody has worked in the pack yet — the point is that it is not a 403.
      expect(response.statusCode).not.toBe(403);
    }
  });

  it('stops a coach credential practising as if it were a learner', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}`,
      headers: auth('coach-token'),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('drill:practice');
  });

  it('grants nothing at all for a role this product does not recognise', async () => {
    for (const url of ['/api/v1/me', `/api/v1/drills?blockId=${blockId}`, '/coach/v1/submissions']) {
      const response = await harness.app.inject({ method: 'GET', url, headers: auth('stranger-token') });
      expect(response.statusCode).toBe(403);
    }
  });

  it('treats a token with no roles as the documented baseline learner', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('roleless-token') });
    expect(response.statusCode).toBe(200);
    expect(response.json().learner.subject).toBe('roleless-under-test');
  });

  it('keeps one learner out of another learner’s session log', async () => {
    const submitted = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('learner-token'),
      payload: { answers: [{ ref: 'schrijf', text: 'Mijn werk.' }] },
    });
    const submissionId = submitted.json().submission.submissionId;

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/submissions/${submissionId}`,
      headers: auth('other-token'),
    });
    expect(response.statusCode).toBe(403);
  });

  it('scopes a learner’s submission list to their own work', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonIds[0]}/submissions`,
      headers: auth('learner-token'),
      payload: { answers: [{ ref: 'schrijf', text: 'Mijn werk.' }] },
    });

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/submissions',
      headers: auth('learner-token'),
    });
    const theirs = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/submissions',
      headers: auth('other-token'),
    });
    expect(mine.json().submissions).toHaveLength(1);
    expect(theirs.json().submissions).toHaveLength(0);
  });

  it('creates a thin profile from the token subject, storing no credentials', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('learner-token') });
    const learner = response.json().learner;
    expect(learner.subject).toBe('learner-under-test');
    expect(learner.uiLanguage).toBe('nl');
    expect(Object.keys(learner)).not.toContain('password');
    expect(Object.keys(learner)).not.toContain('roles');
  });

  it('remembers a UI language change', async () => {
    await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth('learner-token'),
      payload: { uiLanguage: 'en' },
    });
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('learner-token') });
    expect(response.json().learner.uiLanguage).toBe('en');
  });

  it('rejects a UI language the product does not ship', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth('learner-token'),
      payload: { uiLanguage: 'de' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('records an audit event for a coach publishing content', async () => {
    const events = await harness.store.collections.auditEvents.find({ action: 'block.publish' }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      resource: `block/${blockId}`,
      actor: { kind: 'client', subject: 'coach-client-under-test' },
    });
  });

  it('returns a uniform error shape for a missing resource', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/lessons/does-not-exist',
      headers: auth('learner-token'),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: 'not_found' });
  });
});
