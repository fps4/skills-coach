import { describe, expect, it } from 'vitest';

import { applyProgress } from './deck-summary';
import type { DeckSummary, DrillProgress } from './types';

const deck = (over: Partial<DeckSummary> = {}): DeckSummary => ({
  total: 20,
  stage1Cleared: 0,
  stage2Unlocked: 0,
  mastered: 0,
  inProgress: 20,
  ...over,
});

const progress = (over: Partial<DrillProgress> = {}): DrillProgress => ({
  stage: 1,
  streak: 0,
  stage1Cleared: false,
  stage2Cleared: false,
  mastered: false,
  attempts: 0,
  correct: 0,
  ...over,
});

describe('applyProgress', () => {
  it('leaves the meters alone while a streak is only building', () => {
    const after = applyProgress(deck(), progress(), progress({ streak: 1, attempts: 1, correct: 1 }));
    expect(after).toEqual(deck());
  });

  it('counts a stage cleared the moment the second correct answer lands', () => {
    const after = applyProgress(deck(), progress({ streak: 1 }), progress({ stage: 2, streak: 0, stage1Cleared: true }));
    expect(after.stage1Cleared).toBe(1);
    expect(after.stage2Unlocked).toBe(1);
    expect(after.mastered).toBe(0);
  });

  it('counts mastery, and stops counting the item as unlocked-but-unfinished', () => {
    const after = applyProgress(
      deck({ stage1Cleared: 1, stage2Unlocked: 1 }),
      progress({ stage: 2, streak: 1, stage1Cleared: true }),
      progress({ stage: 2, streak: 2, stage1Cleared: true, stage2Cleared: true, mastered: true }),
    );
    expect(after.mastered).toBe(1);
    expect(after.stage2Unlocked).toBe(0);
    expect(after.inProgress).toBe(19);
  });

  it('counts a single-stage item that clears and masters in one attempt only once', () => {
    const after = applyProgress(deck(), progress({ streak: 1 }), progress({ streak: 2, stage1Cleared: true, mastered: true }));
    expect(after.stage1Cleared).toBe(1);
    expect(after.mastered).toBe(1);
    expect(after.stage2Unlocked).toBe(0);
  });

  it('does not double-count an item that was already mastered', () => {
    const mastered = progress({ stage1Cleared: true, stage2Cleared: true, mastered: true });
    const after = applyProgress(deck({ stage1Cleared: 3, mastered: 3, inProgress: 17 }), mastered, mastered);
    expect(after.mastered).toBe(3);
    expect(after.stage1Cleared).toBe(3);
  });

  it('never exceeds the deck total', () => {
    const after = applyProgress(
      deck({ total: 1, stage1Cleared: 1, stage2Unlocked: 1 }),
      progress({ stage: 2, stage1Cleared: true }),
      progress({ stage: 2, stage1Cleared: true, stage2Cleared: true, mastered: true }),
    );
    expect(after.mastered).toBe(1);
    expect(after.inProgress).toBe(0);
  });
});
