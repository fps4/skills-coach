/**
 * Corrections, and the error-log arithmetic they trigger.
 *
 * This is where the ADR-0001 boundary is at its most concrete. The coach supplies *judgement* —
 * which category each mistake belongs to. Everything downstream is the runtime's: counters,
 * clean-block runs, status transitions, and therefore what gets re-drilled next block. A coach
 * cannot write a counter, only report an occurrence.
 *
 * Categories are validated against the pack's declared vocabulary. An invented category would
 * accumulate its own counters and never join anything — a silent break in the adaptation loop —
 * so it is rejected rather than accepted.
 */

import { conflict, invalid, notFound } from '../http/errors.js';
import { applyOccurrences, tallyCategories, type OccurrenceInput } from '../domain/error-log.js';
import { postCorrectionSchema, type PostCorrectionInput } from '../domain/schemas.js';
import type { Correction, ErrorLogEntry } from '../domain/types.js';
import type { CorrectionDoc, ErrorLogDoc } from '../db/collections.js';
import { getBlock, getPack } from './content.js';
import { getSubmission } from './submissions.js';
import { errorLogIdFor, newEventId, type ServiceContext } from './context.js';

const toCorrection = (doc: CorrectionDoc): Correction => {
  const { _id, ...rest } = doc;
  return { ...rest, correctionId: _id };
};
const toEntry = (doc: ErrorLogDoc): ErrorLogEntry => {
  const { _id: _ignored, ...rest } = doc;
  return rest;
};

export interface CorrectionResult {
  correction: Correction;
  /** Error-log entries as they stand after the correction — what moved, and to what status. */
  errorLog: ErrorLogEntry[];
}

export async function postCorrection(
  ctx: ServiceContext,
  submissionId: string,
  input: PostCorrectionInput,
): Promise<CorrectionResult> {
  const parsed = postCorrectionSchema.parse(input);
  const submission = await getSubmission(ctx, submissionId);

  const existing = await ctx.store.collections.corrections.findOne({ submissionId });
  if (existing) {
    throw conflict(`submission ${submissionId} has already been corrected`);
  }

  const pack = await getPack(ctx, submission.packId);
  const known = new Set(pack.errorCategories.map((category) => category.id));
  const unknown = [...new Set(parsed.items.flatMap((item) => item.categories))].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw invalid(`pack ${pack.packId} does not declare these error categories: ${unknown.join(', ')}`, {
      unknownCategories: unknown,
      declared: [...known].sort(),
    });
  }

  const now = ctx.now();
  const doc: CorrectionDoc = {
    _id: newEventId(),
    submissionId,
    learnerId: submission.learnerId,
    items: parsed.items,
    categoryTally: tallyCategories(parsed.items),
    ratings: parsed.ratings,
    note: parsed.note,
    correctedBy: 'external-coach',
    model: parsed.model,
    at: now,
  };
  await ctx.store.collections.corrections.insertOne(doc);

  await ctx.store.collections.submissions.updateOne(
    { _id: submissionId },
    { $set: { status: 'corrected' as const, correctedAt: now } },
  );

  const block = await getBlock(ctx, submission.blockId);
  const errorLog = await applyToErrorLog(ctx, {
    learnerId: submission.learnerId,
    packId: submission.packId,
    blockOrder: block.order,
    lessonRef: submission.lessonId,
    items: parsed.items,
    now,
  });

  return { correction: toCorrection(doc), errorLog };
}

interface ApplyInput {
  learnerId: string;
  packId: string;
  blockOrder: number;
  lessonRef: string;
  items: { original: string; corrected: string; categories: string[] }[];
  now: Date;
}

/** Fold a correction's items into per-category occurrences and write the resulting entries back. */
async function applyToErrorLog(ctx: ServiceContext, input: ApplyInput): Promise<ErrorLogEntry[]> {
  const byCategory = new Map<string, OccurrenceInput[]>();
  for (const item of input.items) {
    for (const category of item.categories) {
      const occurrences = byCategory.get(category) ?? [];
      occurrences.push({ wrong: item.original, right: item.corrected, lessonRef: input.lessonRef });
      byCategory.set(category, occurrences);
    }
  }

  const updated: ErrorLogEntry[] = [];
  for (const [category, occurrences] of byCategory) {
    const id = errorLogIdFor(input.learnerId, input.packId, category);
    const existing = await ctx.store.collections.errorLog.findOne({ _id: id });
    const entry = applyOccurrences(existing ? toEntry(existing) : undefined, category, occurrences, {
      learnerId: input.learnerId,
      packId: input.packId,
      blockOrder: input.blockOrder,
      now: input.now,
    });
    await ctx.store.collections.errorLog.replaceOne({ _id: id }, entry, { upsert: true });
    updated.push(entry);
  }
  return updated;
}

export async function getCorrection(ctx: ServiceContext, submissionId: string): Promise<Correction> {
  const doc = await ctx.store.collections.corrections.findOne({ submissionId });
  if (!doc) throw notFound(`correction for submission ${submissionId}`);
  return toCorrection(doc);
}

export async function listErrorLog(ctx: ServiceContext, learnerId: string, packId?: string): Promise<ErrorLogEntry[]> {
  const filter: Record<string, unknown> = { learnerId };
  if (packId) filter.packId = packId;
  const docs = await ctx.store.collections.errorLog.find(filter).toArray();
  return docs.map(toEntry).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
