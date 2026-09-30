/**
 * Word requests over HTTP and MCP (ADR-0023).
 *
 * The loop: a learner names words, a coach fills them in, the learner accepts what they want. What is
 * pinned is the boundary: the coach sees the word and its languages and nothing about who asked; a
 * learner sees only their own requests; nothing a coach writes reaches a deck until the learner
 * accepts it; and what reaches the deck is what they accepted.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

const WORDS = {
  packId: 'words-skill',
  title: { en: 'Word trainer' },
  contentLanguage: 'nl',
  translationLanguage: 'en',
  skill: 'vocabulary',
  framework: { id: 'cefr', levels: ['B1'] },
  presentation: { surfaces: ['drills:terms'] },
};
const DECK = { order: 1, slug: 'word-list', title: 'Word list' };
const DECK_ID = 'words-skill.b1';

const SUGGESTION = {
  translation: 'to disappear, to vanish',
  example: 'De kat verdween achter het huis.',
  details: {
    partOfSpeech: 'verb — strong',
    forms: [{ label: 'past', value: 'verdween, verdwenen' }],
    exampleTranslation: 'The cat disappeared behind the house.',
    synonyms: ['wegraken'],
    antonyms: ['verschijnen'],
  },
};

describeIfMongo('word requests', () => {
  let harness: Harness;

  beforeAll(async () => {
    // The MCP endpoint is only mounted when it knows its own resource URL.
    harness = await createHarness(undefined, { MCP_RESOURCE_URL: 'https://coach.example.invalid/mcp' });
  });
  afterAll(async () => {
    await harness.close();
  });

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    token: string,
    payload?: Record<string, unknown>,
  ) => harness.app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });

  const ask = (terms: string[], token = 'learner-token') =>
    call('POST', `/api/v1/blocks/${DECK_ID}/term-requests`, token, { terms });
  const mine = async (token = 'learner-token') =>
    (await call('GET', `/api/v1/blocks/${DECK_ID}/term-requests`, token)).json().requests;
  const queue = async () => (await call('GET', '/coach/v1/term-requests', 'coach-token')).json().requests;
  const suggest = (requestId: string, suggestion: Record<string, unknown> = SUGGESTION) =>
    call('PUT', `/coach/v1/term-requests/${requestId}/suggestion`, 'coach-token', suggestion);

  beforeEach(async () => {
    await harness.reset();
    await call('POST', '/coach/v1/packs', 'coach-token', WORDS);
    await call('POST', `/coach/v1/packs/${WORDS.packId}/blocks`, 'coach-token', DECK);
  });

  it('queues the words a learner asks for, once each', async () => {
    const response = await ask(['verdwijnen', '  ondanks ', 'Verdwijnen', '']);

    expect(response.statusCode).toBe(201);
    expect(response.json().requests.map((entry: { term: string }) => entry.term)).toEqual(['verdwijnen', 'ondanks']);

    // Asking again returns the request already waiting rather than a second one.
    await ask(['verdwijnen']);
    expect(await mine()).toHaveLength(2);
  });

  it('shows the coach the word and its languages, and nothing about who asked', async () => {
    await ask(['verdwijnen']);

    const [entry] = await queue();

    expect(Object.keys(entry).sort()).toEqual(
      ['contentLanguage', 'requestId', 'requestedAt', 'status', 'term', 'translationLanguage'].sort(),
    );
    expect(entry).toMatchObject({ term: 'verdwijnen', contentLanguage: 'nl', translationLanguage: 'en' });
  });

  it('puts nothing in the deck until the learner accepts', async () => {
    await ask(['verdwijnen']);
    const [entry] = await queue();
    await suggest(entry.requestId);

    expect(await mine()).toEqual([expect.objectContaining({ status: 'suggested', suggestion: SUGGESTION })]);
    const deck = await call('GET', `/api/v1/drills?blockId=${DECK_ID}&kind=term`, 'learner-token');
    expect(deck.json().items).toHaveLength(0);
    // Answered, it leaves the coach's queue.
    expect(await queue()).toHaveLength(0);
  });

  it('adds what the learner accepted — their edits, without what they left out', async () => {
    await ask(['verdwijnen']);
    const [entry] = await queue();
    await suggest(entry.requestId);

    const accepted = await call('POST', `/api/v1/term-requests/${entry.requestId}/accept`, 'learner-token', {
      translation: 'to disappear',
      omit: ['antonyms'],
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().request.status).toBe('added');
    expect(accepted.json().item.payload).toEqual({
      kind: 'term',
      term: 'verdwijnen',
      translation: 'to disappear',
      example: SUGGESTION.example,
      details: {
        partOfSpeech: 'verb — strong',
        forms: [{ label: 'past', value: 'verdween, verdwenen' }],
        exampleTranslation: 'The cat disappeared behind the house.',
        synonyms: ['wegraken'],
      },
    });

    // An ordinary own word from here on: practised like any other, and the card shows after answering.
    const deck = await call('GET', `/api/v1/drills?blockId=${DECK_ID}&kind=term`, 'learner-token');
    const [item] = deck.json().items;
    const answer = await call('POST', `/api/v1/drills/${item.drillItemId}/attempts`, 'learner-token', {
      stage: 1,
      given: 'to disappear',
    });
    expect(answer.json()).toMatchObject({ correct: true, details: { synonyms: ['wegraken'] } });
  });

  it('refuses to accept a word nobody has filled in yet', async () => {
    const [request] = (await ask(['ondanks'])).json().requests;
    const response = await call('POST', `/api/v1/term-requests/${request.requestId}/accept`, 'learner-token', {});
    expect(response.statusCode).toBe(409);
  });

  it('sends a word back to the coach, without the old suggestion', async () => {
    await ask(['verdwijnen']);
    const [entry] = await queue();
    await suggest(entry.requestId);

    const retried = await call('POST', `/api/v1/term-requests/${entry.requestId}/retry`, 'learner-token');

    expect(retried.json().request.status).toBe('requested');
    expect(retried.json().request.suggestion).toBeUndefined();
    expect(await queue()).toHaveLength(1);
  });

  it('throws a request away, and it can be asked for again', async () => {
    const [request] = (await ask(['ondanks'])).json().requests;

    const discarded = await call('DELETE', `/api/v1/term-requests/${request.requestId}`, 'learner-token');
    expect(discarded.json().request.status).toBe('discarded');
    expect(await queue()).toHaveLength(0);

    const again = await ask(['ondanks']);
    expect(again.json().requests[0].requestId).not.toBe(request.requestId);
  });

  it('keeps each learner’s requests to themselves', async () => {
    const [request] = (await ask(['ondanks'])).json().requests;
    // Another learner cannot see, accept, retry or discard it — it does not exist for them.
    await call('GET', '/api/v1/me', 'other-token');
    expect((await call('POST', `/api/v1/term-requests/${request.requestId}/retry`, 'other-token')).statusCode).toBe(
      404,
    );
    expect((await call('DELETE', `/api/v1/term-requests/${request.requestId}`, 'other-token')).statusCode).toBe(404);
  });

  it('is a coach’s job to suggest, and a learner’s to ask', async () => {
    const [request] = (await ask(['ondanks'])).json().requests;

    expect((await call('GET', '/coach/v1/term-requests', 'learner-token')).statusCode).toBe(403);
    expect(
      (await call('PUT', `/coach/v1/term-requests/${request.requestId}/suggestion`, 'learner-token', SUGGESTION))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/api/v1/blocks/${DECK_ID}/term-requests`, 'coach-token', { terms: ['x'] })).statusCode,
    ).toBe(403);
  });

  it('refuses a suggestion without a translation', async () => {
    const [request] = (await ask(['ondanks'])).json().requests;
    expect((await suggest(request.requestId, { translation: '' })).statusCode).toBe(400);
  });

  it('works the same over MCP', async () => {
    await ask(['verdwijnen']);
    const rpc = (method: string, params: Record<string, unknown>) =>
      harness.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...auth('coach-token'), accept: 'application/json, text/event-stream' },
        payload: { jsonrpc: '2.0', id: 1, method, params },
      });

    const listed = await rpc('tools/call', { name: 'list_term_requests', arguments: {} });
    const text = JSON.parse(listed.json().result.content[0].text);
    expect(text.requests).toHaveLength(1);

    await rpc('tools/call', {
      name: 'suggest_term',
      arguments: { requestId: text.requests[0].requestId, suggestion: SUGGESTION },
    });
    expect(await mine()).toEqual([expect.objectContaining({ status: 'suggested' })]);
  });
});
