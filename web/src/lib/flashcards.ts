/**
 * The flashcard surface's two pure decisions (ADR-0027): which key does what, and what to tell the
 * learner after a card is graded.
 *
 * Kept out of the component so both are tested as rules rather than through a rendered screen, and
 * so the keyboard map the buttons advertise and the one the handler obeys cannot drift apart: the
 * `<kbd>` badges and `aria-keyshortcuts` are read from `SHORTCUTS` too.
 */

import type { CardGrading, DeckMode, DrillProgress } from './types';

export type FlashcardAction =
  'reveal' | 'hint' | 'got' | 'missed' | 'next' | 'back' | 'learn' | 'practise' | 'direction' | 'accept';

/**
 * Where the learner is with the card in front of them.
 *
 * - `question` — the front is showing.
 * - `revealed` — a self-graded card has been turned over and waits for got / missed.
 * - `graded` — a verdict is on screen.
 * - `batch-done` — the batch is finished.
 * - `idle` — nothing to act on: loading, an empty deck, a locked direction.
 */
export type FlashcardPhase = 'question' | 'revealed' | 'graded' | 'batch-done' | 'idle';

export interface KeyContext {
  mode: DeckMode;
  grading: CardGrading;
  phase: FlashcardPhase;
  /** A typed verdict that went against the learner, so "accept anyway" is on offer. */
  canAccept?: boolean;
  /** Learn mode has a card before this one. */
  canGoBack?: boolean;
  /** Learn mode has a card after this one. */
  canGoForward?: boolean;
}

/** The key each action answers to — what the badges show and `aria-keyshortcuts` announces. */
export const SHORTCUTS: Record<FlashcardAction, { keys: string[]; badge: string }> = {
  reveal: { keys: ['f', ' '], badge: 'F' },
  hint: { keys: ['h'], badge: 'H' },
  got: { keys: ['g'], badge: 'G' },
  missed: { keys: ['m'], badge: 'M' },
  next: { keys: ['n'], badge: 'N' },
  back: { keys: ['b'], badge: 'B' },
  learn: { keys: ['l'], badge: 'L' },
  practise: { keys: ['p'], badge: 'P' },
  direction: { keys: ['d'], badge: 'D' },
  accept: { keys: ['a'], badge: 'A' },
};

/** `aria-keyshortcuts` wants key names, and a space is spelled `Space`. */
export function ariaShortcut(action: FlashcardAction): string {
  return SHORTCUTS[action].keys.map((key) => (key === ' ' ? 'Space' : key.toUpperCase())).join(' ');
}

/** The parts of a keyboard event the map reads. A real `KeyboardEvent` satisfies it. */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
  target: EventTarget | null;
}

/**
 * True when the key is the learner typing, not commanding.
 *
 * A read-only or disabled field is not being typed into: once a typed card has its verdict the box
 * turns read-only and keeps focus, which is exactly when N and A have to work.
 */
function typingInto(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'SELECT') return true;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
  const field = element as HTMLInputElement | HTMLTextAreaElement;
  return !field.readOnly && !field.disabled;
}

/** Space and Enter on a focused button or link already activate it; acting on them twice would skip a card. */
function activatesNatively(target: EventTarget | null, key: string): boolean {
  if (key !== ' ' && key !== 'Enter') return false;
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
}

/**
 * Which action a key press stands for, or null to leave it alone.
 *
 * Ignored outright: anything with Ctrl, ⌘ or Alt (those belong to the browser and the OS), anything
 * already handled (`defaultPrevented` — the answer box handles its own Enter), and anything typed
 * into a field. A key that means nothing in the current phase is also null, so it falls through to
 * the page rather than being swallowed.
 */
export function keyAction(event: KeyInput, context: KeyContext): FlashcardAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return null;
  if (typingInto(event.target) || activatesNatively(event.target, event.key)) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const is = (action: FlashcardAction) => SHORTCUTS[action].keys.includes(key);

  // Switching mode and direction work from anywhere on the surface.
  if (is('learn') && context.mode !== 'learn') return 'learn';
  if (is('practise') && context.mode !== 'practice') return 'practise';
  if (is('direction')) return 'direction';

  if (context.mode === 'learn') {
    if (is('next') && context.canGoForward) return 'next';
    if (is('back') && context.canGoBack) return 'back';
    return null;
  }

  switch (context.phase) {
    case 'question':
      if (is('hint')) return 'hint';
      if (context.grading === 'self' && is('reveal')) return 'reveal';
      return null;
    case 'revealed':
      if (is('got')) return 'got';
      if (is('missed')) return 'missed';
      return null;
    case 'graded':
      if (is('next') || key === 'Enter') return 'next';
      if (is('accept') && context.canAccept) return 'accept';
      return null;
    case 'batch-done':
      if (is('next') || key === 'Enter') return 'next';
      return null;
    default:
      return null;
  }
}

/** What the status line says after a card is graded. */
export type GradeStatus = 'mastered' | 'cleared' | 'reset' | 'one-more';

/**
 * Read off the progress before and after, the same facts the deck meters move on — so the line and
 * the meters cannot disagree about what just happened.
 */
export function gradeStatus(before: DrillProgress, after: DrillProgress, correct: boolean): GradeStatus | null {
  // A mastered card is inert: nothing an answer does to it is news.
  if (before.mastered) return null;
  if (after.mastered) return 'mastered';
  if (!before.stage1Cleared && after.stage1Cleared) return 'cleared';
  return correct ? 'one-more' : 'reset';
}
