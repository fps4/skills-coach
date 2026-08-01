/**
 * The stage / streak / mastery machine, shared by both drill kinds.
 *
 * Both trainers in the program this replaces used the same progression, described twice:
 *
 *   "Type the English. 2 correct in a row → the word is hidden. NL → EN is the gate. A word only
 *    enters the EN → NL deck once it's been cleared (2× green) in NL → EN. A wrong answer resets
 *    that word's streak to 0, and the word keeps coming back until it's mastered."
 *
 *   "2 correct in a row → the sentence is solved. Volgorde 2 is gated behind Volgorde 1. A sentence
 *    counts as beheerst only when both orders are solved."
 *
 * One machine, so the two surfaces cannot drift apart. Pure: no I/O, no clock.
 */

import type { Stage } from './types.js';

/** Consecutive correct answers that clear a stage. */
export const CLEAR_STREAK = 2;

export interface DrillProgress {
  stage: Stage;
  streak: number;
  stage1Cleared: boolean;
  stage2Cleared: boolean;
  mastered: boolean;
  attempts: number;
  correct: number;
}

export function initialProgress(): DrillProgress {
  return { stage: 1, streak: 0, stage1Cleared: false, stage2Cleared: false, mastered: false, attempts: 0, correct: 0 };
}

/**
 * How many stages an item offers. A `term` always has two (forward, then reverse); a `word-order`
 * item has two only when it carries a usable alternative order.
 */
export type StageCount = 1 | 2;

/**
 * Apply one graded attempt. `correct` is the *final* verdict, so a learner's accepted override
 * arrives here as `true` — an override earns the streak, because the learner was right.
 *
 * A mastered item is inert: further attempts are counted but change nothing, so revisiting an old
 * word cannot demote it.
 */
export function applyAttempt(progress: DrillProgress, correct: boolean, stages: StageCount): DrillProgress {
  const counted: DrillProgress = {
    ...progress,
    attempts: progress.attempts + 1,
    correct: progress.correct + (correct ? 1 : 0),
  };

  if (progress.mastered) return counted;
  if (!correct) return { ...counted, streak: 0 };

  const streak = counted.streak + 1;
  if (streak < CLEAR_STREAK) return { ...counted, streak };

  // Stage cleared.
  if (counted.stage === 1) {
    const cleared: DrillProgress = { ...counted, stage1Cleared: true };
    return stages === 1
      ? { ...cleared, streak, mastered: true }
      : // Unlocks the reverse direction and starts it fresh — the gate the trainers described.
        { ...cleared, stage: 2, streak: 0 };
  }

  return { ...counted, stage: 2, streak, stage2Cleared: true, mastered: true };
}

/** Whether an item should still appear in the rotation for a given stage. */
export function isDueAtStage(progress: DrillProgress, stage: Stage): boolean {
  if (progress.mastered) return false;
  return progress.stage === stage;
}

/** True once stage 2 has been unlocked by clearing stage 1. */
export function stage2Unlocked(progress: DrillProgress): boolean {
  return progress.stage1Cleared;
}

export interface DeckSummary {
  total: number;
  stage1Cleared: number;
  stage2Unlocked: number;
  mastered: number;
  inProgress: number;
}

export function summarize(entries: DrillProgress[], total: number): DeckSummary {
  let stage1Cleared = 0;
  let mastered = 0;
  for (const entry of entries) {
    if (entry.stage1Cleared) stage1Cleared += 1;
    if (entry.mastered) mastered += 1;
  }
  return {
    total,
    stage1Cleared,
    // Unlocked but not yet finished — the "EN → NL counts unlocked words, not all words" rule.
    stage2Unlocked: stage1Cleared - mastered,
    mastered,
    inProgress: total - mastered,
  };
}
