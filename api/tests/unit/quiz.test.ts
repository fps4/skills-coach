import { describe, expect, it } from 'vitest';

import {
  breakdownByCategory,
  isComplete,
  nextItemId,
  scoreSession,
  selectQuizItems,
  type QuizCandidate,
} from '../../src/domain/quiz.js';
import type { ErrorStatus, QuizAnswer } from '../../src/domain/types.js';

const candidate = (id: string, categories: string[], attempts = 0): QuizCandidate => ({
  drillItemId: id,
  categories,
  attempts,
});

const answer = (id: string, correct: boolean, categories: string[]): QuizAnswer => ({
  drillItemId: id,
  chosen: ['a'],
  correct,
  categories,
  at: new Date('2026-08-07T10:00:00Z'),
});

describe('assembling a sitting', () => {
  const statuses = new Map<string, ErrorStatus>([
    ['weak', 'recurring'],
    ['improving', 'improving'],
    ['done', 'mastered'],
  ]);

  it('puts recurring categories first and mastered ones last', () => {
    const picked = selectQuizItems(
      [candidate('i-done', ['done']), candidate('i-weak', ['weak']), candidate('i-improving', ['improving'])],
      statuses,
    );
    expect(picked).toEqual(['i-weak', 'i-improving', 'i-done']);
  });

  // An untested category has never cost the learner anything, but has never been proven either.
  it('ranks an untracked category above mastered and below recurring', () => {
    const picked = selectQuizItems(
      [candidate('i-done', ['done']), candidate('i-unknown', ['never-seen']), candidate('i-weak', ['weak'])],
      statuses,
    );
    expect(picked).toEqual(['i-weak', 'i-unknown', 'i-done']);
  });

  it('takes the strongest signal among a question’s categories', () => {
    const picked = selectQuizItems(
      [candidate('i-both', ['done', 'weak']), candidate('i-mild', ['improving'])],
      statuses,
    );
    expect(picked[0]).toBe('i-both');
  });

  it('breaks a tie with least-practised, so a sitting works through the bank', () => {
    const picked = selectQuizItems([candidate('i-seen', ['weak'], 4), candidate('i-fresh', ['weak'], 0)], statuses);
    expect(picked).toEqual(['i-fresh', 'i-seen']);
  });

  it('is deterministic for identical evidence', () => {
    const items = [candidate('b', ['weak']), candidate('a', ['weak']), candidate('c', ['weak'])];
    expect(selectQuizItems(items, statuses)).toEqual(selectQuizItems([...items].reverse(), statuses));
  });

  it('honours the requested size and never invents items', () => {
    const items = [candidate('a', ['weak']), candidate('b', ['weak']), candidate('c', ['weak'])];
    expect(selectQuizItems(items, statuses, 2)).toHaveLength(2);
    expect(selectQuizItems(items, statuses, 20)).toHaveLength(3);
    expect(selectQuizItems(items, statuses, 0)).toEqual([]);
  });
});

describe('reading a sitting back', () => {
  it('scores against what was answered, not what was asked', () => {
    const score = scoreSession(['a', 'b', 'c', 'd'], [answer('a', true, ['x']), answer('b', false, ['x'])]);
    expect(score).toEqual({ asked: 4, answered: 2, correct: 1, accuracy: 0.5 });
  });

  it('reports no accuracy before anything is answered', () => {
    expect(scoreSession(['a'], []).accuracy).toBeNull();
  });

  // A two-category question genuinely tested both; splitting the credit would make it worth less.
  it('counts a multi-category question once against each category', () => {
    const rows = breakdownByCategory([answer('a', false, ['net', 'sec'])]);
    expect(rows).toEqual([
      { category: 'net', asked: 1, correct: 0, accuracy: 0 },
      { category: 'sec', asked: 1, correct: 0, accuracy: 0 },
    ]);
  });

  it('orders the breakdown weakest first — the list exists to be acted on', () => {
    const rows = breakdownByCategory([
      answer('a', true, ['strong']),
      answer('b', true, ['strong']),
      answer('c', false, ['weak']),
      answer('d', true, ['middling']),
      answer('e', false, ['middling']),
    ]);
    expect(rows.map((row) => row.category)).toEqual(['weak', 'middling', 'strong']);
  });

  it('knows the next unanswered question, in the fixed order', () => {
    expect(nextItemId(['a', 'b', 'c'], [answer('a', true, [])])).toBe('b');
    expect(nextItemId(['a', 'b'], [answer('b', true, []), answer('a', true, [])])).toBeNull();
  });

  it('is complete only when every asked item has an answer', () => {
    expect(isComplete(['a', 'b'], [answer('a', true, [])])).toBe(false);
    expect(isComplete(['a', 'b'], [answer('a', true, []), answer('b', false, [])])).toBe(true);
  });
});
