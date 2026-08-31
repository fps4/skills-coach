/**
 * The portable archive: taking your work out, and putting it back.
 *
 * The test that matters most here is the **cross-learner** one. A learner id is a `randomUUID()`
 * minted per identity subject, so the same person on a new deployment is a different learner, and
 * several identifiers are built from a hash of that id. An archive that only round-trips into the
 * account it came from would pass every obvious test and fail at the one job it exists for.
 *
 * Invented content only (ADR-0006).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, mongoAvailable, seed, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

interface Deck {
  items: { drillItemId: string; prompt: { prompt: string }; progress: { streak: number; mastered: boolean } }[];
  summary: { total: number; stage1Cleared: number; mastered: number };
}

describeIfMongo('the portable archive', () => {
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

  const deck = async (token: string): Promise<Deck> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/drills?blockId=${blockId}&kind=term&limit=50`,
      headers: auth(token),
    });
    return response.json() as Deck;
  };

  const answer = async (token: string, drillItemId: string, given: string, stage = 1) =>
    harness.app.inject({
      method: 'POST',
      url: `/api/v1/drills/${drillItemId}/attempts`,
      headers: auth(token),
      payload: { stage, given },
    });

  const exportAs = async (token: string) => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/archive', headers: auth(token) });
    expect(response.statusCode).toBe(200);
    return { response, archive: response.json() };
  };

  const importAs = async (token: string, archive: unknown, query = '') =>
    harness.app.inject({
      method: 'POST',
      url: `/api/v1/archive/import${query}`,
      headers: auth(token),
      payload: archive as object,
    });

  /** Clear a word twice at stage 1, which is what the streak machine calls a cleared direction. */
  const clearOneWord = async (token: string): Promise<string> => {
    const before = await deck(token);
    const item = before.items.find((entry) => entry.prompt.prompt === 'de doorlooptijd');
    if (!item) throw new Error('fixture word missing from the deck');
    await answer(token, item.drillItemId, 'lead time');
    await answer(token, item.drillItemId, 'lead time');
    return item.drillItemId;
  };

  // -------------------------------------------------------------------------

  describe('what the file is', () => {
    it('names itself and its version, so a reader can refuse a file that is not one', async () => {
      const { archive } = await exportAs('learner-token');
      expect(archive.kind).toBe('skills-coach.learner-archive');
      expect(archive.version).toBe(1);
      expect(archive.exportedAt).toEqual(expect.any(String));
    });

    it('comes down as a named attachment rather than a page', async () => {
      const { response } = await exportAs('learner-token');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="skills-coach-\d{4}-\d{2}-\d{2}\.json"$/,
      );
    });

    it('carries no learner id, no subject and no email', async () => {
      await clearOneWord('learner-token');
      const me = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('learner-token') });
      const learnerId = me.json().learner.learnerId as string;

      const { response } = await exportAs('learner-token');
      // The whole file as text: an identifier that leaked into any id, anywhere, would show up here.
      expect(response.body).not.toContain(learnerId);
      expect(response.body).not.toContain('learner-under-test');
      expect(response.body).not.toContain('learner@example.invalid');
    });

    it("carries the learner's practice state but none of the pack's material", async () => {
      await clearOneWord('learner-token');
      const { response, archive } = await exportAs('learner-token');

      expect(archive.drillState.length).toBeGreaterThan(0);
      expect(archive.drillState[0].item).toMatchObject({ pack: TEST_PACK.packId, block: 1, kind: 'term' });
      // The word itself is the pack's. Only its digest travels.
      expect(response.body).not.toContain('de doorlooptijd');
      expect(archive.drillState[0].item.digest).toMatch(/^[0-9a-f]{12}$/);
    });

    it("does carry the learner's own words, which live nowhere else", async () => {
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/blocks/${blockId}/terms`,
        headers: auth('learner-token'),
        payload: { term: 'de steekproef', translation: 'the sample' },
      });
      const { archive } = await exportAs('learner-token');
      expect(archive.ownTerms).toEqual([
        expect.objectContaining({ pack: TEST_PACK.packId, block: 1, term: 'de steekproef', translation: 'the sample' }),
      ]);
    });
  });

  describe('moving to another system', () => {
    it('re-attaches practice state under a learner id it has never seen', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');

      const before = await deck('other-token');
      expect(before.summary.stage1Cleared).toBe(0);

      const report = await importAs('other-token', archive);
      expect(report.statusCode).toBe(200);
      expect(report.json().sections.drillState.applied).toBeGreaterThan(0);
      expect(report.json().sections.drillState.unresolved).toBe(0);

      const after = await deck('other-token');
      expect(after.summary.stage1Cleared).toBe(1);
    });

    it('gives the other learner their own copy of an added word, under their own id', async () => {
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/blocks/${blockId}/terms`,
        headers: auth('learner-token'),
        payload: { term: 'de steekproef', translation: 'the sample' },
      });
      const mine = (await deck('learner-token')).items.find((e) => e.prompt.prompt === 'de steekproef');
      expect(mine).toBeDefined();

      const { archive } = await exportAs('learner-token');
      await importAs('other-token', archive);

      const theirs = (await deck('other-token')).items.find((e) => e.prompt.prompt === 'de steekproef');
      expect(theirs).toBeDefined();
      // The same word, and deliberately *not* the same document: an owner-scoped id is re-derived
      // under whoever imported it, which is the whole reason the file carries parts and not ids.
      expect(theirs?.drillItemId).not.toBe(mine?.drillItemId);
    });

    it('carries the streak on an added word across with it', async () => {
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/blocks/${blockId}/terms`,
        headers: auth('learner-token'),
        payload: { term: 'de steekproef', translation: 'the sample' },
      });
      const mine = (await deck('learner-token')).items.find((e) => e.prompt.prompt === 'de steekproef');
      await answer('learner-token', mine!.drillItemId, 'the sample');

      const { archive } = await exportAs('learner-token');
      await importAs('other-token', archive);

      const theirs = (await deck('other-token')).items.find((e) => e.prompt.prompt === 'de steekproef');
      expect(theirs?.progress.streak).toBe(1);
    });

    it('reports what it could not resolve rather than inventing it', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');
      // A file from a system whose pack was never published here.
      for (const entry of archive.drillState) entry.item.pack = 'a-pack-that-was-never-published';

      const report = await importAs('other-token', archive);
      const body = report.json();
      expect(body.sections.drillState.applied).toBe(0);
      expect(body.sections.drillState.unresolved).toBeGreaterThan(0);
      expect(body.examples[0]).toMatchObject({ section: 'drillState', why: expect.stringContaining('no such') });
      // Nothing was fabricated to make the numbers add up.
      expect((await deck('other-token')).summary.stage1Cleared).toBe(0);
    });

    it('says how far the packs have moved since the file was written', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');
      const report = await importAs('other-token', archive);
      expect(report.json().packs).toContainEqual({ packId: TEST_PACK.packId, archived: 1, live: 1 });
    });
  });

  describe('putting a file back where it came from', () => {
    it('restores progress that was reset in between', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');

      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/drills/reset',
        headers: auth('learner-token'),
        payload: { blockId },
      });
      expect((await deck('learner-token')).summary.stage1Cleared).toBe(0);

      await importAs('learner-token', archive);
      expect((await deck('learner-token')).summary.stage1Cleared).toBe(1);
    });

    it('changes nothing when the file is already what is live', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');

      const report = await importAs('learner-token', archive);
      const sections = report.json().sections;
      expect(sections.drillState.applied).toBe(0);
      expect(sections.drillState.unchanged).toBeGreaterThan(0);
      expect(sections.attempts.applied).toBe(0);
    });

    it('is idempotent: importing twice adds nothing the second time', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');
      await importAs('other-token', archive);
      const second = await importAs('other-token', archive);
      const sections = second.json().sections;
      for (const name of Object.keys(sections)) {
        expect({ [name]: sections[name].applied }).toEqual({ [name]: 0 });
      }
    });
  });

  describe('never demoting', () => {
    it('cannot un-clear a word with a stale file', async () => {
      // A file taken before any practice at all.
      const { archive: stale } = await exportAs('learner-token');
      await clearOneWord('learner-token');
      expect((await deck('learner-token')).summary.stage1Cleared).toBe(1);

      await importAs('learner-token', stale);
      expect((await deck('learner-token')).summary.stage1Cleared).toBe(1);
    });

    it('takes the further-along side when both have practised', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');

      // The other learner has the same word open at stage 1 with a single correct answer.
      const theirs = (await deck('other-token')).items.find((e) => e.prompt.prompt === 'de doorlooptijd');
      await answer('other-token', theirs!.drillItemId, 'lead time');
      expect((await deck('other-token')).summary.stage1Cleared).toBe(0);

      await importAs('other-token', archive);
      expect((await deck('other-token')).summary.stage1Cleared).toBe(1);
    });
  });

  describe('a dry run', () => {
    it('reports what would happen and writes nothing', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');

      const report = await importAs('other-token', archive, '?dryRun=true');
      expect(report.json().dryRun).toBe(true);
      expect(report.json().sections.drillState.applied).toBeGreaterThan(0);

      // The report said what it *would* do. Nothing moved.
      expect((await deck('other-token')).summary.stage1Cleared).toBe(0);
    });

    it('is not recorded in the audit trail, having decided nothing', async () => {
      const { archive } = await exportAs('learner-token');
      await importAs('other-token', archive, '?dryRun=true');
      expect(await harness.store.collections.auditEvents.countDocuments({ action: 'archive.import' })).toBe(0);

      await importAs('other-token', archive);
      expect(await harness.store.collections.auditEvents.countDocuments({ action: 'archive.import' })).toBe(1);
    });
  });

  describe('refusing a file it cannot read', () => {
    it('rejects something that is not an archive', async () => {
      const response = await importAs('learner-token', { hello: 'world' });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid_request');
    });

    it('rejects a version it does not know, rather than applying the part it recognises', async () => {
      const { archive } = await exportAs('learner-token');
      const response = await importAs('learner-token', { ...archive, version: 99 });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('version 99');
    });

    it('rejects a malformed row without applying the rows around it', async () => {
      await clearOneWord('learner-token');
      const { archive } = await exportAs('learner-token');
      archive.drillState[0].item.digest = 'not-a-digest';

      const response = await importAs('other-token', archive);
      expect(response.statusCode).toBe(400);
      // Refused whole. A half-applied archive is worse than a rejected one.
      expect((await deck('other-token')).summary.stage1Cleared).toBe(0);
    });
  });

  describe('the rest of what is yours', () => {
    const learnerIdOf = async (token: string): Promise<string> => {
      const me = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(token) });
      return me.json().learner.learnerId as string;
    };

    const loadArticle = async (owner: string, slug: string) =>
      harness.app.inject({
        method: 'POST',
        url: `/coach/v1/packs/${TEST_PACK.packId}/reading`,
        headers: auth('coach-token'),
        payload: {
          learnerId: owner,
          articles: [
            {
              slug,
              labels: ['netwerken'],
              bodies: [
                { language: 'nl', title: `NL ${slug}`, body: 'Een tekst.', summary: 'Kort.' },
                { language: 'en', title: `EN ${slug}`, body: 'A text.' },
              ],
              source: { url: `https://example.invalid/${slug}`, site: 'Example Blog' },
              estimatedMinutes: 8,
            },
          ],
        },
      });

    const library = async (token: string) => {
      const response = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/packs/${TEST_PACK.packId}/reading?unread=false`,
        headers: auth(token),
      });
      return response.json() as { articles: { articleId: string; slug: string; readAt: string | null }[] };
    };

    it("carries the reading library, and what was read, to another learner's account", async () => {
      await loadArticle(await learnerIdOf('learner-token'), 'a-piece-about-networks');
      const mine = await library('learner-token');
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/reading/${mine.articles[0]!.articleId}/read`,
        headers: auth('learner-token'),
        payload: { read: true },
      });

      const { archive } = await exportAs('learner-token');
      expect(archive.articles).toHaveLength(1);
      expect(archive.articles[0]).toMatchObject({ pack: TEST_PACK.packId, slug: 'a-piece-about-networks' });
      expect(archive.articles[0].readAt).toEqual(expect.any(String));

      const report = await importAs('other-token', archive);
      expect(report.json().sections.articles.applied).toBe(1);

      const theirs = await library('other-token');
      expect(theirs.articles).toHaveLength(1);
      expect(theirs.articles[0]!.readAt).not.toBeNull();
      // Re-created under their own owner tag, not shared with the learner it came from.
      expect(theirs.articles[0]!.articleId).not.toBe(mine.articles[0]!.articleId);
    });

    it('cannot mark an article unread with an archive that never saw it read', async () => {
      await loadArticle(await learnerIdOf('learner-token'), 'a-piece-about-networks');
      const { archive } = await exportAs('learner-token');
      expect(archive.articles[0].readAt).toBeNull();

      // The other learner has read their copy already.
      await loadArticle(await learnerIdOf('other-token'), 'a-piece-about-networks');
      const theirs = await library('other-token');
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/reading/${theirs.articles[0]!.articleId}/read`,
        headers: auth('other-token'),
        payload: { read: true },
      });

      await importAs('other-token', archive);
      expect((await library('other-token')).articles[0]!.readAt).not.toBeNull();
    });

    it('carries written work and the coaching that came back on it', async () => {
      const submitted = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${blockId}.l1/submissions`,
        headers: auth('learner-token'),
        payload: { answers: [{ ref: 'schrijf', text: 'Ik heb gisteren de cursus begonnen.' }] },
      });
      expect(submitted.statusCode).toBe(201);
      const submissionId = submitted.json().submission.submissionId as string;

      await harness.app.inject({
        method: 'POST',
        url: `/coach/v1/submissions/${submissionId}/correction`,
        headers: auth('coach-token'),
        payload: {
          items: [
            {
              original: 'Ik heb gisteren de cursus begonnen.',
              corrected: 'Ik ben gisteren met de cursus begonnen.',
              categories: ['word-order'],
            },
          ],
          note: 'Bijna goed.',
        },
      });

      const { archive } = await exportAs('learner-token');
      expect(archive.submissions).toHaveLength(1);
      expect(archive.submissions[0].lesson).toMatchObject({ pack: TEST_PACK.packId, block: 1, lesson: 1 });
      expect(archive.corrections).toHaveLength(1);
      expect(archive.errorLog).toHaveLength(1);

      const report = await importAs('other-token', archive);
      const sections = report.json().sections;
      expect(sections.submissions.applied).toBe(1);
      expect(sections.corrections.applied).toBe(1);
      expect(sections.errorLog.applied).toBe(1);

      // Under an id of their own: the archived one belongs to the learner it came from, and reusing
      // it would have meant either skipping the row or overwriting somebody else's work.
      const theirs = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/submissions',
        headers: auth('other-token'),
      });
      const restored = theirs.json().submissions[0];
      expect(restored.submissionId).not.toBe(submissionId);

      const log = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/submissions/${restored.submissionId}`,
        headers: auth('other-token'),
      });
      expect(log.statusCode).toBe(200);
      expect(log.json().correction.items[0].corrected).toBe('Ik ben gisteren met de cursus begonnen.');
    });

    it("leaves the original learner's submission exactly where it was", async () => {
      const submitted = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${blockId}.l1/submissions`,
        headers: auth('learner-token'),
        payload: { answers: [{ ref: 'schrijf', text: 'Mijn eigen zin.' }] },
      });
      const submissionId = submitted.json().submission.submissionId as string;

      const { archive } = await exportAs('learner-token');
      await importAs('other-token', archive);

      const log = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/submissions/${submissionId}`,
        headers: auth('learner-token'),
      });
      expect(log.statusCode).toBe(200);
      expect(log.json().submission.answers[0].text).toBe('Mijn eigen zin.');
    });

    it('will not land a correction whose submission did not resolve', async () => {
      const submitted = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${blockId}.l1/submissions`,
        headers: auth('learner-token'),
        payload: { answers: [{ ref: 'schrijf', text: 'Een zin.' }] },
      });
      const submissionId = submitted.json().submission.submissionId as string;
      await harness.app.inject({
        method: 'POST',
        url: `/coach/v1/submissions/${submissionId}/correction`,
        headers: auth('coach-token'),
        payload: { items: [{ original: 'Een zin.', corrected: 'Eén zin.', categories: ['spelling'] }] },
      });

      const { archive } = await exportAs('learner-token');
      // The lesson is not on the target system.
      archive.submissions[0].lesson.lesson = 99;

      const report = await importAs('other-token', archive);
      const sections = report.json().sections;
      expect(sections.submissions.unresolved).toBe(1);
      // Feedback on nothing has no left-hand page to print, so it waits rather than landing alone.
      expect(sections.corrections.applied).toBe(0);
      expect(sections.corrections.unresolved).toBe(1);
    });
  });

  describe('authorization', () => {
    it('lets a coach neither export nor import — this is a learner surface', async () => {
      expect(
        (await harness.app.inject({ method: 'GET', url: '/api/v1/archive', headers: auth('coach-token') })).statusCode,
      ).toBe(403);
      expect((await importAs('coach-token', {})).statusCode).toBe(403);
    });

    it('needs a token to reach at all', async () => {
      expect((await harness.app.inject({ method: 'GET', url: '/api/v1/archive' })).statusCode).toBe(401);
    });
  });
});
