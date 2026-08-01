/**
 * Block reviews, and the brief for authoring the next block.
 *
 * The brief is the hinge of the whole design (ADR-0001). The source program named three inputs for
 * generating the next block:
 *
 *   (1) the last block's response quality — the error log and the per-lesson session record;
 *   (2) the competency ramp — the next rung;
 *   (3) the program goal.
 *
 * Assembling those is aggregation, not generation, so it is the runtime's job. Whoever authors the
 * next block reads one payload instead of going to find the evidence — which is what stops the
 * "adaptive" part from quietly degrading into "whatever the author remembered".
 *
 * Posting a review also *closes* the block on the error log: every category that did not appear in
 * it earns a clean block, which is what eventually retires a mistake.
 */

import { notFound } from '../http/errors.js';
import { closeBlock, redrillCategories, retireCategories, topRecurring } from '../domain/error-log.js';
import { blockProgress, type BlockProgress } from '../domain/progression.js';
import { rampPosition, type RampPosition } from '../domain/ramp.js';
import { postBlockReviewSchema, type PostBlockReviewInput } from '../domain/schemas.js';
import type { Block, BlockReview, ErrorLogEntry, LocalizedText, PackManifest, Ratings } from '../domain/types.js';
import { getBlock, getPack } from './content.js';
import { listErrorLog } from './corrections.js';
import { blockReviewIdFor, errorLogIdFor, type ServiceContext } from './context.js';
import { blockSubmissionState } from './submissions.js';

export interface PostReviewResult {
  review: BlockReview;
  /** Categories whose status changed as a result of closing the block. */
  transitioned: { category: string; status: ErrorLogEntry['status'] }[];
}

export async function postBlockReview(
  ctx: ServiceContext,
  blockId: string,
  learnerId: string,
  input: PostBlockReviewInput,
): Promise<PostReviewResult> {
  const parsed = postBlockReviewSchema.parse(input);
  const block = await getBlock(ctx, blockId);
  const now = ctx.now();

  const review: BlockReview = {
    blockId,
    learnerId,
    whatWentWell: parsed.whatWentWell,
    topErrors: parsed.topErrors,
    wordsToRevise: parsed.wordsToRevise,
    skillRatings: parsed.skillRatings,
    nextBlockBrief: parsed.nextBlockBrief,
    at: now,
  };

  const id = blockReviewIdFor(blockId, learnerId);
  await ctx.store.collections.blockReviews.replaceOne({ _id: id }, review, { upsert: true });

  // Close the block on the error log. `closeBlock` derives the clean-block run rather than
  // incrementing it, so posting a review twice is harmless.
  const before = await listErrorLog(ctx, learnerId, block.packId);
  const after = closeBlock(before, block.order);

  const transitioned: { category: string; status: ErrorLogEntry['status'] }[] = [];
  for (const [index, entry] of after.entries()) {
    const previous = before[index];
    if (previous && previous.cleanBlocks === entry.cleanBlocks) continue;
    const docId = errorLogIdFor(learnerId, block.packId, entry.category);
    await ctx.store.collections.errorLog.replaceOne({ _id: docId }, entry, { upsert: true });
    if (previous && previous.status !== entry.status) {
      transitioned.push({ category: entry.category, status: entry.status });
    }
  }

  return { review, transitioned };
}

export async function getBlockReview(ctx: ServiceContext, blockId: string, learnerId: string): Promise<BlockReview> {
  const doc = await ctx.store.collections.blockReviews.findOne({ _id: blockReviewIdFor(blockId, learnerId) });
  if (!doc) throw notFound(`review for block ${blockId}`);
  const { _id: _ignored, ...rest } = doc;
  return rest;
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export interface LessonEvidence {
  lessonOrder: number;
  lessonId: string;
  status: 'pending' | 'corrected';
  categoryTally?: Record<string, number>;
  ratings?: Ratings;
  note?: string;
}

export interface NextBlockBriefPayload {
  goal?: LocalizedText;
  pack: {
    packId: string;
    contentLanguage: string;
    translationLanguage: string;
    framework: PackManifest['framework'];
    errorCategories: PackManifest['errorCategories'];
  };
  completedBlock: {
    blockId: string;
    order: number;
    slug: string;
    title: Block['title'];
    level?: string;
    focus?: string[];
    milestone?: string;
    progress: BlockProgress;
  };
  /** (1) How the learner actually did. */
  evidence: {
    lessons: LessonEvidence[];
    errorLog: ErrorLogEntry[];
    redrill: string[];
    retire: string[];
    top: ErrorLogEntry[];
    review: BlockReview | null;
  };
  /** (2) The next rung on the ramp. */
  nextBlock: {
    order: number;
    ramp: RampPosition;
  };
  /** What the runtime believes should drive the next block, before an author's judgement. */
  suggestions: {
    redrill: string[];
    retire: string[];
    focusCategories: string[];
    fromReview: BlockReview['nextBlockBrief'] | null;
  };
}

export async function buildBrief(
  ctx: ServiceContext,
  blockId: string,
  learnerId: string,
): Promise<NextBlockBriefPayload> {
  const block = await getBlock(ctx, blockId);
  const pack = await getPack(ctx, block.packId);

  const { correctedOrders, pendingOrders } = await blockSubmissionState(ctx, learnerId, blockId);
  const progress = blockProgress(block.lessonCount, correctedOrders, pendingOrders);

  const entries = await listErrorLog(ctx, learnerId, block.packId);
  const review = await getBlockReview(ctx, blockId, learnerId).catch(() => null);

  return {
    goal: pack.goal,
    pack: {
      packId: pack.packId,
      contentLanguage: pack.contentLanguage,
      translationLanguage: pack.translationLanguage,
      framework: pack.framework,
      errorCategories: pack.errorCategories,
    },
    completedBlock: {
      blockId: block.blockId,
      order: block.order,
      slug: block.slug,
      title: block.title,
      level: block.level,
      focus: block.focus,
      milestone: block.milestone,
      progress,
    },
    evidence: {
      lessons: await lessonEvidence(ctx, learnerId, blockId),
      errorLog: entries,
      redrill: redrillCategories(entries),
      retire: retireCategories(entries),
      top: topRecurring(entries),
      review,
    },
    nextBlock: {
      order: block.order + 1,
      ramp: rampPosition(pack.framework, block.order + 1),
    },
    suggestions: {
      redrill: redrillCategories(entries),
      retire: retireCategories(entries),
      focusCategories: topRecurring(entries).map((entry) => entry.category),
      fromReview: review?.nextBlockBrief ?? null,
    },
  };
}

/** Per-lesson evidence: what each session cost the learner, in categories and ratings. */
async function lessonEvidence(ctx: ServiceContext, learnerId: string, blockId: string): Promise<LessonEvidence[]> {
  const submissions = await ctx.store.collections.submissions.find({ learnerId, blockId }).toArray();
  if (submissions.length === 0) return [];

  const lessons = await ctx.store.collections.lessons
    .find({ _id: { $in: submissions.map((doc) => doc.lessonId) } })
    .project<{ _id: string; order: number }>({ order: 1 })
    .toArray();
  const orderById = new Map(lessons.map((lesson) => [lesson._id, lesson.order]));

  const corrections = await ctx.store.collections.corrections
    .find({ submissionId: { $in: submissions.map((doc) => doc._id) } })
    .toArray();
  const correctionBySubmission = new Map(corrections.map((doc) => [doc.submissionId, doc]));

  return submissions
    .map((submission) => {
      const correction = correctionBySubmission.get(submission._id);
      return {
        lessonOrder: orderById.get(submission.lessonId) ?? 0,
        lessonId: submission.lessonId,
        status: submission.status,
        categoryTally: correction?.categoryTally,
        ratings: correction?.ratings,
        note: correction?.note,
      };
    })
    .sort((a, b) => a.lessonOrder - b.lessonOrder);
}
