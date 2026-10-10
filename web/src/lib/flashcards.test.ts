/**
 * The flashcard keyboard and status line, as rules (ADR-0027).
 */

import { describe, expect, it } from 'vitest';

import { ariaShortcut, gradeStatus, keyAction, type KeyContext, type KeyInput } from './flashcards';
import type { DrillProgress } from './types';

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: document.body,
  ...extra,
});

const self = (phase: KeyContext['phase'], extra: Partial<KeyContext> = {}): KeyContext => ({
  mode: 'practice',
  grading: 'self',
  phase,
  ...extra,
});

const field = (readOnly = false): HTMLInputElement => {
  const input = document.createElement('input');
  input.readOnly = readOnly;
  return input;
};

describe('keyAction', () => {
  it('turns the card over on F or Space, and offers the hint on H', () => {
    expect(keyAction(press('f'), self('question'))).toBe('reveal');
    expect(keyAction(press('F'), self('question'))).toBe('reveal');
    expect(keyAction(press(' '), self('question'))).toBe('reveal');
    expect(keyAction(press('h'), self('question'))).toBe('hint');
  });

  it('takes G and M only once the card is turned over', () => {
    expect(keyAction(press('g'), self('question'))).toBeNull();
    expect(keyAction(press('g'), self('revealed'))).toBe('got');
    expect(keyAction(press('m'), self('revealed'))).toBe('missed');
  });

  it('moves on with N after a verdict and at the end of a batch', () => {
    expect(keyAction(press('n'), self('question'))).toBeNull();
    expect(keyAction(press('n'), self('graded'))).toBe('next');
    expect(keyAction(press('n'), self('batch-done'))).toBe('next');
  });

  it('switches mode with L and P, and direction with D, from anywhere', () => {
    expect(keyAction(press('l'), self('question'))).toBe('learn');
    expect(keyAction(press('p'), self('idle', { mode: 'learn' }))).toBe('practise');
    expect(keyAction(press('p'), self('question'))).toBeNull(); // already practising
    expect(keyAction(press('d'), self('idle'))).toBe('direction');
  });

  it('walks learn mode with N and B, within the batch', () => {
    const learn = self('question', { mode: 'learn', canGoBack: true, canGoForward: false });
    expect(keyAction(press('b'), learn)).toBe('back');
    expect(keyAction(press('n'), learn)).toBeNull();
    expect(keyAction(press('f'), learn)).toBeNull(); // nothing to turn over: the answer is showing
  });

  it('ignores anything with Ctrl, ⌘ or Alt — those belong to the browser', () => {
    expect(keyAction(press('f', { ctrlKey: true }), self('question'))).toBeNull();
    expect(keyAction(press('f', { metaKey: true }), self('question'))).toBeNull();
    expect(keyAction(press('h', { altKey: true }), self('question'))).toBeNull();
  });

  it('ignores letters typed into the answer box, and honours them once it is read-only', () => {
    const typed: KeyContext = { mode: 'practice', grading: 'typed', phase: 'question' };
    expect(keyAction(press('h', { target: field() }), typed)).toBeNull();
    expect(keyAction(press('h', { target: document.createElement('textarea') }), typed)).toBeNull();

    const graded: KeyContext = { ...typed, phase: 'graded', canAccept: true };
    expect(keyAction(press('n', { target: field(true) }), graded)).toBe('next');
    expect(keyAction(press('a', { target: field(true) }), graded)).toBe('accept');
  });

  it('offers accept-anyway only after a miss on a typed card', () => {
    const typed: KeyContext = { mode: 'practice', grading: 'typed', phase: 'graded' };
    expect(keyAction(press('a'), typed)).toBeNull();
    expect(keyAction(press('a'), { ...typed, canAccept: true })).toBe('accept');
  });

  it('never reveals a typed card — it is answered, not turned over', () => {
    expect(keyAction(press('f'), { mode: 'practice', grading: 'typed', phase: 'question' })).toBeNull();
  });

  it('leaves Space and Enter on a focused button to the button', () => {
    const target = document.createElement('button');
    expect(keyAction(press(' ', { target }), self('question'))).toBeNull();
    expect(keyAction(press('Enter', { target }), self('graded'))).toBeNull();
  });

  it('leaves a key the answer box already handled alone', () => {
    expect(keyAction(press('Enter', { defaultPrevented: true }), self('graded'))).toBeNull();
  });
});

describe('ariaShortcut', () => {
  it('names Space as Space', () => {
    expect(ariaShortcut('reveal')).toBe('F Space');
    expect(ariaShortcut('got')).toBe('G');
  });
});

describe('gradeStatus', () => {
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

  it('says direction 1 is cleared when the second in a row clears it', () => {
    expect(gradeStatus(progress({ streak: 1 }), progress({ stage: 2, stage1Cleared: true }), true)).toBe('cleared');
  });

  it('says the streak is back to zero on a miss', () => {
    expect(gradeStatus(progress({ streak: 1 }), progress(), false)).toBe('reset');
  });

  it('says mastered when the second direction is cleared', () => {
    const before = progress({ stage: 2, streak: 1, stage1Cleared: true });
    const after = progress({ stage: 2, streak: 2, stage1Cleared: true, stage2Cleared: true, mastered: true });
    expect(gradeStatus(before, after, true)).toBe('mastered');
  });

  it('says one more after a first right answer', () => {
    expect(gradeStatus(progress(), progress({ streak: 1 }), true)).toBe('one-more');
  });

  it('says nothing about a card that was already mastered', () => {
    expect(gradeStatus(progress({ mastered: true }), progress({ mastered: true }), false)).toBeNull();
  });
});
