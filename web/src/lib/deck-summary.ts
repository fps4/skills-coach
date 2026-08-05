/**
 * Folding one graded attempt into the deck meters.
 *
 * The summary arrives with the deck, and the deck is only refetched once its batch is exhausted.
 * With twenty sentences in a block that is a whole pass spent watching "beheerst: 0/20" while
 * getting them right — the counters are correct, they are just reporting from before the session
 * started, which reads exactly like nothing is being counted.
 *
 * The attempt response carries the item's progress after grading, and the deck carries what it was
 * before, which is everything the counters need. Derived rather than refetched: a round-trip per
 * answer to recompute five numbers we can already work out is not worth the latency, and `load()`
 * still replaces this with the server's own count at the end of every pass.
 */

import type { DeckSummary, DrillProgress } from './types';

export function applyProgress(summary: DeckSummary, before: DrillProgress, after: DrillProgress): DeckSummary {
  const stage1Cleared = summary.stage1Cleared + (!before.stage1Cleared && after.stage1Cleared ? 1 : 0);
  const mastered = summary.mastered + (!before.mastered && after.mastered ? 1 : 0);

  return {
    total: summary.total,
    stage1Cleared,
    // Both derived exactly as the server derives them, so a refetch never contradicts this.
    stage2Unlocked: stage1Cleared - mastered,
    mastered,
    inProgress: summary.total - mastered,
  };
}
