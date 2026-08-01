/**
 * The stage / streak / mastery machine.
 *
 * These tests are the executable form of the rules the two browser trainers stated in prose:
 * two correct in a row clears a stage, stage 2 is gated behind stage 1, and a wrong answer resets
 * the streak to zero.
 */

import { describe, expect, it } from 'vitest';
import {
  applyAttempt,
  initialProgress,
  isDueAtStage,
  stage2Unlocked,
  summarize,
} from '../../src/domain/drill-progress.js';

/** Feed a sequence of verdicts through the machine. */
function run(verdicts: boolean[], stages: 1 | 2 = 2) {
  return verdicts.reduce((progress, correct) => applyAttempt(progress, correct, stages), initialProgress());
}

describe('a fresh item', () => {
  it('starts at stage 1 with no streak and nothing cleared', () => {
    const progress = initialProgress();
    expect(progress).toMatchObject({ stage: 1, streak: 0, stage1Cleared: false, mastered: false });
  });

  it('is due at stage 1 and not at stage 2', () => {
    expect(isDueAtStage(initialProgress(), 1)).toBe(true);
    expect(isDueAtStage(initialProgress(), 2)).toBe(false);
  });
});

describe('clearing a stage', () => {
  it('takes two correct in a row', () => {
    expect(run([true])).toMatchObject({ stage: 1, streak: 1, stage1Cleared: false });
    expect(run([true, true])).toMatchObject({ stage1Cleared: true });
  });

  it('moves the item into stage 2 and starts that stage fresh', () => {
    expect(run([true, true])).toMatchObject({ stage: 2, streak: 0, mastered: false });
  });

  it('stops showing the item at stage 1 once stage 1 is cleared', () => {
    const progress = run([true, true]);
    expect(isDueAtStage(progress, 1)).toBe(false);
    expect(isDueAtStage(progress, 2)).toBe(true);
  });
});

describe('stage 2 is gated behind stage 1', () => {
  it('stays locked until stage 1 is cleared', () => {
    expect(stage2Unlocked(initialProgress())).toBe(false);
    expect(stage2Unlocked(run([true]))).toBe(false);
    expect(stage2Unlocked(run([true, true]))).toBe(true);
  });

  it('masters the item only after both stages are cleared', () => {
    expect(run([true, true]).mastered).toBe(false);
    expect(run([true, true, true, true])).toMatchObject({ mastered: true, stage1Cleared: true, stage2Cleared: true });
  });
});

describe('a wrong answer', () => {
  it('resets the streak to zero', () => {
    expect(run([true, false])).toMatchObject({ streak: 0, stage1Cleared: false });
  });

  it('means a near miss earns nothing — two more correct are needed', () => {
    expect(run([true, false, true])).toMatchObject({ streak: 1, stage1Cleared: false });
    expect(run([true, false, true, true])).toMatchObject({ stage1Cleared: true });
  });

  it('does not undo a stage already cleared', () => {
    const progress = run([true, true, false]);
    expect(progress).toMatchObject({ stage: 2, streak: 0, stage1Cleared: true });
  });
});

describe('single-stage items', () => {
  it('are mastered by clearing their only stage', () => {
    expect(run([true, true], 1)).toMatchObject({ mastered: true, stage1Cleared: true });
  });
});

describe('a mastered item', () => {
  it('is inert — revisiting it cannot demote it', () => {
    const mastered = run([true, true, true, true]);
    const after = applyAttempt(mastered, false, 2);
    expect(after.mastered).toBe(true);
    expect(after.stage2Cleared).toBe(true);
  });

  it('still counts the attempt', () => {
    const mastered = run([true, true, true, true]);
    expect(applyAttempt(mastered, false, 2).attempts).toBe(mastered.attempts + 1);
  });

  it('is due at neither stage', () => {
    const mastered = run([true, true, true, true]);
    expect(isDueAtStage(mastered, 1)).toBe(false);
    expect(isDueAtStage(mastered, 2)).toBe(false);
  });
});

describe('deck summary', () => {
  it('counts stage 2 as unlocked-but-unfinished, not as every item', () => {
    const entries = [run([true, true]), run([true, true, true, true]), run([true])];
    // 2 items cleared stage 1; 1 of them is fully mastered; so 1 is sitting in stage 2.
    expect(summarize(entries, 3)).toMatchObject({
      total: 3,
      stage1Cleared: 2,
      stage2Unlocked: 1,
      mastered: 1,
      inProgress: 2,
    });
  });
});
