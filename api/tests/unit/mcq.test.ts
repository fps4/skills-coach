import { describe, expect, it } from 'vitest';

import { checkMcq, isMultipleResponse, optionsText, requiredCount, shuffleOptions } from '../../src/domain/mcq.js';
import { grade, promptFor, stagesFor } from '../../src/domain/grading.js';
import { initialProgress } from '../../src/domain/drill-progress.js';
import type { DrillItem, McqPayload } from '../../src/domain/types.js';

const single: McqPayload = {
  kind: 'mcq',
  stem: 'A company runs a workload across two AWS Regions and needs an RPO of five minutes.',
  options: [
    { ref: 'a', text: 'Amazon S3 Cross-Region Replication' },
    { ref: 'b', text: 'Amazon Aurora global database' },
    { ref: 'c', text: 'A nightly AWS Backup copy job' },
    { ref: 'd', text: 'An AWS Snowball Edge transfer' },
  ],
  correct: ['b'],
  explanation: 'An Aurora global database replicates with typical cross-Region lag under a second.',
  categories: ['d1-3-reliable-resilient'],
};

const multi: McqPayload = {
  ...single,
  stem: 'Which TWO controls reduce the blast radius of a compromised workload account?',
  correct: ['a', 'c'],
};

const item = (payload: McqPayload): DrillItem => ({
  drillItemId: 'pack.b1.d.abc123',
  packId: 'pack',
  blockId: 'pack.b1',
  payload,
});

describe('answer keys', () => {
  it('reads how many options a question wants', () => {
    expect(requiredCount(single)).toBe(1);
    expect(isMultipleResponse(single)).toBe(false);
    expect(requiredCount(multi)).toBe(2);
    expect(isMultipleResponse(multi)).toBe(true);
  });

  it('accepts the right single answer and rejects the rest', () => {
    expect(checkMcq(single, ['b']).correct).toBe(true);
    expect(checkMcq(single, ['a']).correct).toBe(false);
  });

  it('is order-free and duplicate-tolerant', () => {
    expect(checkMcq(multi, ['c', 'a']).correct).toBe(true);
    expect(checkMcq(multi, ['a', 'c', 'a']).correct).toBe(true);
  });

  // The rule the exam states: "you must select all the correct responses to receive credit".
  it('gives no credit for a partially correct multiple response', () => {
    const check = checkMcq(multi, ['a']);
    expect(check.correct).toBe(false);
    expect(check.missed).toEqual(['c']);
    expect(check.spurious).toEqual([]);
  });

  it('reports a correct pick alongside a spurious one as wrong', () => {
    const check = checkMcq(multi, ['a', 'c', 'd']);
    expect(check.correct).toBe(false);
    expect(check.spurious).toEqual(['d']);
  });

  it('grades an empty answer as wrong rather than skipped', () => {
    expect(checkMcq(single, []).correct).toBe(false);
  });

  // A ref the item does not define cannot have come from the surface. Counting it as a mistake
  // would put a client bug into the learner's error log.
  it('ignores refs the question does not define', () => {
    expect(checkMcq(single, ['b', 'zzz']).correct).toBe(true);
    expect(checkMcq(single, ['zzz']).correct).toBe(false);
  });

  it('renders an answer key as the text the learner saw', () => {
    expect(optionsText(multi, ['c', 'a'])).toBe('Amazon S3 Cross-Region Replication · A nightly AWS Backup copy job');
    expect(optionsText(single, [])).toBe('—');
  });
});

describe('option shuffling', () => {
  it('is stable for one seed and keeps every option', () => {
    const once = shuffleOptions(single.options, 12345);
    const twice = shuffleOptions(single.options, 12345);
    expect(once).toEqual(twice);
    expect([...once].map((option) => option.ref).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('varies with the seed, so position is not the lesson', () => {
    const orders = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        shuffleOptions(single.options, seed)
          .map((o) => o.ref)
          .join(''),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('an mcq as a drill item', () => {
  it('offers exactly one stage — a question has no reverse direction', () => {
    expect(stagesFor(item(single))).toBe(1);
  });

  // The guarantee the whole surface rests on: the key is not in the payload the browser receives.
  it('prompts without leaking the answer key', () => {
    const prompt = promptFor(item(single), 1, 42);
    expect(prompt.kind).toBe('mcq');
    expect(JSON.stringify(prompt)).not.toContain('correct');
    expect(JSON.stringify(prompt)).not.toContain('explanation');
    if (prompt.kind === 'mcq') {
      expect(prompt.choose).toBe(1);
      expect(prompt.options).toHaveLength(4);
    }
  });

  it('reveals the key and the explanation only after grading', () => {
    const result = grade({ item: item(single), stage: 1, given: ['b'] }, initialProgress());
    expect(result.correct).toBe(true);
    expect(result.correctRefs).toEqual(['b']);
    expect(result.explanation).toContain('Aurora global database');
    expect(result.expected).toBe('Amazon Aurora global database');
  });

  // Tolerant matching exists because free text cannot be enumerated; a list can be.
  it('refuses an override', () => {
    const result = grade({ item: item(single), stage: 1, given: ['a'], override: true }, initialProgress());
    expect(result.correct).toBe(false);
    expect(result.overridden).toBe(false);
  });

  it('clears the item after two correct in a row, and a miss resets the streak', () => {
    let progress = initialProgress();
    progress = grade({ item: item(single), stage: 1, given: ['b'] }, progress).progress;
    expect(progress.mastered).toBe(false);
    progress = grade({ item: item(single), stage: 1, given: ['a'] }, progress).progress;
    expect(progress.streak).toBe(0);
    progress = grade({ item: item(single), stage: 1, given: ['b'] }, progress).progress;
    progress = grade({ item: item(single), stage: 1, given: ['b'] }, progress).progress;
    expect(progress.mastered).toBe(true);
  });
});
