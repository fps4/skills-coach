/**
 * Taking a pack away, with everything anyone did in it.
 *
 * Deliberately not on any API (see `importer/remove-pack.ts`): deleting a pack that learners have
 * worked is deleting their history, and the default everywhere else in this system is that history
 * is archived, never deleted. This exists for the one case where the owner of that history has asked
 * for it gone — a programme retired after its words and reading were moved into skills of their own
 * (ADR-0022) — and it is only ever reached through an explicit flag.
 *
 * What goes: the pack, its blocks, lessons and drill items, and every learner's enrollment, drill
 * state, attempts, submissions and the corrections on them, error log, block reviews, quiz sittings,
 * reading library and read marks in it. What stays: the audit trail, which records that things
 * happened and is bounded by its own TTL, and every learner's menu — which simply stops placing a
 * pack they are no longer enrolled in (ADR-0021).
 */

import type { ServiceContext } from './context.js';

export type RemovalCounts = Record<string, number>;

/** What removing this pack would delete, collection by collection. */
export async function countPackFootprint(ctx: ServiceContext, packId: string): Promise<RemovalCounts> {
  const c = ctx.store.collections;
  const { blockIds, drillItemIds, submissionIds } = await keys(ctx, packId);

  return {
    blocks: blockIds.length,
    lessons: await c.lessons.countDocuments({ packId }),
    drillItems: drillItemIds.length,
    enrollments: await c.enrollments.countDocuments({ packId }),
    drillState: await c.drillState.countDocuments({ packId }),
    attempts: await c.attempts.countDocuments({ drillItemId: { $in: drillItemIds } }),
    submissions: submissionIds.length,
    corrections: await c.corrections.countDocuments({ submissionId: { $in: submissionIds } }),
    errorLog: await c.errorLog.countDocuments({ packId }),
    blockReviews: await c.blockReviews.countDocuments({ blockId: { $in: blockIds } }),
    quizSessions: await c.quizSessions.countDocuments({ packId }),
    articles: await c.articles.countDocuments({ packId }),
    readingState: await c.readingState.countDocuments({ packId }),
  };
}

/** Delete the pack and everything in {@link countPackFootprint}. Re-runnable: a second run finds nothing. */
export async function removePackWithHistory(ctx: ServiceContext, packId: string): Promise<RemovalCounts> {
  const c = ctx.store.collections;
  const { blockIds, drillItemIds, submissionIds } = await keys(ctx, packId);

  // Children before parents, so an interrupted run leaves nothing pointing at something already gone
  // — and the keys above are re-derived on the next run from what is still there.
  const removed: RemovalCounts = {
    corrections: (await c.corrections.deleteMany({ submissionId: { $in: submissionIds } })).deletedCount,
    attempts: (await c.attempts.deleteMany({ drillItemId: { $in: drillItemIds } })).deletedCount,
    blockReviews: (await c.blockReviews.deleteMany({ blockId: { $in: blockIds } })).deletedCount,
    submissions: (await c.submissions.deleteMany({ packId })).deletedCount,
    drillState: (await c.drillState.deleteMany({ packId })).deletedCount,
    errorLog: (await c.errorLog.deleteMany({ packId })).deletedCount,
    quizSessions: (await c.quizSessions.deleteMany({ packId })).deletedCount,
    readingState: (await c.readingState.deleteMany({ packId })).deletedCount,
    articles: (await c.articles.deleteMany({ packId })).deletedCount,
    enrollments: (await c.enrollments.deleteMany({ packId })).deletedCount,
    drillItems: (await c.drillItems.deleteMany({ packId })).deletedCount,
    lessons: (await c.lessons.deleteMany({ packId })).deletedCount,
    blocks: (await c.blocks.deleteMany({ packId })).deletedCount,
    packs: (await c.packs.deleteOne({ _id: packId })).deletedCount,
  };
  return removed;
}

async function keys(ctx: ServiceContext, packId: string) {
  const c = ctx.store.collections;
  const [blockIds, drillItemIds, submissionIds] = await Promise.all([
    c.blocks.distinct('_id', { packId }),
    c.drillItems.distinct('_id', { packId }),
    c.submissions.distinct('_id', { packId }),
  ]);
  return { blockIds, drillItemIds, submissionIds };
}
