/**
 * Assembling a sitting, and reading one back.
 *
 * This is the deterministic half of "adaptive" (ADR-0014). An external author decides what the next
 * block *contains*; this decides, from the error log the runtime already keeps, which of the
 * questions that exist a learner should be asked *now*. Both halves read the same evidence, which is
 * the only reason they cannot disagree about what a weak area is.
 *
 * Selection is deliberately a sort, not a scoring model. Every rule below is one the error log
 * already states in its own vocabulary, and inventing a second, cleverer notion of weakness beside
 * `status` would be the drift the single-join-key design exists to prevent.
 *
 * Pure: no I/O, no clock.
 */

import type { ErrorStatus, QuizAnswer } from './types.js';

/** A sitting's length. Twenty is a session a learner will actually finish in one go. */
export const DEFAULT_QUIZ_SIZE = 20;

/** How much a category's status pulls its questions forward. Recurring outranks everything. */
const STATUS_WEIGHT: Record<ErrorStatus, number> = {
  recurring: 3,
  new: 2,
  improving: 1,
  mastered: 0,
};

export interface QuizCandidate {
  drillItemId: string;
  categories: string[];
  /** Attempts the learner has already made on this item. Least-practised goes first. */
  attempts: number;
}

/**
 * Order the candidates and take the first `size`.
 *
 * Three keys, in order:
 *
 *   1. **Weakness.** The strongest status among the categories a question tests. A question probing
 *      something the learner keeps getting wrong outranks one probing something they have mastered.
 *   2. **Least practised.** Within the same weakness, an item never seen outranks one attempted
 *      twice — so a sitting works through the bank rather than re-showing favourites.
 *   3. **Id.** So the same evidence always produces the same sitting, which is what makes this
 *      testable at all.
 */
export function selectQuizItems(
  candidates: QuizCandidate[],
  statusByCategory: Map<string, ErrorStatus>,
  size: number = DEFAULT_QUIZ_SIZE,
): string[] {
  const weight = (candidate: QuizCandidate): number => {
    let best = 0;
    for (const category of candidate.categories) {
      const status = statusByCategory.get(category);
      // A category with no entry has never cost the learner anything *and* has never been proven —
      // it ranks with `new`, above mastered and below recurring.
      const value = status ? STATUS_WEIGHT[status] : STATUS_WEIGHT.new;
      if (value > best) best = value;
    }
    return best;
  };

  return [...candidates]
    .sort((a, b) => weight(b) - weight(a) || a.attempts - b.attempts || a.drillItemId.localeCompare(b.drillItemId))
    .slice(0, Math.max(0, size))
    .map((candidate) => candidate.drillItemId);
}

export interface QuizScore {
  asked: number;
  answered: number;
  correct: number;
  /** Correct as a share of *answered*. Null before anything has been answered. */
  accuracy: number | null;
}

export function scoreSession(itemIds: string[], answers: QuizAnswer[]): QuizScore {
  const correct = answers.filter((answer) => answer.correct).length;
  return {
    asked: itemIds.length,
    answered: answers.length,
    correct,
    accuracy: answers.length === 0 ? null : correct / answers.length,
  };
}

export interface CategoryBreakdown {
  category: string;
  asked: number;
  correct: number;
  accuracy: number;
}

/**
 * Per-category accuracy over a set of answers.
 *
 * A question tagged with two categories counts once against each: it genuinely tested both, and
 * splitting the credit would make a two-category question worth less than a one-category one.
 */
export function breakdownByCategory(answers: QuizAnswer[]): CategoryBreakdown[] {
  const tally = new Map<string, { asked: number; correct: number }>();

  for (const answer of answers) {
    for (const category of answer.categories) {
      const entry = tally.get(category) ?? { asked: 0, correct: 0 };
      entry.asked += 1;
      if (answer.correct) entry.correct += 1;
      tally.set(category, entry);
    }
  }

  return (
    [...tally.entries()]
      .map(([category, entry]) => ({
        category,
        asked: entry.asked,
        correct: entry.correct,
        accuracy: entry.correct / entry.asked,
      }))
      // Weakest first: this list exists to be acted on, and the top of it is the action.
      .sort((a, b) => a.accuracy - b.accuracy || b.asked - a.asked || a.category.localeCompare(b.category))
  );
}

/** Whether a sitting has been answered through. What makes `finish` a no-op rather than an error. */
export function isComplete(itemIds: string[], answers: QuizAnswer[]): boolean {
  const answered = new Set(answers.map((answer) => answer.drillItemId));
  return itemIds.every((id) => answered.has(id));
}

/**
 * The next item to ask: the first in the fixed order that has not been answered.
 *
 * Order is fixed at start rather than recomputed, so a learner who reloads mid-sitting resumes the
 * same sitting instead of a fresh one assembled from evidence that has since moved.
 */
export function nextItemId(itemIds: string[], answers: QuizAnswer[]): string | null {
  const answered = new Set(answers.map((answer) => answer.drillItemId));
  return itemIds.find((id) => !answered.has(id)) ?? null;
}
