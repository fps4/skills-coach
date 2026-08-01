/**
 * Word-order drill rules.
 *
 * From the program this replaces: the learner gets the meaning in their own language plus the
 * sentence's chunks, shuffled, and taps them into order. Dutch allows the *same* sentence in more
 * than one correct order (V2 topicalisation), so an item may carry a second order built from the
 * identical chunk set:
 *
 *   "DelenB must be a permutation of the exact same chunks as Delen — if it isn't, the trainer
 *    silently ignores it and treats the row as single-order."
 *
 *   "Build the other valid order by mistake? It's flagged as '↔ ook goed Nederlands — maar deze
 *    ronde oefenen we de andere volgorde'."
 *
 * That second rule matters pedagogically: telling a learner their correct Dutch is wrong teaches
 * them the wrong lesson. Pure: no I/O.
 */

import type { Stage, WordOrderPayload } from './types.js';

/** Chunks are compared case-insensitively — whichever lands first is auto-capitalised on render. */
function canonical(chunk: string): string {
  return chunk.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function sameSequence(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((chunk, index) => canonical(chunk) === canonical(b[index] as string));
}

/** Multiset equality — same chunks, any order, duplicates counted. */
export function isPermutation(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const chunk of a) {
    const key = canonical(chunk);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const chunk of b) {
    const key = canonical(chunk);
    const remaining = counts.get(key);
    if (remaining === undefined || remaining === 0) return false;
    counts.set(key, remaining - 1);
  }
  return true;
}

/**
 * The item's alternative order, or null when it has none or the one it has is unusable.
 * Silently ignoring a malformed alternative is deliberate: a typo in authoring degrades the item to
 * single-order rather than breaking the drill.
 */
export function usableAlternative(payload: WordOrderPayload): string[] | null {
  const { parts, partsAlt } = payload;
  if (!partsAlt || partsAlt.length === 0) return null;
  if (!isPermutation(parts, partsAlt)) return null;
  if (sameSequence(parts, partsAlt)) return null;
  return partsAlt;
}

/** Two stages only when a usable alternative exists — this is what gates Volgorde 2. */
export function stageCount(payload: WordOrderPayload): 1 | 2 {
  return usableAlternative(payload) ? 2 : 1;
}

/** The order being practised at a given stage. */
export function partsForStage(payload: WordOrderPayload, stage: Stage): string[] {
  if (stage === 2) return usableAlternative(payload) ?? payload.parts;
  return payload.parts;
}

/** The chunk that must come first at this stage — shown as the cue, e.g. "begin met «Morgen»". */
export function leadCueForStage(payload: WordOrderPayload, stage: Stage): string | undefined {
  if (stageCount(payload) === 1) return undefined;
  return capitalizeFirst(partsForStage(payload, stage)[0] ?? '');
}

export interface OrderCheck {
  correct: boolean;
  /** The learner built the *other* valid order: good Dutch, wrong round. Never counted correct. */
  otherValidOrder: boolean;
  /** Per-position verdict against the expected order, for chunk-level feedback. */
  marks: boolean[];
  expected: string[];
  /** The order not being practised, when the item has one — feedback shows both side by side. */
  alternative: string[] | null;
}

/**
 * Grade a built order. `otherValidOrder` is reported alongside `correct: false` so the surface can
 * say "also correct Dutch, but this round we're practising the other order" instead of a bare wrong.
 */
export function checkOrder(given: string[], payload: WordOrderPayload, stage: Stage): OrderCheck {
  const expected = partsForStage(payload, stage);
  const alternative = usableAlternative(payload);
  const other = stage === 2 ? payload.parts : alternative;

  const correct = sameSequence(given, expected);
  const otherValidOrder = !correct && other !== null && sameSequence(given, other);

  const marks = given.map((chunk, index) => {
    const target = expected[index];
    return target !== undefined && canonical(chunk) === canonical(target);
  });

  return { correct, otherValidOrder, marks, expected, alternative };
}

/** Capitalise the chunk that landed first, so both orders render as real sentences. */
export function capitalizeFirst(chunk: string): string {
  if (!chunk) return chunk;
  return chunk.charAt(0).toLocaleUpperCase() + chunk.slice(1);
}

/** Render an ordered chunk list as a sentence, for feedback. */
export function renderOrder(parts: string[]): string {
  if (parts.length === 0) return '';
  return capitalizeFirst(parts.join(' ').replace(/\s+/g, ' ').trim());
}

/** A deterministic shuffle: the same item and seed always produce the same bank ordering. */
export function shuffleParts(parts: string[], seed: number): string[] {
  const result = [...parts];
  let state = (seed || 1) >>> 0;
  for (let i = result.length - 1; i > 0; i -= 1) {
    // xorshift32 — reproducible, and good enough to scramble a handful of chunks.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j] as string, result[i] as string];
  }
  // A shuffle that returns the answer is not a shuffle.
  if (result.length > 1 && sameSequence(result, parts)) {
    [result[0], result[1]] = [result[1] as string, result[0] as string];
  }
  return result;
}
