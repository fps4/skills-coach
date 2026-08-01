/**
 * Grading: what the learner is asked, what counts, and what they are told afterwards.
 * Covers the override path, which is how tolerance stays strict without being unfair.
 */

import { describe, expect, it } from 'vitest';
import { grade, promptFor, stagesFor } from '../../src/domain/grading.js';
import { initialProgress } from '../../src/domain/drill-progress.js';
import type { DrillItem } from '../../src/domain/types.js';

const term: DrillItem = {
  drillItemId: 'd1',
  packId: 'p1',
  blockId: 'b1',
  lessonOrder: 1,
  payload: {
    kind: 'term',
    term: 'de doorlooptijd',
    translation: 'lead time / turnaround',
    example: 'De doorlooptijd daalde flink.',
  },
};

const sentence: DrillItem = {
  drillItemId: 'd2',
  packId: 'p1',
  blockId: 'b1',
  payload: {
    kind: 'word-order',
    sentence: 'Morgen begin ik met de cursus.',
    parts: ['ik', 'begin', 'morgen', 'met de cursus'],
    partsAlt: ['morgen', 'begin', 'ik', 'met de cursus'],
    translation: 'Tomorrow I start the course.',
    tip: 'Fronting a time phrase inverts subject and verb.',
  },
};

describe('stagesFor', () => {
  it('gives a term item both directions', () => {
    expect(stagesFor(term)).toBe(2);
  });

  it('gives a word-order item a second stage only when it has a usable alternative', () => {
    expect(stagesFor(sentence)).toBe(2);
    const single = { ...sentence, payload: { ...sentence.payload, partsAlt: undefined } } as DrillItem;
    expect(stagesFor(single)).toBe(1);
  });
});

describe('prompting a term item', () => {
  it('asks content → translation at stage 1', () => {
    const prompt = promptFor(term, 1);
    expect(prompt).toMatchObject({ kind: 'term', prompt: 'de doorlooptijd' });
  });

  it('asks translation → content at stage 2, which is where spelling gets drilled', () => {
    expect(promptFor(term, 2).prompt).toBe('lead time / turnaround');
  });

  it('shows the example as-is at stage 1', () => {
    expect((promptFor(term, 1) as { hint?: string }).hint).toBe('De doorlooptijd daalde flink.');
  });

  it('masks the answer inside the example at stage 2, so the hint hints', () => {
    const hint = (promptFor(term, 2) as { hint?: string }).hint ?? '';
    expect(hint).not.toMatch(/doorlooptijd/i);
    expect(hint).toContain('…');
  });
});

describe('prompting a word-order item', () => {
  it('prompts with the meaning and a shuffled bank', () => {
    const prompt = promptFor(sentence, 1, 3);
    expect(prompt).toMatchObject({ kind: 'word-order', prompt: 'Tomorrow I start the course.' });
    expect((prompt as { bank: string[] }).bank).toHaveLength(4);
    expect((prompt as { bank: string[] }).bank).not.toEqual(
      sentence.payload.kind === 'word-order' ? sentence.payload.parts : [],
    );
  });

  it('cues which chunk must lead when there are two orders', () => {
    expect((promptFor(sentence, 2, 3) as { leadCue?: string }).leadCue).toBe('Morgen');
  });
});

describe('grading a term item', () => {
  it('accepts a tolerated form and advances the streak', () => {
    const result = grade({ item: term, stage: 1, given: 'lead time' }, initialProgress());
    expect(result.correct).toBe(true);
    expect(result.overridden).toBe(false);
    expect(result.progress.streak).toBe(1);
  });

  it('rejects a misspelling and holds the streak at zero', () => {
    const result = grade({ item: term, stage: 2, given: 'de doorloptijd' }, initialProgress());
    expect(result.correct).toBe(false);
    expect(result.progress.streak).toBe(0);
  });

  it('reveals the expected answer and everything it would have taken', () => {
    const result = grade({ item: term, stage: 1, given: 'nonsense' }, initialProgress());
    expect(result.expected).toBe('lead time / turnaround');
    expect(result.acceptedAlso).toContain('lead time');
    expect(result.acceptedAlso).toContain('turnaround');
  });

  it('honours an override, marks it as one, and lets it earn the streak', () => {
    const result = grade({ item: term, stage: 1, given: 'cycle time', override: true }, initialProgress());
    expect(result.correct).toBe(true);
    expect(result.overridden).toBe(true);
    expect(result.progress.streak).toBe(1);
  });

  it('does not mark an override when the answer was right anyway', () => {
    const result = grade({ item: term, stage: 1, given: 'lead time', override: true }, initialProgress());
    expect(result.overridden).toBe(false);
  });
});

describe('grading a word-order item', () => {
  it('accepts the practised order and reveals the authored sentence at stage 1', () => {
    const result = grade(
      { item: sentence, stage: 1, given: ['ik', 'begin', 'morgen', 'met de cursus'] },
      initialProgress(),
    );
    expect(result.correct).toBe(true);
    expect(result.expected).toBe('Morgen begin ik met de cursus.');
  });

  it('renders stage 2 from its own chunks', () => {
    const result = grade(
      { item: sentence, stage: 2, given: ['morgen', 'begin', 'ik', 'met de cursus'] },
      initialProgress(),
    );
    expect(result.correct).toBe(true);
    expect(result.expected).toBe('Morgen begin ik met de cursus');
  });

  it('reports the other valid order without counting it correct', () => {
    const result = grade(
      { item: sentence, stage: 1, given: ['morgen', 'begin', 'ik', 'met de cursus'] },
      initialProgress(),
    );
    expect(result.correct).toBe(false);
    expect(result.otherValidOrder).toBe(true);
    expect(result.progress.streak).toBe(0);
  });

  it('shows both orders so the pair gets internalised', () => {
    const result = grade(
      { item: sentence, stage: 1, given: ['ik', 'begin', 'morgen', 'met de cursus'] },
      initialProgress(),
    );
    expect(result.alternative).toBe('Morgen begin ik met de cursus');
  });

  it('marks each chunk and carries the grammar tip', () => {
    const result = grade(
      { item: sentence, stage: 1, given: ['begin', 'ik', 'morgen', 'met de cursus'] },
      initialProgress(),
    );
    expect(result.marks).toEqual([false, false, true, true]);
    expect(result.tip).toBe('Fronting a time phrase inverts subject and verb.');
  });

  it('accepts a pipe-delimited order, so a simple client need not send an array', () => {
    const result = grade({ item: sentence, stage: 1, given: 'ik | begin | morgen | met de cursus' }, initialProgress());
    expect(result.correct).toBe(true);
  });
});
