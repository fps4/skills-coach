/**
 * The error log: the memory that makes adaptation possible.
 *
 * The rules are the ones the program this replaces stated in prose, and they are the reason the
 * runtime — not the coach — owns the counters (ADR-0001). A correction supplies *judgement* (which
 * category a mistake belongs to); everything derived from it is arithmetic:
 *
 *   "3+ keer 🔁 in een categorie → die structuur komt terug als drill in het volgende blok."
 *   "2 blokken geen nieuwe fout in een categorie → status wordt ✅ en valt uit de actieve drills."
 *   "De top-3 terugkerende categorieën sturen het grammatica-thema van het volgende blok."
 *
 * Pure: no I/O, and the clock is always passed in so tests are deterministic.
 */

import type { ErrorExample, ErrorLogEntry, ErrorStatus } from './types.js';

/** Occurrences before a category is treated as entrenched rather than incidental. */
export const RECURRING_THRESHOLD = 3;
/** Completed blocks without a new occurrence before a category is considered mastered. */
export const MASTERED_AFTER_CLEAN_BLOCKS = 2;
/** How many examples to keep per category — enough to recognise the pattern, not a full history. */
export const MAX_EXAMPLES = 8;

/**
 * Status is *derived*, never stored independently, so it can never disagree with the counters.
 *
 * Clean blocks dominate the count: a category seen ten times but absent for two blocks is mastered,
 * because recency is what says whether a learner still makes the mistake.
 */
export function deriveStatus(count: number, cleanBlocks: number): ErrorStatus {
  if (cleanBlocks >= MASTERED_AFTER_CLEAN_BLOCKS) return 'mastered';
  if (cleanBlocks >= 1) return 'improving';
  if (count >= RECURRING_THRESHOLD) return 'recurring';
  return 'new';
}

export interface OccurrenceInput {
  wrong: string;
  right: string;
  lessonRef?: string;
}

export interface ApplyContext {
  learnerId: string;
  packId: string;
  blockOrder: number;
  now: Date;
}

/**
 * Record occurrences of one category. Seeing it again resets the clean-block run to zero — which is
 * how a previously mastered category drops back into the active set the moment it reappears.
 */
export function applyOccurrences(
  existing: ErrorLogEntry | undefined,
  category: string,
  occurrences: OccurrenceInput[],
  context: ApplyContext,
): ErrorLogEntry {
  const { learnerId, packId, blockOrder, now } = context;
  const added: ErrorExample[] = occurrences.map((occurrence) => ({ ...occurrence, at: now }));

  const base: ErrorLogEntry = existing ?? {
    learnerId,
    packId,
    category,
    examples: [],
    count: 0,
    firstSeen: now,
    lastSeen: now,
    lastBlockOrder: blockOrder,
    closedThrough: blockOrder - 1,
    cleanBlocks: 0,
    status: 'new',
  };

  const count = base.count + occurrences.length;
  // Keep the most recent examples — the old ones stop being representative as a learner changes.
  const examples = [...base.examples, ...added].slice(-MAX_EXAMPLES);
  const closedThrough = Math.max(base.closedThrough, blockOrder - 1);

  return {
    ...base,
    examples,
    count,
    lastSeen: now,
    lastBlockOrder: blockOrder,
    closedThrough,
    // It just occurred, so the clean run is over regardless of how long it had been.
    cleanBlocks: 0,
    status: deriveStatus(count, 0),
  };
}

/**
 * Close a block: every category that did not appear in it earns a clean block, which is what moves
 * a category toward mastered.
 *
 * `cleanBlocks` is *derived* — the distance between the last occurrence and the furthest block
 * closed — rather than accumulated. That makes closing idempotent and order-independent, which
 * matters because a block review can be posted more than once.
 */
export function closeBlock(entries: ErrorLogEntry[], blockOrder: number): ErrorLogEntry[] {
  return entries.map((entry) => {
    const closedThrough = Math.max(entry.closedThrough, blockOrder);
    if (closedThrough === entry.closedThrough) return entry;
    const cleanBlocks = Math.max(0, closedThrough - entry.lastBlockOrder);
    return { ...entry, closedThrough, cleanBlocks, status: deriveStatus(entry.count, cleanBlocks) };
  });
}

/** Categories still costing the learner marks — these become the next block's re-drill list. */
export function redrillCategories(entries: ErrorLogEntry[]): string[] {
  return entries
    .filter((entry) => entry.status === 'recurring')
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .map((entry) => entry.category);
}

/** Categories that have gone quiet long enough to drop out of active drilling. */
export function retireCategories(entries: ErrorLogEntry[]): string[] {
  return entries
    .filter((entry) => entry.status === 'mastered')
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((entry) => entry.category);
}

/** The categories that should drive the next block's focus. */
export function topRecurring(entries: ErrorLogEntry[], limit = 3): ErrorLogEntry[] {
  return entries
    .filter((entry) => entry.status === 'recurring' || entry.status === 'improving')
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .slice(0, limit);
}

/** Fold a correction's per-item categories into `{category: occurrences}`. */
export function tallyCategories(items: { categories: string[] }[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const item of items) {
    for (const category of item.categories) {
      tally[category] = (tally[category] ?? 0) + 1;
    }
  }
  return tally;
}
