/**
 * Drill practice: what to serve next, and what an attempt did to the learner's state.
 *
 * Grading happens here rather than in the browser. The trainers this replaces had to ship the answer
 * to the page in order to check it; serving a prompt without its answer is the one behavioural
 * upgrade over them, and it is why `nextItems` returns prompts, not items.
 */

import { invalid, notFound } from '../http/errors.js';
import { grade, promptFor, stagesFor, type DrillPrompt, type GradeResult } from '../domain/grading.js';
import {
  initialProgress,
  isDueAtStage,
  summarize,
  type DrillProgress,
  type DeckSummary,
} from '../domain/drill-progress.js';
import type { PostAttemptInput } from '../domain/schemas.js';
import type { DrillItem, PackManifest, Stage } from '../domain/types.js';
import type { DrillStateDoc } from '../db/collections.js';
import { getDrillItem, getPack, listDrillItems } from './content.js';
import { drillStateIdFor, newEventId, type ServiceContext } from './context.js';

const stripState = (doc: DrillStateDoc): DrillProgress => {
  const { _id: _a, learnerId: _b, drillItemId: _c, packId: _d, blockId: _e, updatedAt: _f, ...progress } = doc;
  return progress;
};

async function loadProgress(
  ctx: ServiceContext,
  learnerId: string,
  drillItemIds: string[],
): Promise<Map<string, DrillProgress>> {
  if (drillItemIds.length === 0) return new Map();
  const docs = await ctx.store.collections.drillState.find({ learnerId, drillItemId: { $in: drillItemIds } }).toArray();
  return new Map(docs.map((doc) => [doc.drillItemId, stripState(doc)]));
}

/** A pack may override which leading words are ignored when matching, per language. */
function matchOptionsFor(pack: PackManifest, stage: Stage) {
  const language = stage === 1 ? pack.translationLanguage : pack.contentLanguage;
  const articles = pack.matchArticles?.[language];
  return articles ? { articles } : {};
}

export interface DueItem {
  drillItemId: string;
  stage: Stage;
  prompt: DrillPrompt;
  progress: DrillProgress;
}

export interface DeckPage {
  items: DueItem[];
  summary: DeckSummary;
}

export interface NextItemsQuery {
  learnerId: string;
  blockId?: string;
  packId?: string;
  lessonOrder?: number;
  kind?: 'term' | 'word-order';
  /** Which direction to practise. Items not sitting at this stage are skipped. */
  stage?: Stage;
  limit?: number;
}

/**
 * The next batch to practise, plus the deck summary the progress bars read.
 *
 * Ordering is least-practised first: an item the learner has never seen outranks one they have
 * attempted twice, so a session works through the deck rather than re-showing favourites.
 */
export async function nextItems(ctx: ServiceContext, query: NextItemsQuery): Promise<DeckPage> {
  const items = await listDrillItems(ctx, {
    blockId: query.blockId,
    packId: query.packId,
    lessonOrder: query.lessonOrder,
    kind: query.kind,
    learnerId: query.learnerId,
  });
  if (items.length === 0) return { items: [], summary: summarize([], 0) };

  const progressById = await loadProgress(
    ctx,
    query.learnerId,
    items.map((item) => item.drillItemId),
  );

  const due: DueItem[] = [];
  for (const item of items) {
    const progress = progressById.get(item.drillItemId) ?? initialProgress();
    const stage = query.stage ?? progress.stage;

    // A single-stage item can never be due at stage 2 — this is what the gate looks like in
    // practice when the learner has explicitly switched direction.
    if (stage === 2 && stagesFor(item) === 1) continue;
    if (!isDueAtStage(progress, stage)) continue;

    due.push({
      drillItemId: item.drillItemId,
      stage,
      // Seeded from the item id so a reload shows the same bank rather than reshuffling.
      prompt: promptFor(item, stage, seedFrom(item.drillItemId)),
      progress,
    });
  }

  due.sort((a, b) => a.progress.attempts - b.progress.attempts || a.drillItemId.localeCompare(b.drillItemId));

  return {
    items: due.slice(0, Math.min(query.limit ?? 20, 100)),
    summary: summarize([...progressById.values()], items.length),
  };
}

function seedFrom(drillItemId: string): number {
  let hash = 0;
  for (const char of drillItemId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash || 1;
}

export interface AttemptOutcome extends GradeResult {
  drillItemId: string;
}

/**
 * Grade an attempt and persist what it changed: the new progress, and an append-only attempt row.
 *
 * The attempt row is written whatever the verdict — including overrides, which are recorded as
 * overrides. A learner who overrides everything should be visible, not hidden.
 */
export async function recordAttempt(
  ctx: ServiceContext,
  learnerId: string,
  drillItemId: string,
  input: PostAttemptInput,
): Promise<AttemptOutcome> {
  const item: DrillItem = await getDrillItem(ctx, drillItemId);
  // Someone else's own word is not practisable by id — and a 404 rather than a 403, because its
  // existence is not this caller's business (ADR-0012).
  if (item.learnerId && item.learnerId !== learnerId) throw notFound(`drill item ${drillItemId}`);
  const pack = await getPack(ctx, item.packId);

  if (input.stage === 2 && stagesFor(item) === 1) {
    throw invalid('this item has only one stage');
  }

  const stateId = drillStateIdFor(learnerId, drillItemId);
  const existing = await ctx.store.collections.drillState.findOne({ _id: stateId });
  const progress = existing ? stripState(existing) : initialProgress();

  // Stage 2 is gated behind stage 1 — reachable through the API only once stage 1 is cleared.
  if (input.stage === 2 && !progress.stage1Cleared) {
    throw invalid('stage 2 is locked until stage 1 is cleared for this item');
  }

  const result = grade(
    {
      item,
      stage: input.stage,
      given: input.given,
      override: input.override,
      matchOptions: matchOptionsFor(pack, input.stage),
    },
    progress,
  );

  const now = ctx.now();
  await ctx.store.collections.drillState.replaceOne(
    { _id: stateId },
    { ...result.progress, learnerId, drillItemId, packId: item.packId, blockId: item.blockId, updatedAt: now },
    { upsert: true },
  );

  await ctx.store.collections.attempts.insertOne({
    _id: newEventId(),
    learnerId,
    drillItemId,
    stage: input.stage,
    given: Array.isArray(input.given) ? input.given.join(' | ') : input.given,
    correct: result.correct,
    acceptedOverride: result.overridden,
    at: now,
  });

  return { ...result, drillItemId };
}

/** Reset progress for a scope, mirroring the original trainers' per-deck Reset button. */
export async function resetProgress(
  ctx: ServiceContext,
  learnerId: string,
  scope: { blockId?: string; packId?: string },
): Promise<number> {
  const filter: Record<string, unknown> = { learnerId };
  if (scope.blockId) filter.blockId = scope.blockId;
  if (scope.packId) filter.packId = scope.packId;
  const result = await ctx.store.collections.drillState.deleteMany(filter);
  return result.deletedCount ?? 0;
}

export async function deckSummary(
  ctx: ServiceContext,
  learnerId: string,
  scope: { blockId?: string; packId?: string; kind?: 'term' | 'word-order' },
): Promise<DeckSummary> {
  const items = await listDrillItems(ctx, { ...scope, learnerId });
  const progressById = await loadProgress(
    ctx,
    learnerId,
    items.map((item) => item.drillItemId),
  );
  return summarize([...progressById.values()], items.length);
}

export async function getProgressFor(
  ctx: ServiceContext,
  learnerId: string,
  drillItemId: string,
): Promise<DrillProgress> {
  const doc = await ctx.store.collections.drillState.findOne({ _id: drillStateIdFor(learnerId, drillItemId) });
  if (!doc) {
    // Confirm the item exists at all, so a bad id is a 404 rather than a fresh-looking state.
    await getDrillItem(ctx, drillItemId).catch(() => {
      throw notFound(`drill item ${drillItemId}`);
    });
    return initialProgress();
  }
  return stripState(doc);
}
