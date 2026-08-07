/**
 * Multiple-choice rules: what to show, and what counts as right.
 *
 * The exam this kind was built for states its own scoring rule, and it is the whole reason there is
 * no partial credit here:
 *
 *   "Multiple response: has two or more correct responses out of five or more response options. You
 *    must select all the correct responses to receive credit for the question."
 *
 * So grading is set equality. A learner who picks two of three correct options has designed an
 * architecture that does not work, and telling them they were most of the way there teaches the
 * wrong lesson — the same reasoning that makes `otherValidOrder` its own case rather than a pass.
 *
 * There is no override. Tolerant matching exists because free text cannot be enumerated; picking
 * from a list can be, so a rejection here is never the grader's fault.
 *
 * Pure: no I/O, no clock.
 */

import type { McqOption, McqPayload } from './types.js';

/** Canonical form of a chosen set: de-duplicated and ordered, so comparison is order-free. */
function normalize(refs: string[]): string[] {
  return [...new Set(refs.map((ref) => ref.trim()))].filter((ref) => ref.length > 0).sort();
}

/** How many options must be selected. Drives the "choose TWO" instruction the surface shows. */
export function requiredCount(payload: McqPayload): number {
  return normalize(payload.correct).length;
}

/** True when this question wants more than one option — the surface renders checkboxes, not radios. */
export function isMultipleResponse(payload: McqPayload): boolean {
  return requiredCount(payload) > 1;
}

/**
 * A deterministic shuffle of the option list.
 *
 * Seeded from the item id, so a reload shows the same order rather than reshuffling under the
 * learner — but shuffled at all, because an author who writes the correct option first every time
 * would otherwise be teaching position rather than content.
 */
export function shuffleOptions(options: McqOption[], seed: number): McqOption[] {
  const result = [...options];
  let state = (seed || 1) >>> 0;
  for (let i = result.length - 1; i > 0; i -= 1) {
    // xorshift32, as in word-order.ts — reproducible, and enough to scramble a handful of options.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j] as McqOption, result[i] as McqOption];
  }
  return result;
}

export interface McqCheck {
  correct: boolean;
  /** The full answer key, revealed after the learner commits. */
  expected: string[];
  /** Correct options the learner did not pick. */
  missed: string[];
  /** Incorrect options the learner did pick. */
  spurious: string[];
}

/**
 * Grade a set of chosen option refs against the key.
 *
 * Refs the item does not define are ignored rather than treated as wrong answers: they cannot have
 * come from the surface, and counting a malformed request as a mistake would put a client bug into
 * the learner's error log.
 */
export function checkMcq(payload: McqPayload, chosen: string[]): McqCheck {
  const known = new Set(payload.options.map((option) => option.ref));
  const picked = normalize(chosen).filter((ref) => known.has(ref));
  const expected = normalize(payload.correct);

  const missed = expected.filter((ref) => !picked.includes(ref));
  const spurious = picked.filter((ref) => !expected.includes(ref));

  return { correct: missed.length === 0 && spurious.length === 0, expected, missed, spurious };
}

/** Render an option ref as the text a learner saw, for feedback and error-log examples. */
export function optionText(payload: McqPayload, ref: string): string {
  return payload.options.find((option) => option.ref === ref)?.text ?? ref;
}

/** Join a set of refs into one readable string — what the error log records as wrong or right. */
export function optionsText(payload: McqPayload, refs: string[]): string {
  const sorted = normalize(refs);
  if (sorted.length === 0) return '—';
  return sorted.map((ref) => optionText(payload, ref)).join(' · ');
}
