/**
 * The reading library (ADR-0017).
 *
 * Three guarantees carry this feature, and all three are here. Material loaded for one learner is
 * invisible to every other learner, including by guessing its id. **Re-loading an article does not
 * mark it unread** — the failure the separate `readingState` document exists to prevent. And the
 * language a learner is served is the one they asked for, or an honest fallback that says so.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, seed, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

const NL = 'Een tekst over netwerken in de cloud, lang genoeg om te lezen.';
const EN = 'A text about cloud networking, long enough to read.';

const bilingual = (slug: string, labels: string[] = ['netwerken']) => ({
  slug,
  labels,
  bodies: [
    { language: 'nl', title: `NL ${slug}`, body: NL, summary: 'Korte samenvatting.' },
    { language: 'en', title: `EN ${slug}`, body: EN },
  ],
  source: { url: `https://example.invalid/${slug}`, site: 'Example Blog' },
  estimatedMinutes: 8,
});

describeIfMongo('the reading library', () => {
  let harness: Harness;
  let learnerId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
    await seed(harness);
    // The profile is created lazily by the first learner call, which is also where its id comes from.
    const me = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('learner-token') });
    learnerId = me.json().learner.learnerId as string;
  });

  const load = async (articles: unknown[], token = 'coach-token', owner?: string) =>
    harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${TEST_PACK.packId}/reading`,
      headers: auth(token),
      payload: { learnerId: owner ?? learnerId, articles },
    });

  const library = async (queryString = '', token = 'learner-token') =>
    harness.app.inject({
      method: 'GET',
      url: `/api/v1/packs/${TEST_PACK.packId}/reading${queryString}`,
      headers: auth(token),
    });

  const setRead = async (articleId: string, read: boolean, token = 'learner-token') =>
    harness.app.inject({
      method: 'POST',
      url: `/api/v1/reading/${articleId}/read`,
      headers: auth(token),
      payload: { read },
    });

  // --- loading --------------------------------------------------------------

  it('loads articles and shows them to the learner they were loaded for', async () => {
    const response = await load([bilingual('failover'), bilingual('graviton', ['compute'])]);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ added: 2, updated: 0 });

    const body = (await library()).json();
    expect(body.articles.map((article: { slug: string }) => article.slug).sort()).toEqual(['failover', 'graviton']);
    expect(body.counts).toEqual({ total: 2, unread: 2 });
  });

  it('refuses a learner trying to load their own reading material', async () => {
    expect((await load([bilingual('failover')], 'learner-token')).statusCode).toBe(403);
  });

  it('refuses an article for a pack that does not exist', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs/no-such-pack/reading',
      headers: auth('coach-token'),
      payload: { learnerId, articles: [bilingual('failover')] },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses two variants in the same language — one of them could never be reached', async () => {
    const response = await load([
      {
        slug: 'failover',
        bodies: [
          { language: 'nl', title: 'Een', body: NL },
          { language: 'nl', title: 'Twee', body: NL },
        ],
      },
    ]);

    expect(response.statusCode).toBe(400);
  });

  it('serves an article whose slug is long, rather than 414ing before the handler', async () => {
    // Fastify caps a route parameter at 100 characters by default, and an article id carries the
    // source article's own slug — a real one ran to 112 and the router answered 414 before auth or
    // any handler saw it. Long enough here to cross that default, so lowering it again fails.
    const slug =
      'accelerate-amazon-s3-replication-with-automated-s3-batch-operations-parallelization-and-cross-region-copy';
    await load([bilingual(slug)]);

    const articleId = (await library()).json().articles[0].articleId as string;
    expect(articleId.length).toBeGreaterThan(100);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/reading/${articleId}`,
      headers: auth('learner-token'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().article.slug).toBe(slug);
  });

  // --- privacy --------------------------------------------------------------

  it('hides one learner’s library from another, by id as well as by list', async () => {
    await load([bilingual('failover')]);
    const articleId = (await library()).json().articles[0].articleId as string;

    const theirs = await library('', 'other-token');
    expect(theirs.json().articles).toEqual([]);

    const guessed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/reading/${articleId}`,
      headers: auth('other-token'),
    });
    // Not found rather than forbidden: to that learner, this article does not exist.
    expect(guessed.statusCode).toBe(404);
  });

  // --- the two filters ------------------------------------------------------

  it('shows only unread by default, and brings a read article back on request', async () => {
    await load([bilingual('failover'), bilingual('graviton')]);
    const articleId = (await library()).json().articles[0].articleId as string;

    expect((await setRead(articleId, true)).statusCode).toBe(200);

    const unread = (await library()).json();
    expect(unread.articles).toHaveLength(1);
    expect(unread.counts).toEqual({ total: 2, unread: 1 });

    const all = (await library('?unread=false')).json();
    expect(all.articles).toHaveLength(2);
    expect(all.articles.filter((article: { readAt: string | null }) => article.readAt).length).toBe(1);
  });

  it('puts an article back to unread', async () => {
    await load([bilingual('failover')]);
    const articleId = (await library()).json().articles[0].articleId as string;

    await setRead(articleId, true);
    expect((await library()).json().articles).toHaveLength(0);

    await setRead(articleId, false);
    expect((await library()).json().articles).toHaveLength(1);
  });

  it('narrows by label, and keeps every label on offer while narrowed', async () => {
    await load([bilingual('failover', ['netwerken', 'aws']), bilingual('graviton', ['compute', 'aws'])]);

    const filtered = (await library('?labels=compute')).json();
    expect(filtered.articles.map((article: { slug: string }) => article.slug)).toEqual(['graviton']);
    // The facets describe the whole library, so the filter is not a trap you cannot get out of.
    expect(filtered.labels.map((facet: { label: string }) => facet.label).sort()).toEqual([
      'aws',
      'compute',
      'netwerken',
    ]);
  });

  it('requires an article to carry every label asked for', async () => {
    await load([bilingual('failover', ['netwerken', 'aws']), bilingual('graviton', ['compute'])]);

    const both = (await library('?labels=netwerken,compute')).json();
    expect(both.articles).toEqual([]);
  });

  // --- language -------------------------------------------------------------

  it('serves the language the interface is in — the switch changes content here', async () => {
    await load([bilingual('failover')]);
    const articleId = (await library()).json().articles[0].articleId as string;

    const dutch = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/reading/${articleId}?language=nl`,
      headers: auth('learner-token'),
    });
    const english = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/reading/${articleId}?language=en`,
      headers: auth('learner-token'),
    });

    expect(dutch.json().article).toMatchObject({ language: 'nl', body: NL, inRequestedLanguage: true });
    expect(english.json().article).toMatchObject({ language: 'en', body: EN, inRequestedLanguage: true });
    expect(english.json().article.languages.sort()).toEqual(['en', 'nl']);
  });

  it('falls back to the language the pack teaches, and says that it did', async () => {
    await load([{ slug: 'alleen-nl', bodies: [{ language: 'nl', title: 'Alleen Nederlands', body: NL }] }]);

    const body = (await library('?language=en')).json();
    expect(body.articles[0]).toMatchObject({ language: 'nl', inRequestedLanguage: false });
  });

  // --- re-loading -----------------------------------------------------------

  it('replaces an article in place, keeping the read mark and its place in the library', async () => {
    await load([bilingual('failover')]);
    const articleId = (await library()).json().articles[0].articleId as string;
    const addedAt = (await library()).json().articles[0].addedAt as string;
    await setRead(articleId, true);

    // The same slug again, with a corrected translation.
    const again = await load([
      {
        ...bilingual('failover'),
        bodies: [
          { language: 'nl', title: 'NL failover, verbeterd', body: `${NL} Gecorrigeerd.` },
          { language: 'en', title: 'EN failover', body: EN },
        ],
      },
    ]);

    expect(again.json()).toMatchObject({ added: 0, updated: 1 });

    const all = (await library('?unread=false')).json();
    expect(all.articles).toHaveLength(1);
    expect(all.articles[0].title).toBe('NL failover, verbeterd');
    // Still read, and still where it was — a correction is not a new article.
    expect(all.articles[0].readAt).not.toBeNull();
    expect(all.articles[0].addedAt).toBe(addedAt);
  });

  // --- the coach's view -----------------------------------------------------

  it('lets a coach see what a learner has been given, without the text', async () => {
    await load([bilingual('failover')]);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/coach/v1/packs/${TEST_PACK.packId}/reading?learnerId=${learnerId}`,
      headers: auth('coach-token'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().articles[0]).toMatchObject({ slug: 'failover', readAt: null });
    expect(response.json().articles[0].body).toBeUndefined();
  });

  it('removes an article and the read mark with it', async () => {
    await load([bilingual('failover')]);
    const articleId = (await library()).json().articles[0].articleId as string;
    await setRead(articleId, true);

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/coach/v1/reading/${articleId}?learnerId=${learnerId}`,
      headers: auth('coach-token'),
    });

    expect(removed.statusCode).toBe(204);
    expect((await library('?unread=false')).json().articles).toEqual([]);
    expect(await harness.store.collections.readingState.countDocuments({ learnerId })).toBe(0);
  });

  // --- the rail -------------------------------------------------------------

  it('carries the unread count into progress, which is what the rail shows', async () => {
    await load([bilingual('failover'), bilingual('graviton')]);
    const articleId = (await library()).json().articles[0].articleId as string;
    await setRead(articleId, true);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/progress?packId=${TEST_PACK.packId}`,
      headers: auth('learner-token'),
    });

    expect(response.json().reading).toEqual({ total: 2, unread: 1 });
  });
});
