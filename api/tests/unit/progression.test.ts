/**
 * Progression and ramp position. The promise being pinned here is "lessons, not dates": every
 * function is of position, never of elapsed time.
 */

import { describe, expect, it } from 'vitest';
import {
  blockProgress,
  expectedAnswerRefs,
  hasContent,
  nextLessonOrder,
  unknownAnswerRefs,
} from '../../src/domain/progression.js';
import { nextLevel, rampPosition, rampStepFor } from '../../src/domain/ramp.js';
import type { Framework, Lesson } from '../../src/domain/types.js';

const lesson: Lesson = {
  lessonId: 'l1',
  blockId: 'b1',
  packId: 'p1',
  order: 1,
  title: 'Test lesson',
  sections: [
    { id: 'tekst', kind: 'text', body: 'Some prose.' },
    {
      id: 'vragen',
      kind: 'questions',
      items: [
        { ref: '1', prompt: 'First?' },
        { ref: '2', prompt: 'Second?' },
      ],
    },
    { id: 'schrijf', kind: 'write', prompt: 'Write something.' },
    { id: 'spreek', kind: 'speak', prompt: 'Say something.' },
  ],
};

describe('nextLessonOrder', () => {
  it('advances by one within the block', () => {
    expect(nextLessonOrder(1, 6)).toBe(2);
  });

  it('returns null at the end of the block', () => {
    expect(nextLessonOrder(6, 6)).toBeNull();
  });
});

describe('blockProgress', () => {
  it('points at the first untouched lesson', () => {
    expect(blockProgress(6, [1, 2], []).nextLessonOrder).toBe(3);
  });

  it('skips a lesson already submitted but not yet corrected', () => {
    const progress = blockProgress(6, [1], [2]);
    expect(progress.nextLessonOrder).toBe(3);
    expect(progress.pendingOrders).toEqual([2]);
  });

  it('counts only corrected lessons as completed — feedback is what feeds the next block', () => {
    const progress = blockProgress(6, [1, 2], [3]);
    expect(progress.completed).toBe(2);
    expect(progress.complete).toBe(false);
  });

  it('is complete only when every lesson has been corrected', () => {
    expect(blockProgress(3, [1, 2, 3], []).complete).toBe(true);
    expect(blockProgress(3, [1, 2], [3]).complete).toBe(false);
  });

  it('has no next lesson once every lesson is touched', () => {
    expect(blockProgress(2, [1, 2], []).nextLessonOrder).toBeNull();
  });

  it('deduplicates and never double-counts a lesson listed as both corrected and pending', () => {
    const progress = blockProgress(3, [1, 1], [1, 2]);
    expect(progress.correctedOrders).toEqual([1]);
    expect(progress.pendingOrders).toEqual([2]);
  });

  it('treats an empty block as incomplete rather than trivially done', () => {
    expect(blockProgress(0, [], []).complete).toBe(false);
  });
});

describe('answer references', () => {
  it('lists a reference for every prompt a lesson asks the learner to write', () => {
    expect(expectedAnswerRefs(lesson)).toEqual(['vragen.1', 'vragen.2', 'schrijf']);
  });

  it('does not ask for a written answer to a speaking task', () => {
    expect(expectedAnswerRefs(lesson)).not.toContain('spreek');
  });

  it('reports an unknown reference rather than rejecting the submission', () => {
    const answers = [
      { ref: 'schrijf', text: 'ok' },
      { ref: 'verwijderd.9', text: 'orphan' },
    ];
    expect(unknownAnswerRefs(lesson, answers)).toEqual(['verwijderd.9']);
  });
});

describe('hasContent', () => {
  it('is false when every answer is blank', () => {
    expect(
      hasContent([
        { ref: 'a', text: '   ' },
        { ref: 'b', text: '' },
      ]),
    ).toBe(false);
  });

  it('is true when any answer has text', () => {
    expect(
      hasContent([
        { ref: 'a', text: '' },
        { ref: 'b', text: 'iets' },
      ]),
    ).toBe(true);
  });
});

describe('ramp', () => {
  const framework: Framework = {
    id: 'cefr',
    levels: ['A2', 'B1.1', 'B1.2', 'B2.1', 'B2.2'],
    ramp: [
      { fromBlock: 1, toBlock: 8, level: 'B1.1', phase: 'consolidate', dials: { textLength: '~170 words' } },
      { fromBlock: 9, toBlock: 20, level: 'B1.2', phase: 'nuance' },
      { fromBlock: 21, toBlock: 28, level: 'B2.1', phase: 'sprint' },
    ],
  };

  it('finds the step covering a block', () => {
    expect(rampStepFor(framework, 5)?.level).toBe('B1.1');
    expect(rampStepFor(framework, 9)?.level).toBe('B1.2');
  });

  it('has no step beyond the declared ramp', () => {
    expect(rampStepFor(framework, 99)).toBeNull();
  });

  it('carries the authoring dials through untouched', () => {
    expect(rampPosition(framework, 3).dials).toEqual({ textLength: '~170 words' });
  });

  it('holds the level inside a stretch and steps up at its edge', () => {
    expect(rampPosition(framework, 3).nextLevel).toBe('B1.1');
    expect(rampPosition(framework, 8).nextLevel).toBe('B1.2');
  });

  it('reports how far through the ramp a block sits', () => {
    expect(rampPosition(framework, 14).fraction).toBeCloseTo(0.5);
  });

  it('walks the level ladder', () => {
    expect(nextLevel(framework, 'B1.2')).toBe('B2.1');
    expect(nextLevel(framework, 'B2.2')).toBeNull();
    expect(nextLevel(framework, undefined)).toBe('A2');
  });
});
