/**
 * Submissions — the learner's half of the coaching loop.
 *
 * A submission is written work waiting for a coach. It is deliberately not graded here: judging
 * free-form writing is exactly what the runtime does not do (ADR-0001).
 */

import { invalid, notFound } from '../http/errors.js';
import { createSubmissionSchema, type CreateSubmissionInput } from '../domain/schemas.js';
import { hasContent, unknownAnswerRefs } from '../domain/progression.js';
import type { Correction, Submission, SubmissionStatus } from '../domain/types.js';
import type { CorrectionDoc, SubmissionDoc } from '../db/collections.js';
import { getLessonFor } from './content.js';
import { enroll, setPosition } from './learners.js';
import { newEventId, type ServiceContext } from './context.js';

const toSubmission = (doc: SubmissionDoc): Submission => {
  const { _id, ...rest } = doc;
  return { ...rest, submissionId: _id };
};
const toCorrection = (doc: CorrectionDoc): Correction => {
  const { _id, ...rest } = doc;
  return { ...rest, correctionId: _id };
};

export interface CreateSubmissionResult {
  submission: Submission;
  /** Answer references the lesson no longer defines. Kept, not rejected — see `progression.ts`. */
  unknownRefs: string[];
}

export async function createSubmission(
  ctx: ServiceContext,
  learnerId: string,
  lessonId: string,
  input: CreateSubmissionInput,
): Promise<CreateSubmissionResult> {
  const parsed = createSubmissionSchema.parse(input);
  // Gated on the block's owner: work submitted against somebody else's lesson would file evidence
  // against their programme and enrol the writer in a block they cannot open (ADR-0015).
  const lesson = await getLessonFor(ctx, lessonId, learnerId);

  if (!hasContent(parsed.answers)) {
    throw invalid('a submission needs at least one non-empty answer');
  }

  const unknownRefs = unknownAnswerRefs(lesson, parsed.answers);
  const now = ctx.now();

  const doc: SubmissionDoc = {
    _id: newEventId(),
    learnerId,
    packId: lesson.packId,
    blockId: lesson.blockId,
    lessonId,
    answers: parsed.answers,
    speakingNote: parsed.speakingNote,
    status: 'pending',
    createdAt: now,
  };
  await ctx.store.collections.submissions.insertOne(doc);

  // Doing a lesson enrols you in its pack, exactly as opening the pack does — a learner who
  // arrived by deep link or a "continue" bookmark has still plainly started the pack. `enroll` is
  // idempotent, so this is a no-op for anyone who came in through the pack page.
  await enroll(ctx, learnerId, lesson.packId, lesson.blockId);

  // Submitting is what moves the learner on — lessons advance by position, never by date.
  await setPosition(ctx, learnerId, lesson.packId, {
    blockId: lesson.blockId,
    lessonOrder: lesson.order + 1,
  });

  return { submission: toSubmission(doc), unknownRefs };
}

export async function getSubmission(ctx: ServiceContext, submissionId: string): Promise<Submission> {
  const doc = await ctx.store.collections.submissions.findOne({ _id: submissionId });
  if (!doc) throw notFound(`submission ${submissionId}`);
  return toSubmission(doc);
}

export interface SessionLog {
  submission: Submission;
  correction: Correction | null;
}

/**
 * The session-log view: what the learner wrote and what came back. This is the artifact the source
 * program wrote by hand into a markdown file after every lesson.
 */
export async function sessionLog(ctx: ServiceContext, submissionId: string): Promise<SessionLog> {
  const submission = await getSubmission(ctx, submissionId);
  const correction = await ctx.store.collections.corrections.findOne({ submissionId });
  return { submission, correction: correction ? toCorrection(correction) : null };
}

export interface SubmissionQuery {
  learnerId?: string;
  packId?: string;
  blockId?: string;
  lessonId?: string;
  status?: SubmissionStatus;
  limit?: number;
}

/** The coach's work queue when filtered by `status: 'pending'` — oldest first, so nothing starves. */
export async function listSubmissions(ctx: ServiceContext, query: SubmissionQuery): Promise<Submission[]> {
  const filter: Record<string, unknown> = {};
  for (const key of ['learnerId', 'packId', 'blockId', 'lessonId', 'status'] as const) {
    if (query[key] !== undefined) filter[key] = query[key];
  }
  const docs = await ctx.store.collections.submissions
    .find(filter)
    .sort({ createdAt: query.status === 'pending' ? 1 : -1 })
    .limit(Math.min(query.limit ?? 50, 200))
    .toArray();
  return docs.map(toSubmission);
}

/** Which lessons of a block a learner has submitted, split by whether feedback has arrived. */
export async function blockSubmissionState(
  ctx: ServiceContext,
  learnerId: string,
  blockId: string,
): Promise<{ correctedOrders: number[]; pendingOrders: number[] }> {
  const submissions = await ctx.store.collections.submissions.find({ learnerId, blockId }).toArray();
  if (submissions.length === 0) return { correctedOrders: [], pendingOrders: [] };

  const lessons = await ctx.store.collections.lessons
    .find({ _id: { $in: submissions.map((doc) => doc.lessonId) } })
    .project<{ _id: string; order: number }>({ order: 1 })
    .toArray();
  const orderById = new Map(lessons.map((lesson) => [lesson._id, lesson.order]));

  const correctedOrders: number[] = [];
  const pendingOrders: number[] = [];
  for (const submission of submissions) {
    const order = orderById.get(submission.lessonId);
    if (order === undefined) continue;
    (submission.status === 'corrected' ? correctedOrders : pendingOrders).push(order);
  }
  return { correctedOrders, pendingOrders };
}
