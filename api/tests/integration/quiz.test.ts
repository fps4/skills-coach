/**
 * The quiz loop, end to end (ADR-0014).
 *
 * The claim this file exists to pin: a learner answering questions produces the *same* evidence a
 * coach's correction produces, so the adaptation machinery downstream — error log, redrill, the
 * brief — needs no knowledge that a question was involved.
 *
 * Synthetic content only (ADR-0006). The questions below are invented and deliberately trivial.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auth, createHarness, mongoAvailable, TEST_PACK, type Harness } from './helpers.js';

const available = await mongoAvailable();
const when = available ? describe : describe.skip;

/** A block of five questions across three categories, so weighting has something to sort. */
const QUIZ_BLOCK = {
  order: 1,
  slug: 'questions',
  title: { en: 'Question block' },
  status: 'published' as const,
  lessons: [{ order: 1, title: { en: 'Only lesson' }, sections: [{ id: 't', kind: 'text' as const, body: 'Intro.' }] }],
  drillItems: [1, 2, 3, 4, 5].map((n) => ({
    payload: {
      kind: 'mcq' as const,
      stem: `Scenario ${n}: a company needs a thing. Which option meets the requirement?`,
      options: [
        { ref: 'a', text: `Option A for ${n}` },
        { ref: 'b', text: `Option B for ${n}` },
        { ref: 'c', text: `Option C for ${n}` },
        { ref: 'd', text: `Option D for ${n}` },
      ],
      // Questions 1–2 test word-order, 3–4 spelling, 5 both. Answer key varies by position.
      correct: n % 2 === 0 ? ['b'] : ['a'],
      explanation: `Because option ${n % 2 === 0 ? 'B' : 'A'} satisfies the stated constraint.`,
      distractors: [{ ref: 'c', why: `Option C ignores the constraint in scenario ${n}.` }],
      categories: n <= 2 ? ['word-order'] : n <= 4 ? ['spelling'] : ['word-order', 'spelling'],
      sourceRefs: ['https://docs.aws.amazon.com/example'],
    },
  })),
};

when('quiz sittings', () => {
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
    await harness.app.inject({
      method: 'POST',
      url: '/coach/v1/packs',
      headers: auth('coach-token'),
      payload: TEST_PACK,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
      headers: auth('coach-token'),
      payload: QUIZ_BLOCK,
    });
    expect(response.statusCode).toBe(201);
    blockId = response.json().block.blockId as string;
  });

  const start = async (body: Record<string, unknown> = {}) =>
    harness.app.inject({
      method: 'POST',
      url: '/api/v1/quiz/sessions',
      headers: auth('learner-token'),
      payload: { blockId, ...body },
    });

  const answer = async (sessionId: string, drillItemId: string, chosen: string[]) =>
    harness.app.inject({
      method: 'POST',
      url: `/api/v1/quiz/sessions/${sessionId}/answers`,
      headers: auth('learner-token'),
      payload: { drillItemId, chosen },
    });

  describe('starting', () => {
    it('assembles a sitting and serves the first question without its key', async () => {
      const response = await start({ size: 3 });
      expect(response.statusCode).toBe(201);
      const body = response.json();

      expect(body.session.itemIds).toHaveLength(3);
      expect(body.session.mode).toBe('practice');
      expect(body.current.prompt.kind).toBe('mcq');
      expect(body.current.prompt.options).toHaveLength(4);

      // The guarantee the whole surface rests on.
      expect(JSON.stringify(body.current)).not.toContain('correct');
      expect(JSON.stringify(body.current)).not.toContain('satisfies the stated constraint');
    });

    it('refuses a block that has no questions', async () => {
      await harness.app.inject({
        method: 'POST',
        url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
        headers: auth('coach-token'),
        payload: { ...QUIZ_BLOCK, order: 2, slug: 'empty', drillItems: [] },
      });
      const response = await start({ blockId: `${TEST_PACK.packId}.b2` });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('answering', () => {
    it('grades against the key and reveals the explanation, in practice mode', async () => {
      const session = (await start({ size: 1 })).json();
      const response = await answer(session.session.sessionId, session.current.drillItemId, ['a']);
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.result).not.toBeNull();
      expect(typeof body.result.correct).toBe('boolean');
      expect(body.result.explanation).toContain('satisfies the stated constraint');
      expect(body.result.sourceRefs).toEqual(['https://docs.aws.amazon.com/example']);
    });

    // The point of exam mode: you commit without being able to check.
    it('withholds the verdict in exam mode', async () => {
      const session = (await start({ size: 2, mode: 'exam' })).json();
      const response = await answer(session.session.sessionId, session.current.drillItemId, ['a']);

      expect(response.statusCode).toBe(200);
      expect(response.json().result).toBeNull();
      // The next question still arrives, so the sitting keeps moving.
      expect(response.json().session.current).not.toBeNull();
    });

    it('refuses a second answer to the same question', async () => {
      const session = (await start({ size: 2 })).json();
      const itemId = session.current.drillItemId as string;
      await answer(session.session.sessionId, itemId, ['a']);
      const again = await answer(session.session.sessionId, itemId, ['b']);
      expect(again.statusCode).toBe(400);
    });

    it('refuses a question that is not in this sitting', async () => {
      const session = (await start({ size: 1 })).json();
      const response = await answer(session.session.sessionId, `${blockId}.d.deadbeef`, ['a']);
      expect(response.statusCode).toBe(400);
    });

    it('keeps one learner out of another’s sitting', async () => {
      const session = (await start({ size: 1 })).json();
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/quiz/sessions/${session.session.sessionId}/answers`,
        headers: auth('other-token'),
        payload: { drillItemId: session.current.drillItemId, chosen: ['a'] },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  /**
   * The load-bearing claim of ADR-0014: a wrong answer is an error-log occurrence, indistinguishable
   * downstream from one a coach reported.
   */
  describe('evidence', () => {
    const answerAllWrong = async (): Promise<void> => {
      let view = (await start({ size: 5 })).json();
      while (view.current) {
        // 'd' is never the key for any question in this block.
        const response = await answer(view.session.sessionId, view.current.drillItemId, ['d']);
        view = response.json().session;
      }
    };

    it('writes the error log from wrong answers, against the pack’s own categories', async () => {
      await answerAllWrong();

      const progress = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/progress?packId=${TEST_PACK.packId}`,
        headers: auth('learner-token'),
      });
      const entries = progress.json().errorLog.entries as { category: string; count: number; status: string }[];

      const wordOrder = entries.find((entry) => entry.category === 'word-order');
      const spelling = entries.find((entry) => entry.category === 'spelling');

      // Questions 1, 2 and 5 tag word-order; 3, 4 and 5 tag spelling.
      expect(wordOrder?.count).toBe(3);
      expect(spelling?.count).toBe(3);
      // Three occurrences is the recurring threshold, so both are already due for re-drill.
      expect(wordOrder?.status).toBe('recurring');
      expect(progress.json().errorLog.redrill).toContain('word-order');
    });

    it('records an example naming what was picked and what was right', async () => {
      const view = (await start({ size: 1 })).json();
      await answer(view.session.sessionId, view.current.drillItemId, ['d']);

      const progress = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/progress?packId=${TEST_PACK.packId}`,
        headers: auth('learner-token'),
      });
      const example = progress.json().errorLog.entries[0].examples.at(-1);
      expect(example.wrong).toMatch(/^Option D/);
      expect(example.right).toMatch(/^Option [AB]/);
    });

    it('leaves the error log alone when the answer is right', async () => {
      const view = (await start({ size: 5 })).json();
      const first = view.current;
      // The key is 'a' or 'b'; try 'a' and only assert on the correct branch.
      const outcome = (await answer(view.session.sessionId, first.drillItemId, ['a'])).json();

      const progress = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/progress?packId=${TEST_PACK.packId}`,
        headers: auth('learner-token'),
      });
      const entries = progress.json().errorLog.entries as unknown[];
      expect(entries).toHaveLength(outcome.result.correct ? 0 : 1);
    });

    it('carries quiz accuracy into the next-block brief', async () => {
      await answerAllWrong();

      const brief = await harness.app.inject({
        method: 'GET',
        url: `/coach/v1/blocks/${blockId}/brief`,
        headers: auth('coach-token'),
      });
      expect(brief.statusCode).toBe(200);

      const quiz = brief.json().evidence.quiz;
      expect(quiz.sessions).toBe(1);
      expect(quiz.score.correct).toBe(0);
      // Weakest first, so an author reads the action off the top of the list.
      expect(quiz.byCategory[0].accuracy).toBe(0);
    });

    // A sitting moves the same drill state as any other practice: this is one machine, not two.
    it('moves drill progress, so two correct in a row retires a question', async () => {
      const view = (await start({ size: 5 })).json();
      const itemId = view.current.drillItemId as string;
      const key = (await answer(view.session.sessionId, itemId, ['a'])).json().result.correct ? 'a' : 'b';

      // A fresh sitting each time, because a question cannot be answered twice within one.
      for (let round = 0; round < 3; round += 1) {
        const next = (await start({ size: 5 })).json();
        const target = next.session.itemIds.includes(itemId) ? itemId : null;
        if (!target) break;
        await answer(next.session.sessionId, target, [key]);
      }

      const decks = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/blocks/${blockId}`,
        headers: auth('learner-token'),
      });
      expect(decks.json().decks.quiz.mastered).toBeGreaterThan(0);
    });
  });

  describe('finishing', () => {
    it('scores the sitting, breaks it down, and returns every question for review', async () => {
      let view = (await start({ size: 3 })).json();
      const sessionId = view.session.sessionId as string;
      while (view.current) {
        view = (await answer(sessionId, view.current.drillItemId, ['a'])).json().session;
      }

      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/quiz/sessions/${sessionId}/finish`,
        headers: auth('learner-token'),
      });
      expect(response.statusCode).toBe(200);

      const results = response.json();
      expect(results.complete).toBe(true);
      expect(results.score.answered).toBe(3);
      expect(results.review).toHaveLength(3);
      // Only now does the key reach the browser — and now it must, or the review teaches nothing.
      expect(results.review[0].correctRefs.length).toBeGreaterThan(0);
      expect(results.review[0].explanation).toBeTruthy();
      expect(results.byCategory.length).toBeGreaterThan(0);
    });

    it('is idempotent — finishing twice keeps the first result', async () => {
      const view = (await start({ size: 1 })).json();
      const sessionId = view.session.sessionId as string;
      const once = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/quiz/sessions/${sessionId}/finish`,
        headers: auth('learner-token'),
      });
      const twice = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/quiz/sessions/${sessionId}/finish`,
        headers: auth('learner-token'),
      });
      expect(once.statusCode).toBe(200);
      expect(twice.statusCode).toBe(200);
      expect(twice.json().session.finishedAt).toBe(once.json().session.finishedAt);
    });

    it('refuses an answer after the sitting is closed', async () => {
      const view = (await start({ size: 2 })).json();
      const sessionId = view.session.sessionId as string;
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/quiz/sessions/${sessionId}/finish`,
        headers: auth('learner-token'),
      });
      const late = await answer(sessionId, view.current.drillItemId, ['a']);
      expect(late.statusCode).toBe(400);
    });
  });

  describe('publishing questions', () => {
    it('rejects a question tagged with a category the pack does not declare', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
        headers: auth('coach-token'),
        payload: {
          ...QUIZ_BLOCK,
          order: 3,
          slug: 'bad-tags',
          drillItems: [
            {
              payload: {
                ...QUIZ_BLOCK.drillItems[0]?.payload,
                categories: ['not-a-real-category'],
              },
            },
          ],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toContain('not-a-real-category');
    });

    it('rejects an answer key naming an option the question does not define', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
        headers: auth('coach-token'),
        payload: {
          ...QUIZ_BLOCK,
          order: 4,
          slug: 'bad-key',
          drillItems: [{ payload: { ...QUIZ_BLOCK.drillItems[0]?.payload, correct: ['z'] } }],
        },
      });
      expect(response.statusCode).toBe(400);
    });

    // Deterministic ids from the stem: editing a distractor must not reset anyone's streak.
    it('keeps learner progress across a republish that edits an option', async () => {
      const view = (await start({ size: 5 })).json();
      const itemId = view.current.drillItemId as string;
      await answer(view.session.sessionId, itemId, ['a']);

      const edited = structuredClone(QUIZ_BLOCK);
      for (const item of edited.drillItems) item.payload.options[2] = { ref: 'c', text: 'Reworded option C' };

      const republish = await harness.app.inject({
        method: 'POST',
        url: `/coach/v1/packs/${TEST_PACK.packId}/blocks`,
        headers: auth('coach-token'),
        payload: edited,
      });
      expect(republish.statusCode).toBe(201);
      expect(republish.json().drillItemsRemoved).toBe(0);

      const after = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/drills?blockId=${blockId}&kind=mcq`,
        headers: auth('learner-token'),
      });
      const item = (after.json().items as { drillItemId: string; progress: { attempts: number } }[]).find(
        (entry) => entry.drillItemId === itemId,
      );
      expect(item?.progress.attempts).toBe(1);
    });
  });
});
