/**
 * Word-order drill rules, including the two that are easy to get wrong: an alternative order must be
 * a permutation of the same chunks or it is ignored, and building the other valid order is good
 * Dutch in the wrong round — not an error.
 *
 * Sentences here are invented for the test (ADR-0006).
 */

import { describe, expect, it } from 'vitest';
import {
  checkOrder,
  isPermutation,
  leadCueForStage,
  partsForStage,
  renderOrder,
  shuffleParts,
  stageCount,
  usableAlternative,
} from '../../src/domain/word-order.js';
import type { WordOrderPayload } from '../../src/domain/types.js';

/** A two-order item: the time phrase can lead, which inverts subject and verb. */
const twoOrder: WordOrderPayload = {
  kind: 'word-order',
  sentence: 'Morgen begin ik met de nieuwe cursus.',
  parts: ['ik', 'begin', 'morgen', 'met de nieuwe cursus'],
  partsAlt: ['morgen', 'begin', 'ik', 'met de nieuwe cursus'],
  translation: 'Tomorrow I start the new course.',
  tip: 'Fronting a time phrase inverts subject and verb (V2).',
};

const singleOrder: WordOrderPayload = {
  kind: 'word-order',
  sentence: 'Ik denk dat het goed werkt.',
  parts: ['ik denk', 'dat het', 'goed', 'werkt'],
  translation: 'I think it works well.',
};

describe('isPermutation', () => {
  it('accepts the same chunks in a different order', () => {
    expect(isPermutation(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
  });

  it('rejects a different length', () => {
    expect(isPermutation(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
  });

  it('rejects a substituted chunk', () => {
    expect(isPermutation(['a', 'b'], ['a', 'x'])).toBe(false);
  });

  it('counts duplicates rather than treating chunks as a set', () => {
    expect(isPermutation(['a', 'a', 'b'], ['a', 'b', 'b'])).toBe(false);
    expect(isPermutation(['a', 'a', 'b'], ['b', 'a', 'a'])).toBe(true);
  });

  it('ignores case, since whichever chunk leads gets capitalised', () => {
    expect(isPermutation(['Ik', 'werk'], ['werk', 'ik'])).toBe(true);
  });
});

describe('usableAlternative', () => {
  it('accepts an alternative built from the same chunks', () => {
    expect(usableAlternative(twoOrder)).toEqual(twoOrder.partsAlt);
  });

  it('is null when there is no alternative', () => {
    expect(usableAlternative(singleOrder)).toBeNull();
  });

  it('silently ignores an alternative that is not a permutation — authoring typos degrade, not break', () => {
    const malformed: WordOrderPayload = { ...twoOrder, partsAlt: ['morgen', 'begin', 'ik'] };
    expect(usableAlternative(malformed)).toBeNull();
    expect(stageCount(malformed)).toBe(1);
  });

  it('ignores an alternative identical to the primary order', () => {
    expect(usableAlternative({ ...twoOrder, partsAlt: [...twoOrder.parts] })).toBeNull();
  });
});

describe('stages', () => {
  it('offers two stages only when a usable alternative exists', () => {
    expect(stageCount(twoOrder)).toBe(2);
    expect(stageCount(singleOrder)).toBe(1);
  });

  it('drills the primary order at stage 1 and the alternative at stage 2', () => {
    expect(partsForStage(twoOrder, 1)).toEqual(twoOrder.parts);
    expect(partsForStage(twoOrder, 2)).toEqual(twoOrder.partsAlt);
  });

  it('falls back to the primary order when a single-order item is asked for stage 2', () => {
    expect(partsForStage(singleOrder, 2)).toEqual(singleOrder.parts);
  });

  it('cues the required first chunk, but only when there are two orders to tell apart', () => {
    expect(leadCueForStage(twoOrder, 1)).toBe('Ik');
    expect(leadCueForStage(twoOrder, 2)).toBe('Morgen');
    expect(leadCueForStage(singleOrder, 1)).toBeUndefined();
  });
});

describe('checkOrder', () => {
  it('accepts the expected order', () => {
    const result = checkOrder(twoOrder.parts, twoOrder, 1);
    expect(result.correct).toBe(true);
    expect(result.marks.every(Boolean)).toBe(true);
  });

  it('accepts the expected order regardless of the capital on the leading chunk', () => {
    expect(checkOrder(['Ik', 'begin', 'morgen', 'met de nieuwe cursus'], twoOrder, 1).correct).toBe(true);
  });

  it('flags the other valid order as good Dutch in the wrong round, not as correct', () => {
    const result = checkOrder(twoOrder.partsAlt as string[], twoOrder, 1);
    expect(result.correct).toBe(false);
    expect(result.otherValidOrder).toBe(true);
  });

  it('flags the primary order when the learner is being asked for the alternative', () => {
    const result = checkOrder(twoOrder.parts, twoOrder, 2);
    expect(result.correct).toBe(false);
    expect(result.otherValidOrder).toBe(true);
  });

  it('does not claim "other valid order" for a genuinely wrong order', () => {
    const result = checkOrder(['begin', 'ik', 'morgen', 'met de nieuwe cursus'], twoOrder, 1);
    expect(result.correct).toBe(false);
    expect(result.otherValidOrder).toBe(false);
  });

  it('marks each chunk so the learner sees where the order went wrong', () => {
    const result = checkOrder(['ik', 'morgen', 'begin', 'met de nieuwe cursus'], twoOrder, 1);
    expect(result.marks).toEqual([true, false, false, true]);
  });

  it('reports the order not being practised so feedback can show the pair', () => {
    expect(checkOrder(twoOrder.parts, twoOrder, 1).alternative).toEqual(twoOrder.partsAlt);
    expect(checkOrder(singleOrder.parts, singleOrder, 1).alternative).toBeNull();
  });
});

describe('rendering', () => {
  it('capitalises whichever chunk landed first', () => {
    expect(renderOrder(['morgen', 'begin', 'ik'])).toBe('Morgen begin ik');
    expect(renderOrder(['ik', 'begin', 'morgen'])).toBe('Ik begin morgen');
  });

  it('renders an empty order as an empty string', () => {
    expect(renderOrder([])).toBe('');
  });
});

describe('shuffleParts', () => {
  it('keeps the same chunks', () => {
    expect(isPermutation(shuffleParts(twoOrder.parts, 42), twoOrder.parts)).toBe(true);
  });

  it('is deterministic for a given seed, so a reload does not reshuffle', () => {
    expect(shuffleParts(twoOrder.parts, 7)).toEqual(shuffleParts(twoOrder.parts, 7));
  });

  it('never hands back the answer', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      expect(shuffleParts(twoOrder.parts, seed)).not.toEqual(twoOrder.parts);
    }
  });
});
