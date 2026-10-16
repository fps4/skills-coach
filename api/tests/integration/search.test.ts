/**
 * Search, end to end (ADR-0030).
 *
 * The guarantees under test: a write is searchable as soon as it succeeds, without waiting for a
 * rebuild; what stops being visible stops being findable; a learner's own word is found by them and
 * by nobody else; and the build at boot picks up what was written outside the process. The guide
 * corpus is a synthetic one written to a temporary directory. Invented content only (ADR-0006).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { auth, createHarness, mongoAvailable, seed, TEST_BLOCK, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

interface Hit {
  kind: 'guide' | 'card';
  skillId: string;
  skillTitle: string;
  title: string;
  slug?: string;
  anchor?: string;
  blockId?: string;
  snippet: { text: string; match?: boolean }[];
}

describeIfMongo('search', () => {
  let harness: Harness;
  let skillsDir: string;
  let blockId: string;

  beforeAll(async () => {
    skillsDir = mkdtempSync(join(tmpdir(), 'skills-coach-search-'));
    mkdirSync(join(skillsDir, TEST_PACK.packId, 'guides'), { recursive: true });
    writeFileSync(
      join(skillsDir, TEST_PACK.packId, 'guides', 'werkwoorden.md'),
      [
        '---',
        'title: Werkwoorden',
        'summary: A synthetic guide to verbs.',
        '---',
        '',
        '## Scheidbare werkwoorden',
        '',
        'A separable verb splits in a main clause.',
        '',
        '## Het voltooid deelwoord',
        '',
        'The past participle takes ge- in front.',
      ].join('\n'),
    );
    harness = await createHarness(undefined, { SKILLS_DIR: skillsDir });
  });

  afterAll(async () => {
    await harness.close();
    rmSync(skillsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await harness.reset();
    ({ blockId } = await seed(harness));
  });

  const search = async (q: string, token = 'learner-token', extra = '') => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${encodeURIComponent(q)}${extra}`,
      headers: auth(token),
    });
    return response;
  };
  const hits = async (q: string, token = 'learner-token') => (await search(q, token)).json().hits as Hit[];

  it('finds a guide section and says where on the page it is', async () => {
    const [first] = await hits('separable');
    expect(first).toMatchObject({
      kind: 'guide',
      skillId: TEST_PACK.packId,
      skillTitle: TEST_PACK.title,
      title: 'Scheidbare werkwoorden',
      slug: 'werkwoorden',
      anchor: 'scheidbare-werkwoorden',
    });
    expect(first?.snippet.find((part) => part.match)?.text).toBe('separable');
  });

  it('finds a published card without waiting for a rebuild', async () => {
    const found = await hits('doorlooptijd');
    expect(found).toContainEqual(expect.objectContaining({ kind: 'card', title: 'de doorlooptijd', blockId }));
  });

  it('forgets a card the moment its block is archived', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/blocks/${blockId}/archive`,
      headers: auth('coach-token'),
    });
    expect((await hits('doorlooptijd')).filter((hit) => hit.kind === 'card')).toEqual([]);
  });

  it('forgets a card a republish no longer defines', async () => {
    const [lesson, ...rest] = TEST_BLOCK.lessons;
    const withoutDoorlooptijd = {
      ...TEST_BLOCK,
      lessons: [
        {
          ...lesson!,
          sections: lesson!.sections.map((section) =>
            section.kind === 'vocabulary'
              ? { ...section, items: section.items.filter((item) => item.term !== 'de doorlooptijd') }
              : section,
          ),
        },
        ...rest,
      ],
    };
    const response = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
      headers: auth('coach-token'),
      payload: withoutDoorlooptijd,
    });
    expect(response.statusCode).toBe(201);

    expect(await hits('doorlooptijd')).not.toContainEqual(expect.objectContaining({ kind: 'card' }));
    expect(await hits('ingewikkeld')).toContainEqual(expect.objectContaining({ kind: 'card', title: 'ingewikkeld' }));
  });

  it("finds a learner's own word for them, and for nobody else", async () => {
    const added = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/blocks/${blockId}/terms`,
      headers: auth('learner-token'),
      payload: { term: 'de begroting', translation: 'the budget' },
    });
    expect(added.statusCode).toBe(201);

    expect(await hits('begroting')).toContainEqual(expect.objectContaining({ title: 'de begroting' }));
    expect(await hits('begroting', 'other-token')).toEqual([]);

    const { term } = added.json() as { term: { drillItemId: string } };
    await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/terms/${encodeURIComponent(term.drillItemId)}`,
      headers: auth('learner-token'),
    });
    expect(await hits('begroting')).toEqual([]);
  });

  it('names a skill by its title, and follows a change to it', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('coach-token'),
      payload: { ...TEST_PACK, title: 'Renamed pack' },
    });
    const [first] = await hits('doorlooptijd');
    expect(first?.skillTitle).toBe('Renamed pack');
  });

  it('answers an empty query with nothing, and refuses an absurdly long one', async () => {
    const empty = await search('   ');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ hits: [], total: 0 });

    expect((await search('x'.repeat(201))).statusCode).toBe(400);
  });

  it('filters by kind and still counts both', async () => {
    const response = (await search('werkwoorden', 'learner-token', '&kind=card')).json();
    expect(response.hits).toEqual([]);
    expect(response.counts.guide).toBeGreaterThan(0);
  });

  it('records nothing — no attempt, no drill state, no audit event', async () => {
    const before = await Promise.all([
      harness.store.collections.attempts.countDocuments(),
      harness.store.collections.drillState.countDocuments(),
      harness.store.collections.auditEvents.countDocuments(),
    ]);
    await hits('doorlooptijd');
    const after = await Promise.all([
      harness.store.collections.attempts.countDocuments(),
      harness.store.collections.drillState.countDocuments(),
      harness.store.collections.auditEvents.countDocuments(),
    ]);
    expect(after).toEqual(before);
  });

  it('picks up, at the next build, a card written outside the process', async () => {
    await harness.store.collections.drillItems.insertOne({
      _id: `${blockId}.d.outside`,
      packId: TEST_PACK.packId,
      blockId,
      payload: { kind: 'term', term: 'de buitenstaander', translation: 'the outsider' },
      origin: 'pack',
    });
    expect(await hits('buitenstaander')).toEqual([]);

    // A second app over the same database stands in for the next rebuild: it builds at boot. It
    // runs as the dev principal, which any bearer token stands for.
    const fresh = await buildApp({ config: harness.config, store: harness.store });
    try {
      const response = await fresh.inject({
        method: 'GET',
        url: '/api/v1/search?q=buitenstaander',
        headers: auth('any-token'),
      });
      expect(response.json().hits).toContainEqual(expect.objectContaining({ title: 'de buitenstaander' }));
    } finally {
      await fresh.close();
    }
  });
});
