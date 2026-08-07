/**
 * The one place error-log counters are written.
 *
 * There are two sources of occurrences now (ADR-0014): a coach's correction of free-form writing,
 * and a wrong answer against a published key. They are different kinds of evidence, but the
 * arithmetic that follows is identical, and it has to *stay* identical — a second implementation
 * would drift, and the drift would only ever show up as a category that mysteriously never retires.
 *
 * So both go through `recordOccurrences`. It supplies persistence around `domain/error-log.ts`'s
 * pure `applyOccurrences` and nothing else: no rule lives here that is not already stated there.
 */

import { applyOccurrences, type OccurrenceInput } from '../domain/error-log.js';
import type { ErrorLogEntry } from '../domain/types.js';
import type { ErrorLogDoc } from '../db/collections.js';
import { errorLogIdFor, type ServiceContext } from './context.js';

const toEntry = (doc: ErrorLogDoc): ErrorLogEntry => {
  const { _id: _ignored, ...rest } = doc;
  return rest;
};

export interface RecordInput {
  learnerId: string;
  packId: string;
  /** The block the evidence came from — what the clean-block run is measured against. */
  blockOrder: number;
  /** Occurrences grouped by the category they belong to. */
  byCategory: Map<string, OccurrenceInput[]>;
  now: Date;
}

/** Write one batch of occurrences, and return the entries as they now stand. */
export async function recordOccurrences(ctx: ServiceContext, input: RecordInput): Promise<ErrorLogEntry[]> {
  const updated: ErrorLogEntry[] = [];

  for (const [category, occurrences] of input.byCategory) {
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

/** Fold correction items — each naming its own categories — into the grouped shape above. */
export function groupByCategory(
  items: { original: string; corrected: string; categories: string[] }[],
  lessonRef: string,
): Map<string, OccurrenceInput[]> {
  const byCategory = new Map<string, OccurrenceInput[]>();
  for (const item of items) {
    for (const category of item.categories) {
      const occurrences = byCategory.get(category) ?? [];
      occurrences.push({ wrong: item.original, right: item.corrected, lessonRef });
      byCategory.set(category, occurrences);
    }
  }
  return byCategory;
}
