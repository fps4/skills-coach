/**
 * The learner's own view of where they are: position, decks, and the live error log.
 *
 * This is the artifact the source program maintained by hand across three markdown files. Here it
 * is derived on read from what actually happened, so it cannot fall out of date.
 */

import { blockProgress, type BlockProgress } from '../domain/progression.js';
import { redrillCategories, retireCategories, topRecurring } from '../domain/error-log.js';
import type { DeckSummary } from '../domain/drill-progress.js';
import type { Block, ErrorLogEntry, PackManifest } from '../domain/types.js';
import { getBlock, getPack, listBlocks } from './content.js';
import { listErrorLog } from './corrections.js';
import { deckSummary } from './drills.js';
import { getEnrollment, listEnrollments } from './learners.js';
import { packBreakdown } from './quiz.js';
import { blockSubmissionState } from './submissions.js';
import type { CategoryBreakdown, QuizScore } from '../domain/quiz.js';
import type { ServiceContext } from './context.js';

export interface PackProgress {
  pack: PackManifest;
  currentBlock: Block | null;
  blockProgress: BlockProgress | null;
  blocks: { block: Block; progress: BlockProgress }[];
  decks: { terms: DeckSummary; wordOrder: DeckSummary; quiz: DeckSummary };
  /** Per-category accuracy across every sitting. Advisory, derived on read (ADR-0014). */
  quiz: { byCategory: CategoryBreakdown[]; sessions: number; score: QuizScore };
  errorLog: {
    entries: ErrorLogEntry[];
    redrill: string[];
    retire: string[];
    top: ErrorLogEntry[];
  };
}

export async function packProgress(ctx: ServiceContext, learnerId: string, packId: string): Promise<PackProgress> {
  const pack = await getPack(ctx, packId);
  const blocks = await listBlocks(ctx, packId);
  const enrollment = await getEnrollment(ctx, learnerId, packId);

  const perBlock: { block: Block; progress: BlockProgress }[] = [];
  for (const block of blocks) {
    const { correctedOrders, pendingOrders } = await blockSubmissionState(ctx, learnerId, block.blockId);
    perBlock.push({ block, progress: blockProgress(block.lessonCount, correctedOrders, pendingOrders) });
  }

  // The learner's current block, or — before they have started anything — the first published one.
  const current =
    perBlock.find((entry) => entry.block.blockId === enrollment?.currentBlockId) ??
    perBlock.find((entry) => !entry.progress.complete) ??
    perBlock[0] ??
    null;

  const entries = await listErrorLog(ctx, learnerId, packId);

  return {
    pack,
    currentBlock: current?.block ?? null,
    blockProgress: current?.progress ?? null,
    blocks: perBlock,
    decks: {
      terms: await deckSummary(ctx, learnerId, { packId, kind: 'term' }),
      wordOrder: await deckSummary(ctx, learnerId, { packId, kind: 'word-order' }),
      quiz: await deckSummary(ctx, learnerId, { packId, kind: 'mcq' }),
    },
    quiz: await packBreakdown(ctx, learnerId, packId),
    errorLog: {
      entries,
      redrill: redrillCategories(entries),
      retire: retireCategories(entries),
      top: topRecurring(entries),
    },
  };
}

export interface LearnerOverview {
  packs: PackProgress[];
}

export async function overview(ctx: ServiceContext, learnerId: string): Promise<LearnerOverview> {
  const enrollments = await listEnrollments(ctx, learnerId);
  const packs: PackProgress[] = [];
  for (const enrollment of enrollments) {
    packs.push(await packProgress(ctx, learnerId, enrollment.packId));
  }
  return { packs };
}

/** Progress within one block, for the block page. */
export async function progressForBlock(ctx: ServiceContext, learnerId: string, blockId: string) {
  const block = await getBlock(ctx, blockId);
  const { correctedOrders, pendingOrders } = await blockSubmissionState(ctx, learnerId, blockId);
  return {
    block,
    progress: blockProgress(block.lessonCount, correctedOrders, pendingOrders),
    decks: {
      terms: await deckSummary(ctx, learnerId, { blockId, kind: 'term' }),
      wordOrder: await deckSummary(ctx, learnerId, { blockId, kind: 'word-order' }),
      quiz: await deckSummary(ctx, learnerId, { blockId, kind: 'mcq' }),
    },
  };
}
