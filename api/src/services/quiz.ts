/**
 * Quiz sittings: assembling one, answering through it, and reading it back.
 *
 * Two things this deliberately does *not* do.
 *
 * It does not re-implement grading. An answer goes through `drills.recordAttempt`, the same path the
 * word trainer uses, so a question answered inside a sitting moves the same drill state and writes
 * the same error-log occurrence as one answered outside it. A sitting is a way of *grouping*
 * practice, not a second kind of it.
 *
 * It does not store a score. `scoreSession` and `breakdownByCategory` are pure and run on read — a
 * stored score would be a persisted judgement about a person, which AGENTS.md forbids, and would be
 * able to disagree with the answers it was computed from.
 */

import { forbidden, invalid, notFound } from '../http/errors.js';
import { promptFor, type DrillPrompt } from '../domain/grading.js';
import {
  breakdownByCategory,
  DEFAULT_QUIZ_SIZE,
  isComplete,
  nextItemId,
  scoreSession,
  selectQuizItems,
  type CategoryBreakdown,
  type QuizCandidate,
  type QuizScore,
} from '../domain/quiz.js';
import type { AnswerQuizInput, StartQuizInput } from '../domain/schemas.js';
import type { DrillItem, ErrorStatus, McqPayload, QuizAnswer, QuizSession } from '../domain/types.js';
import type { QuizSessionDoc } from '../db/collections.js';
import { getBlock, listDrillItems } from './content.js';
import { listErrorLog } from './corrections.js';
import { recordAttempt } from './drills.js';
import { newEventId, type ServiceContext } from './context.js';

const toSession = (doc: QuizSessionDoc): QuizSession => {
  const { _id, ...rest } = doc;
  return { ...rest, sessionId: _id };
};

const isMcq = (item: DrillItem): item is DrillItem & { payload: McqPayload } => item.payload.kind === 'mcq';

/** Seeded from the item id, as elsewhere, so a reload shows the same option order. */
function seedFrom(drillItemId: string): number {
  let hash = 0;
  for (const char of drillItemId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash || 1;
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

/**
 * Assemble a sitting from the block's questions, weighted by what the learner keeps getting wrong.
 *
 * Mastered items are excluded but everything else is a candidate, including questions already
 * answered correctly once — the streak rule is what retires an item, and a sitting that only ever
 * showed unseen questions would run out long before the bank did.
 */
export async function startSession(
  ctx: ServiceContext,
  learnerId: string,
  input: StartQuizInput,
): Promise<QuizSessionView> {
  const block = await getBlock(ctx, input.blockId);
  const items = (await listDrillItems(ctx, { blockId: input.blockId, kind: 'mcq' })).filter(isMcq);
  if (items.length === 0) throw notFound(`questions in block ${input.blockId}`);

  const stateDocs = await ctx.store.collections.drillState
    .find({ learnerId, drillItemId: { $in: items.map((item) => item.drillItemId) } })
    .toArray();
  const stateById = new Map(stateDocs.map((doc) => [doc.drillItemId, doc]));

  const candidates: QuizCandidate[] = items
    .filter((item) => !stateById.get(item.drillItemId)?.mastered)
    .map((item) => ({
      drillItemId: item.drillItemId,
      categories: item.payload.categories,
      attempts: stateById.get(item.drillItemId)?.attempts ?? 0,
    }));
  if (candidates.length === 0) throw invalid('every question in this block is mastered');

  const entries = await listErrorLog(ctx, learnerId, block.packId);
  const statusByCategory = new Map<string, ErrorStatus>(entries.map((entry) => [entry.category, entry.status]));

  const itemIds = selectQuizItems(candidates, statusByCategory, input.size ?? DEFAULT_QUIZ_SIZE);

  const doc: QuizSessionDoc = {
    _id: newEventId(),
    learnerId,
    packId: block.packId,
    blockId: block.blockId,
    mode: input.mode,
    itemIds,
    answers: [],
    limitSeconds: input.limitSeconds,
    startedAt: ctx.now(),
  };
  await ctx.store.collections.quizSessions.insertOne(doc);

  return view(ctx, toSession(doc));
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

export interface AnswerOutcome {
  session: QuizSessionView;
  /**
   * The verdict — **withheld in exam mode**, where the whole point is committing to an answer you
   * cannot check. It arrives with the results instead.
   */
  result: {
    correct: boolean;
    expected: string;
    correctRefs: string[];
    explanation?: string;
    distractors?: { ref: string; why: string }[];
    sourceRefs?: string[];
  } | null;
}

export async function answer(
  ctx: ServiceContext,
  learnerId: string,
  sessionId: string,
  input: AnswerQuizInput,
): Promise<AnswerOutcome> {
  const session = await getSession(ctx, learnerId, sessionId);
  if (session.finishedAt) throw invalid('this sitting is already finished');
  if (!session.itemIds.includes(input.drillItemId)) {
    throw invalid('that question is not part of this sitting');
  }
  if (session.answers.some((entry) => entry.drillItemId === input.drillItemId)) {
    // Answering twice would move the drill state twice for one question. The sitting is the record
    // of what was asked once, so this is a conflict rather than an update.
    throw invalid('that question has already been answered in this sitting');
  }

  // Graded by the same path as any other drill attempt — including the error-log write.
  const outcome = await recordAttempt(ctx, learnerId, input.drillItemId, {
    stage: 1,
    given: input.chosen,
    override: false,
  });

  const item = await ctx.store.collections.drillItems.findOne({ _id: input.drillItemId });
  const categories = item?.payload.kind === 'mcq' ? item.payload.categories : [];

  const recorded: QuizAnswer = {
    drillItemId: input.drillItemId,
    chosen: input.chosen,
    correct: outcome.correct,
    categories,
    at: ctx.now(),
  };
  await ctx.store.collections.quizSessions.updateOne({ _id: sessionId }, { $push: { answers: recorded } });

  const updated = { ...session, answers: [...session.answers, recorded] };

  return {
    session: await view(ctx, updated),
    result:
      session.mode === 'exam'
        ? null
        : {
            correct: outcome.correct,
            expected: outcome.expected,
            correctRefs: outcome.correctRefs ?? [],
            explanation: outcome.explanation,
            distractors: outcome.distractors,
            sourceRefs: outcome.sourceRefs,
          },
  };
}

// ---------------------------------------------------------------------------
// Finishing and reading back
// ---------------------------------------------------------------------------

/**
 * Close a sitting. Idempotent — finishing twice keeps the first timestamp.
 *
 * The clock is read **once**, and the value written is the value returned. Calling `ctx.now()` again
 * for the response would hand back a timestamp a millisecond off the one stored, which is a small
 * lie that only ever surfaces as two views of the same sitting disagreeing.
 */
export async function finish(ctx: ServiceContext, learnerId: string, sessionId: string): Promise<QuizResults> {
  const session = await getSession(ctx, learnerId, sessionId);
  if (session.finishedAt) return results(ctx, session);

  const finishedAt = ctx.now();
  await ctx.store.collections.quizSessions.updateOne({ _id: sessionId }, { $set: { finishedAt } });
  return results(ctx, { ...session, finishedAt });
}

export async function getSession(ctx: ServiceContext, learnerId: string, sessionId: string): Promise<QuizSession> {
  const doc = await ctx.store.collections.quizSessions.findOne({ _id: sessionId });
  if (!doc) throw notFound(`quiz session ${sessionId}`);
  // Authenticated, and the resource exists — so a 403, as elsewhere on the learner surface.
  if (doc.learnerId !== learnerId) throw forbidden('this sitting belongs to another learner');
  return toSession(doc);
}

export async function listSessions(
  ctx: ServiceContext,
  learnerId: string,
  scope: { packId?: string; blockId?: string; limit?: number } = {},
): Promise<QuizSession[]> {
  const filter: Record<string, unknown> = { learnerId };
  if (scope.packId) filter.packId = scope.packId;
  if (scope.blockId) filter.blockId = scope.blockId;
  const docs = await ctx.store.collections.quizSessions
    .find(filter)
    .sort({ startedAt: -1 })
    .limit(Math.min(scope.limit ?? 20, 100))
    .toArray();
  return docs.map(toSession);
}

export interface QuizSessionView {
  session: Omit<QuizSession, 'answers'> & { answers: QuizAnswer[] };
  score: QuizScore;
  /** The question to ask now, with its options — or null when the sitting is answered through. */
  current: { drillItemId: string; prompt: DrillPrompt; index: number } | null;
}

async function view(ctx: ServiceContext, session: QuizSession): Promise<QuizSessionView> {
  const nextId = session.finishedAt ? null : nextItemId(session.itemIds, session.answers);
  let current: QuizSessionView['current'] = null;

  if (nextId) {
    const doc = await ctx.store.collections.drillItems.findOne({ _id: nextId });
    if (doc) {
      const item: DrillItem = { ...doc, drillItemId: doc._id };
      current = {
        drillItemId: nextId,
        prompt: promptFor(item, 1, seedFrom(nextId)),
        index: session.itemIds.indexOf(nextId),
      };
    }
  }

  return { session, score: scoreSession(session.itemIds, session.answers), current };
}

export interface QuizResults {
  session: QuizSession;
  score: QuizScore;
  byCategory: CategoryBreakdown[];
  complete: boolean;
  /** Every question asked, with its key and explanation. The review is the point of the sitting. */
  review: {
    drillItemId: string;
    stem: string;
    options: McqPayload['options'];
    chosen: string[];
    correctRefs: string[];
    correct: boolean;
    explanation: string;
    distractors?: { ref: string; why: string }[];
    categories: string[];
    sourceRefs?: string[];
  }[];
}

export async function results(ctx: ServiceContext, session: QuizSession): Promise<QuizResults> {
  const docs = await ctx.store.collections.drillItems.find({ _id: { $in: session.itemIds } }).toArray();
  const byId = new Map(docs.map((doc) => [doc._id, doc]));
  const answerById = new Map(session.answers.map((entry) => [entry.drillItemId, entry]));

  const review: QuizResults['review'] = [];
  for (const id of session.itemIds) {
    const doc = byId.get(id);
    if (!doc || doc.payload.kind !== 'mcq') continue;
    const given = answerById.get(id);
    review.push({
      drillItemId: id,
      stem: doc.payload.stem,
      options: doc.payload.options,
      chosen: given?.chosen ?? [],
      correctRefs: doc.payload.correct,
      correct: given?.correct ?? false,
      explanation: doc.payload.explanation,
      distractors: doc.payload.distractors,
      categories: doc.payload.categories,
      sourceRefs: doc.payload.sourceRefs,
    });
  }

  return {
    session,
    score: scoreSession(session.itemIds, session.answers),
    byCategory: breakdownByCategory(session.answers),
    complete: isComplete(session.itemIds, session.answers),
    review,
  };
}

/**
 * Per-category accuracy across every sitting in a pack.
 *
 * Advisory, and derived on read. This is what the progress page shows beside the error log and what
 * the brief carries to whoever writes the next block — the same numbers, so the learner and the
 * author are looking at one thing.
 */
export async function packBreakdown(
  ctx: ServiceContext,
  learnerId: string,
  packId: string,
): Promise<{ byCategory: CategoryBreakdown[]; sessions: number; score: QuizScore }> {
  const docs = await ctx.store.collections.quizSessions.find({ learnerId, packId }).toArray();
  const answers = docs.flatMap((doc) => doc.answers);
  return {
    byCategory: breakdownByCategory(answers),
    sessions: docs.length,
    score: scoreSession(
      docs.flatMap((doc) => doc.itemIds),
      answers,
    ),
  };
}
