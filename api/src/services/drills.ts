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
import { optionsText } from '../domain/mcq.js';
import {
  AnswerModeError,
  cardGrading,
  checkAnswerMode,
  learnCard,
  revealCard,
  type CardFace,
} from '../domain/flashcards.js';
import { deckTopics, inTopic, type TopicSummary } from '../domain/topics.js';
import type { PostAttemptInput } from '../domain/schemas.js';
import type { DrillItem, DrillKind, McqPayload, PackManifest, Stage } from '../domain/types.js';
import type { DrillStateDoc } from '../db/collections.js';
import { getBlock, getDrillItem, getPack, listDrillItems } from './content.js';
import { recordOccurrences } from './error-log.js';
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
  /**
   * The back of the card — present only in learn mode, which the learner asked for (ADR-0027).
   * Practice never carries it: there the answer arrives after an attempt or an explicit reveal.
   */
  card?: CardFace;
}

/**
 * `practice` serves prompts and nothing else. `learn` serves each card front and back together, and
 * is read-only by construction: it is served from here and nothing in this module writes for it.
 */
export type DeckMode = 'practice' | 'learn';

export interface DeckPage {
  items: DueItem[];
  /** The counts for what is being practised — the topic when one is chosen, the deck otherwise. */
  summary: DeckSummary;
  /**
   * The deck's topics, each with its own counts, whichever one is chosen — so the surface can offer
   * the others without a second call (ADR-0031). Empty for a deck whose cards have no topic.
   */
  topics: TopicSummary[];
}

export interface NextItemsQuery {
  learnerId: string;
  blockId?: string;
  packId?: string;
  lessonOrder?: number;
  kind?: DrillKind;
  /** Which direction to practise. Items not sitting at this stage are skipped. */
  stage?: Stage;
  limit?: number;
  /** Learn mode serves the back of each card too. Only for cards; it records nothing (ADR-0027). */
  mode?: DeckMode;
  /** Only the cards of this topic — a card's `group`, or `NO_TOPIC` (ADR-0031). */
  topic?: string;
}

/**
 * The next batch to practise, plus the deck summary the progress bars read.
 *
 * Ordering is least-practised first: an item the learner has never seen outranks one they have
 * attempted twice, so a session works through the deck rather than re-showing favourites.
 */
export async function nextItems(ctx: ServiceContext, query: NextItemsQuery): Promise<DeckPage> {
  const inScope = await listDrillItems(ctx, {
    blockId: query.blockId,
    packId: query.packId,
    lessonOrder: query.lessonOrder,
    kind: query.kind,
    learnerId: query.learnerId,
  });
  if (inScope.length === 0) return { items: [], summary: summarize([], 0), topics: [] };

  const progressById = await loadProgress(
    ctx,
    query.learnerId,
    inScope.map((item) => item.drillItemId),
  );
  // The topics are the whole deck's; the page and its counts are the chosen topic's.
  const topics = deckTopics(inScope, progressById);
  const topic = query.topic;
  const items = topic === undefined ? inScope : inScope.filter((item) => inTopic(item, topic));

  const due: DueItem[] = [];
  for (const item of items) {
    const progress = progressById.get(item.drillItemId) ?? initialProgress();
    const stage = query.stage ?? progress.stage;

    // A single-stage item can never be due at stage 2 — this is what the gate looks like in
    // practice when the learner has explicitly switched direction.
    if (stage === 2 && stagesFor(item) === 1) continue;
    if (!isDueAtStage(progress, stage)) continue;

    if (query.mode === 'learn') {
      // Only cards have a back to show; learn mode over a question bank would be an answer sheet.
      if (item.payload.kind !== 'term') continue;
      const { prompt, card } = learnCard(item, stage);
      due.push({ drillItemId: item.drillItemId, stage, prompt, progress, card });
      continue;
    }

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
    summary: summarize(
      items.flatMap((item) => progressById.get(item.drillItemId) ?? []),
      items.length,
    ),
    topics,
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

  // A self grade is the learner's own verdict, taken only where the pack says that is how its cards
  // are answered (ADR-0027).
  try {
    checkAnswerMode(cardGrading(pack), item, input);
  } catch (error) {
    if (error instanceof AnswerModeError) throw invalid(error.message);
    throw error;
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
      self: input.self,
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
    ...(result.selfGraded ? { selfGraded: true } : {}),
    at: now,
  });

  if (item.payload.kind === 'mcq' && !result.correct) {
    await recordMcqMiss(ctx, learnerId, item.payload, item.blockId, input.given, now);
  }

  return { ...result, drillItemId };
}

export interface RevealOutcome extends CardFace {
  drillItemId: string;
  stage: Stage;
}

/**
 * Turn a card over on a self-graded pack (ADR-0027).
 *
 * **Writes nothing** — no attempt, no drill state. The learner grades themselves afterwards with an
 * ordinary attempt, and that is the one thing that moves the streak. Every gate an attempt passes
 * applies here too, so a reveal cannot be used to read a card the learner could not answer: someone
 * else's own word is a 404, a locked second direction is a 400, and a typed pack's cards are revealed
 * by answering them, not by asking.
 */
export async function revealAnswer(
  ctx: ServiceContext,
  learnerId: string,
  drillItemId: string,
  stage: Stage,
): Promise<RevealOutcome> {
  const item: DrillItem = await getDrillItem(ctx, drillItemId);
  if (item.learnerId && item.learnerId !== learnerId) throw notFound(`drill item ${drillItemId}`);
  const pack = await getPack(ctx, item.packId);

  if (item.payload.kind !== 'term') throw invalid('only a card can be revealed');
  if (cardGrading(pack) !== 'self') {
    throw invalid('this skill’s cards are answered by typing — the answer comes back with the verdict');
  }

  if (stage === 2) {
    const existing = await ctx.store.collections.drillState.findOne({ _id: drillStateIdFor(learnerId, drillItemId) });
    if (!existing?.stage1Cleared) throw invalid('stage 2 is locked until stage 1 is cleared for this item');
  }

  return { drillItemId, stage, ...revealCard(item, stage) };
}

/**
 * A wrong answer against a published key is an error-log occurrence (ADR-0014).
 *
 * The judgement was made when the question was authored — which option is right, and which
 * categories it tests — so nothing is being decided here. This folds one attempt into the same
 * shape a correction produces and hands it to the same writer.
 *
 * Only misses are recorded. The error log is a record of what went wrong, and a category that
 * counted its successes too would need a second, different set of status rules to mean anything.
 */
async function recordMcqMiss(
  ctx: ServiceContext,
  learnerId: string,
  payload: McqPayload,
  blockId: string,
  given: string | string[],
  now: Date,
): Promise<void> {
  const block = await getBlock(ctx, blockId);
  const chosen = Array.isArray(given) ? given : [given];

  const occurrence = {
    wrong: optionsText(payload, chosen),
    right: optionsText(payload, payload.correct),
    lessonRef: blockId,
  };

  await recordOccurrences(ctx, {
    learnerId,
    packId: block.packId,
    blockOrder: block.order,
    byCategory: new Map(payload.categories.map((category) => [category, [occurrence]])),
    now,
  });
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
  scope: { blockId?: string; packId?: string; kind?: DrillKind },
): Promise<DeckSummary> {
  const items = await listDrillItems(ctx, { ...scope, learnerId });
  const progressById = await loadProgress(
    ctx,
    learnerId,
    items.map((item) => item.drillItemId),
  );
  return summarize([...progressById.values()], items.length);
}

/**
 * A deck's topics with their counts — what the overview's topic tiles read (ADR-0031). The same list
 * `nextItems` hands the flashcards surface, so a tile and the surface it opens never disagree.
 */
export async function topicSummaries(
  ctx: ServiceContext,
  learnerId: string,
  scope: { blockId?: string; packId?: string },
): Promise<TopicSummary[]> {
  const items = await listDrillItems(ctx, { ...scope, kind: 'term', learnerId });
  const progressById = await loadProgress(
    ctx,
    learnerId,
    items.map((item) => item.drillItemId),
  );
  return deckTopics(items, progressById);
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
