/**
 * A skill is written in one language (ADR-0026) — and packs stored before that still hold
 * `{ nl, en }` where a string now goes.
 *
 * The rule for reading such a value is pinned in `tests/unit/pack-text.test.ts`. What is pinned here
 * is that it is applied at the read boundary, so a learner and a coach both get strings from a pack,
 * block and lesson stored in the old shape, and that a republish replaces the old shape in storage.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, seed, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

describeIfMongo('pack text stored per language', () => {
  let harness: Harness;
  let blockId: string;
  let lessonId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const seeded = await seed(harness);
    blockId = seeded.blockId;
    lessonId = seeded.lessonIds[0] as string;

    // Put the documents back the way a pack published before ADR-0026 left them.
    const c = harness.store.collections;
    const legacy = (value: Record<string, string>) => value as unknown as string;
    await c.packs.updateOne(
      { _id: TEST_PACK.packId },
      {
        $set: {
          title: legacy({ nl: 'Testpakket', en: 'Test pack' }),
          description: legacy({ nl: 'Een beschrijving' }),
          'errorCategories.0.label': legacy({ nl: 'Woordvolgorde', en: 'Word order' }),
          presentation: { palette: 'blue', tagline: legacy({ en: 'A tour' }) },
        },
      },
    );
    await c.blocks.updateOne({ _id: blockId }, { $set: { title: legacy({ nl: 'Eerste blok', en: 'First block' }) } });
    await c.lessons.updateOne({ _id: lessonId }, { $set: { title: legacy({ nl: 'Les een' }) } });
  });

  it('serves a learner strings from a pack, block and lesson stored the old way', async () => {
    const pack = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/packs/${TEST_PACK.packId}`,
      headers: auth('learner-token'),
    });
    expect(pack.statusCode).toBe(200);
    expect(pack.json().pack.title).toBe('Test pack');
    // No English: the content language (`nl`) is next in line.
    expect(pack.json().pack.description).toBe('Een beschrijving');
    expect(pack.json().pack.errorCategories[0].label).toBe('Word order');
    expect(pack.json().pack.presentation).toEqual({ palette: 'blue', tagline: 'A tour' });
    expect(pack.json().blocks[0].title).toBe('First block');

    const lesson = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}`,
      headers: auth('learner-token'),
    });
    expect(lesson.json().lesson.title).toBe('Les een');
  });

  it('serves a coach the same strings', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/coach/v1/packs', headers: auth('coach-token') });
    const pack = response.json().packs.find((entry: { packId: string }) => entry.packId === TEST_PACK.packId);
    expect(pack.title).toBe('Test pack');
  });

  it('writes the new shape when the pack is republished', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('coach-token'),
      payload: TEST_PACK,
    });
    expect(response.statusCode).toBe(200);

    const stored = await harness.store.collections.packs.findOne({ _id: TEST_PACK.packId });
    expect(stored?.title).toBe(TEST_PACK.title);
    expect(stored?.description).toBeUndefined();
  });

  it('refuses a republish that still gives text per language, naming the rule', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('coach-token'),
      payload: { ...TEST_PACK, title: { nl: 'Testpakket', en: 'Test pack' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatch(/one language/);
  });
});
