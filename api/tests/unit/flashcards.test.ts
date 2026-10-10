/**
 * Flashcards — one engine, two ways of answering, and a mode that answers nothing (ADR-0027).
 *
 * Pinned here: which way of answering a pack accepts, that a self-graded card moves the same streak
 * machine a typed one does, that the answer side of a card is only ever handed out by an explicit
 * reveal or by learn mode — neither of which carries a progress to persist — and that a cue holding
 * the answer is masked in the round where it would give the game away.
 *
 * Fixtures are invented (ADR-0006).
 */

import { describe, expect, it } from 'vitest';
import { AnswerModeError, cardGrading, checkAnswerMode, learnCard, revealCard } from '../../src/domain/flashcards.js';
import { grade, promptFor } from '../../src/domain/grading.js';
import { applyAttempt, initialProgress } from '../../src/domain/drill-progress.js';
import type { DrillItem } from '../../src/domain/types.js';

const concept: DrillItem = {
  drillItemId: 'kg.b1.d1',
  packId: 'kg',
  blockId: 'kg.b1',
  payload: {
    kind: 'term',
    term: 'Widget join',
    translation: 'Matching two widget lists on a shared key.',
    hint: 'Think of a widget join as a zipper.',
    group: 'Basics',
    example: 'A widget join pairs each left widget with its right twin.',
    details: {
      analogy: 'Like a SQL inner join, but for widgets.',
      code: 'SELECT * FROM left_widgets JOIN right_widgets USING (key);',
      source: 'Widgets guide · Joining',
      note: 'Order does not matter.',
    },
  },
};

const word: DrillItem = {
  drillItemId: 'w.b1.d1',
  packId: 'w',
  blockId: 'w.b1',
  payload: { kind: 'term', term: 'de doorlooptijd', translation: 'the lead time', example: 'De doorlooptijd is kort.' },
};

describe('a pack’s grading mode', () => {
  it('is typed unless the manifest says otherwise, so a word deck is unchanged', () => {
    expect(cardGrading({})).toBe('typed');
    expect(cardGrading({ flashcards: {} })).toBe('typed');
  });

  it('is self when the manifest declares it', () => {
    expect(cardGrading({ flashcards: { grading: 'self' } })).toBe('self');
  });
});

describe('which answers a pack accepts', () => {
  it('refuses a self-graded attempt on a typed pack', () => {
    expect(() => checkAnswerMode('typed', word, { self: 'got', override: false })).toThrow(AnswerModeError);
  });

  it('accepts a self-graded attempt on a self pack', () => {
    expect(() => checkAnswerMode('self', concept, { self: 'missed', override: false })).not.toThrow();
  });

  it('refuses a self grade combined with an override — there was no verdict to override', () => {
    expect(() => checkAnswerMode('self', concept, { self: 'got', override: true })).toThrow(AnswerModeError);
  });

  it('refuses a self grade on anything but a card', () => {
    const mcq: DrillItem = {
      ...concept,
      payload: {
        kind: 'mcq',
        stem: 'Which?',
        options: [
          { ref: 'a', text: 'A' },
          { ref: 'b', text: 'B' },
        ],
        correct: ['a'],
        explanation: 'Because.',
        categories: ['x'],
      },
    };
    expect(() => checkAnswerMode('self', mcq, { self: 'got', override: false })).toThrow(AnswerModeError);
  });

  it('leaves a typed answer alone on either kind of pack', () => {
    expect(() => checkAnswerMode('typed', word, { override: true })).not.toThrow();
    expect(() => checkAnswerMode('self', concept, { override: false })).not.toThrow();
  });
});

describe('grading a self-graded card', () => {
  it('counts "got it" as correct and records that the learner graded it', () => {
    const result = grade({ item: concept, stage: 1, given: '', self: 'got' }, initialProgress());
    expect(result).toMatchObject({ correct: true, overridden: false, selfGraded: true });
    expect(result.progress.streak).toBe(1);
  });

  it('counts "missed it" as wrong, and a miss resets the streak like any other', () => {
    const once = grade({ item: concept, stage: 1, given: '', self: 'got' }, initialProgress()).progress;
    const result = grade({ item: concept, stage: 1, given: '', self: 'missed' }, once);
    expect(result.correct).toBe(false);
    expect(result.progress.streak).toBe(0);
  });

  it('moves exactly the streak machine a typed answer moves', () => {
    let selfGraded = initialProgress();
    let machine = initialProgress();
    for (const verdict of ['got', 'missed', 'got', 'got', 'got', 'got'] as const) {
      selfGraded = grade({ item: concept, stage: selfGraded.stage, given: '', self: verdict }, selfGraded).progress;
      machine = applyAttempt(machine, verdict === 'got', 2);
    }
    expect(selfGraded).toEqual(machine);
    expect(selfGraded.mastered).toBe(true);
  });

  it('hands back the whole card once graded', () => {
    const result = grade({ item: concept, stage: 1, given: '', self: 'got' }, initialProgress());
    expect(result.expected).toBe('Matching two widget lists on a shared key.');
    expect(result.details?.code).toContain('JOIN');
  });

  it('marks a typed answer as not self-graded', () => {
    const result = grade({ item: word, stage: 1, given: 'the lead time' }, initialProgress());
    expect(result.selfGraded).toBe(false);
  });
});

describe('the prompt of a concept card', () => {
  it('carries the section label and the cue, never the answer', () => {
    const prompt = promptFor(concept, 1);
    expect(prompt).toMatchObject({ kind: 'term', prompt: 'Widget join', group: 'Basics' });
    expect(JSON.stringify(prompt)).not.toContain('Matching two widget lists');
    expect(JSON.stringify(prompt)).not.toContain('SELECT');
  });

  it('prefers the authored cue over the example as the hint', () => {
    expect((promptFor(concept, 1) as { hint?: string }).hint).toBe('Think of a widget join as a zipper.');
  });

  it('masks the answer inside the cue at stage 2', () => {
    const hint = (promptFor(concept, 2) as { hint?: string }).hint ?? '';
    expect(hint).not.toMatch(/widget join/i);
    expect(hint).toContain('…');
  });

  it('masks the answer inside the cue at stage 1 as well, where the answer is the meaning', () => {
    const giveaway: DrillItem = {
      ...concept,
      payload: {
        ...concept.payload,
        hint: 'It is: Matching two widget lists on a shared key.',
      } as DrillItem['payload'],
    };
    expect((promptFor(giveaway, 1) as { hint?: string }).hint).not.toContain('Matching two widget lists');
  });

  it('still falls back to the example, masked at stage 2 exactly as before', () => {
    expect((promptFor(word, 1) as { hint?: string }).hint).toBe('De doorlooptijd is kort.');
    expect((promptFor(word, 2) as { hint?: string }).hint).toBe('… is kort.');
  });
});

describe('revealing a card', () => {
  it('returns the answer side for the stage asked, and no progress — there is nothing to persist', () => {
    const face = revealCard(concept, 1);
    expect(face).toMatchObject({
      expected: 'Matching two widget lists on a shared key.',
      group: 'Basics',
      details: { analogy: 'Like a SQL inner join, but for widgets.', source: 'Widgets guide · Joining' },
    });
    expect(face).not.toHaveProperty('progress');
  });

  it('answers with the term at stage 2', () => {
    expect(revealCard(concept, 2).expected).toBe('Widget join');
  });

  it('refuses anything that is not a card', () => {
    const order: DrillItem = {
      ...concept,
      payload: { kind: 'word-order', sentence: 'a b.', parts: ['a', 'b'], translation: 'a b' },
    };
    expect(() => revealCard(order, 1)).toThrow(AnswerModeError);
  });
});

describe('learn mode', () => {
  it('shows the prompt and the whole answer side at once, unmasked', () => {
    const card = learnCard(concept, 2);
    expect(card.prompt).toMatchObject({ prompt: 'Matching two widget lists on a shared key.' });
    expect(card.card.expected).toBe('Widget join');
    expect(card.card.hint).toBe('Think of a widget join as a zipper.');
    expect(card.card.example).toContain('widget join');
  });

  it('records nothing: it carries no progress of its own to write', () => {
    expect(learnCard(concept, 1)).not.toHaveProperty('progress');
  });
});
