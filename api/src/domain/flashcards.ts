/**
 * Flashcards: one engine, two ways of answering, and a mode that answers nothing (ADR-0027).
 *
 * A word deck and a deck of concepts from a reference guide are the same thing to the runtime — a
 * `term` card with a front and a back, two directions, the one streak machine in
 * `drill-progress.ts`. What differs is how a card is *answered*, and a pack declares that:
 *
 * - `typed` — the learner types the back; the server matches it tolerantly, and the learner may
 *   accept a rejection anyway (`override`). A word has a spelling, so this is the right test.
 * - `self` — the learner turns the card over and says whether they had it. A concept's back is a
 *   sentence nobody would reproduce verbatim, so matching it would only ever be wrong.
 *
 * Either way the answer side leaves the server only after the learner has committed to something:
 * an attempt, an explicit reveal, or asking to be shown the card in learn mode. The reveal and learn
 * mode record nothing — no attempt, no streak — which is what keeps them from being a way to farm a
 * streak, and what makes learn mode an honest exception to "the browser never sees the answer
 * first": the learner asked to see it.
 *
 * Pure: no I/O.
 */

import { promptFor, type TermPrompt } from './grading.js';
import type { TermDetails } from './term-request.js';
import type { TopicDeclaration } from './topics.js';
import type { DrillItem, PackManifest, Stage, TermCardFields, TermPayload } from './types.js';

/** How a pack's cards are answered. */
export type CardGrading = 'typed' | 'self';

export const CARD_GRADINGS: readonly CardGrading[] = ['typed', 'self'];

/** What a learner says about a card they turned over. */
export type SelfGrade = 'got' | 'missed';

/** A pack's flashcard settings, as its manifest declares them. */
export interface FlashcardSettings {
  grading?: CardGrading;
  /** The deck's declared topics, in learning order (ADR-0032). */
  topics?: TopicDeclaration[];
}

/** Typed unless the manifest says otherwise — so every pack published before this is unchanged. */
export function cardGrading(pack: Pick<PackManifest, 'flashcards'>): CardGrading {
  return pack.flashcards?.grading ?? 'typed';
}

/** An attempt answered in a way this pack or this item does not take. A `400`, never a silent accept. */
export class AnswerModeError extends Error {}

/**
 * Whether an attempt is answered in a way the pack accepts.
 *
 * A self grade is the learner's own verdict, so it is only taken where the pack has said that is
 * how its cards are answered. On a typed pack it would be a way round the spelling the deck exists
 * to drill. A typed answer is left alone on either kind of pack: it is graded on the server, so it
 * cannot claim more than it earns.
 */
export function checkAnswerMode(
  grading: CardGrading,
  item: DrillItem,
  attempt: { self?: SelfGrade; override: boolean },
): void {
  if (attempt.self === undefined) return;
  if (grading !== 'self') {
    throw new AnswerModeError('this skill’s cards are answered by typing — a self-graded attempt is not accepted');
  }
  if (item.payload.kind !== 'term') throw new AnswerModeError('only a card can be self-graded');
  if (attempt.override) {
    throw new AnswerModeError('a self-graded attempt has no verdict to override');
  }
}

/** The back of a card: everything that is only shown once the learner has committed or asked. */
export interface CardFace {
  /** The answer for the stage being practised — the meaning at stage 1, the term at stage 2. */
  expected: string;
  /** The authored cue, unmasked. */
  hint?: string;
  group?: string;
  example?: string;
  details?: TermDetails;
}

function termOf(item: DrillItem): TermPayload {
  if (item.payload.kind !== 'term') throw new AnswerModeError('only a card can be revealed');
  return item.payload;
}

/**
 * The answer side of a card, for a reveal or for learn mode.
 *
 * Returns no progress on purpose: neither caller records anything, and a function that handed one
 * back would be an invitation to persist it.
 */
export function revealCard(item: DrillItem, stage: Stage): CardFace {
  const payload = termOf(item);
  return {
    expected: stage === 1 ? payload.translation : payload.term,
    ...(payload.hint ? { hint: payload.hint } : {}),
    ...(payload.group ? { group: payload.group } : {}),
    ...(payload.example ? { example: payload.example } : {}),
    ...(payload.details ? { details: payload.details } : {}),
  };
}

/** A card in learn mode: the front as practice would ask it, and the back beside it. */
export interface LearnCard {
  prompt: TermPrompt;
  card: CardFace;
}

export function learnCard(item: DrillItem, stage: Stage): LearnCard {
  return { prompt: promptFor(item, stage) as TermPrompt, card: revealCard(item, stage) };
}

/**
 * A card's payload from its fields, in one canonical order and without empty optionals.
 *
 * Every place that writes a card — a vocabulary row, a learner's own word, an accepted word request,
 * an archive coming back in — goes through this, so a field added to `TermCardFields` cannot be
 * carried by one path and silently dropped by another, and two writes of the same card compare equal.
 */
export function termPayload(fields: { term: string; translation: string } & TermCardFields): TermPayload {
  return {
    kind: 'term',
    term: fields.term,
    translation: fields.translation,
    ...(fields.example ? { example: fields.example } : {}),
    ...(fields.hint ? { hint: fields.hint } : {}),
    ...(fields.group ? { group: fields.group } : {}),
    ...(fields.details ? { details: fields.details } : {}),
  };
}

/** The same card as plain fields — the shape an archive and a word list carry, without the kind. */
export function termFields(payload: TermPayload): { term: string; translation: string } & TermCardFields {
  const { kind: _kind, ...fields } = termPayload(payload);
  return fields;
}
