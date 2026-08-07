/**
 * Grading one drill attempt: what to ask, what counts as right, and what the learner is told.
 *
 * Grading lives on the server on purpose. The browser trainers this replaces had to ship the answer
 * to the page in order to check it; here the surface sends what the learner built and receives a
 * verdict, so the answer is never in the page before the learner has committed to one.
 *
 * Pure: no I/O. Persisting the resulting progress is a service's job.
 */

import { applyAttempt, type DrillProgress, type StageCount } from './drill-progress.js';
import { acceptedForms, matches, type MatchOptions } from './matching.js';
import { checkMcq, isMultipleResponse, optionsText, requiredCount, shuffleOptions } from './mcq.js';
import { checkOrder, leadCueForStage, partsForStage, renderOrder, shuffleParts, stageCount } from './word-order.js';
import type { DrillItem, McqOption, Stage } from './types.js';

/**
 * How many stages this item offers. `term` items always drill both directions.
 *
 * An `mcq` has one: there is no reverse direction to a question, and inventing one — showing the
 * answer and asking for the scenario — would drill nothing anyone needs.
 */
export function stagesFor(item: DrillItem): StageCount {
  if (item.payload.kind === 'term') return 2;
  if (item.payload.kind === 'mcq') return 1;
  return stageCount(item.payload);
}

export interface TermPrompt {
  kind: 'term';
  stage: Stage;
  /** Stage 1 asks content → translation; stage 2 the reverse, which is where spelling gets drilled. */
  prompt: string;
  /** The example sentence, with the answer masked when it would give the game away. */
  hint?: string;
}

export interface WordOrderPrompt {
  kind: 'word-order';
  stage: Stage;
  /** The meaning, in the learner's language — the trainer prompts from the translation. */
  prompt: string;
  /** The chunk bank, shuffled deterministically from `seed`. */
  bank: string[];
  /** Which chunk must lead, when the item drills two orders. */
  leadCue?: string;
  tip?: string;
}

export interface McqPrompt {
  kind: 'mcq';
  stage: Stage;
  /** The scenario. Rendered as a paragraph, not a headline — these run long. */
  prompt: string;
  /** The options, shuffled deterministically. **Without any marker of which are correct.** */
  options: McqOption[];
  /** How many to pick. The surface renders radios for one and checkboxes for more. */
  choose: number;
  multiple: boolean;
}

export type DrillPrompt = TermPrompt | WordOrderPrompt | McqPrompt;

/** Mask the answer inside its own example sentence, so the hint hints rather than tells. */
function maskTerm(example: string, term: string): string {
  const trimmed = term.trim();
  if (!trimmed) return example;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return example.replace(new RegExp(escaped, 'gi'), '…');
}

export function promptFor(item: DrillItem, stage: Stage, seed = 1): DrillPrompt {
  if (item.payload.kind === 'term') {
    const { term, translation, example } = item.payload;
    return {
      kind: 'term',
      stage,
      prompt: stage === 1 ? term : translation,
      // In the reverse round the example contains the answer, so it gets masked.
      hint: example ? (stage === 1 ? example : maskTerm(example, term)) : undefined,
    };
  }

  if (item.payload.kind === 'mcq') {
    const { stem, options } = item.payload;
    return {
      kind: 'mcq',
      stage,
      prompt: stem,
      // `correct` is deliberately absent from everything returned here: the key stays on the server
      // until the learner has committed, which is the guarantee the whole surface rests on.
      options: shuffleOptions(options, seed),
      choose: requiredCount(item.payload),
      multiple: isMultipleResponse(item.payload),
    };
  }

  const parts = partsForStage(item.payload, stage);
  return {
    kind: 'word-order',
    stage,
    prompt: item.payload.translation,
    bank: shuffleParts(parts, seed),
    leadCue: leadCueForStage(item.payload, stage),
    tip: item.payload.tip,
  };
}

export interface GradeInput {
  item: DrillItem;
  stage: Stage;
  /** Free text for a `term` item; the built chunk order for a `word-order` item. */
  given: string | string[];
  /** The learner asserted the grading was wrong. Recorded, and counts as correct. */
  override?: boolean;
  matchOptions?: MatchOptions;
}

export interface GradeResult {
  correct: boolean;
  /** True when `correct` is only true because the learner overrode a rejection. */
  overridden: boolean;
  /** The canonical right answer, revealed after grading. */
  expected: string;
  /** Every form that would have been accepted — a `term` item only. */
  acceptedAlso?: string[];
  /** Per-chunk verdict — a `word-order` item only. */
  marks?: boolean[];
  /** The learner produced the other valid order: correct Dutch, wrong round. */
  otherValidOrder?: boolean;
  /** The order not being practised, so feedback can show the pair. */
  alternative?: string;
  tip?: string;
  /** Why the right answer is right — an `mcq` item only. */
  explanation?: string;
  /** The answer key as option refs — an `mcq` item only. */
  correctRefs?: string[];
  /** Correct options not picked, and incorrect options picked. An `mcq` item only. */
  missed?: string[];
  spurious?: string[];
  /** Why each wrong option is wrong. An `mcq` item only. */
  distractors?: { ref: string; why: string }[];
  /** Where the key comes from, so a disputed answer is checkable. An `mcq` item only. */
  sourceRefs?: string[];
  progress: DrillProgress;
}

export function grade(input: GradeInput, progress: DrillProgress): GradeResult {
  const { item, stage, given, override = false } = input;

  if (item.payload.kind === 'mcq') {
    const chosen = Array.isArray(given) ? given : given.split('|').map((ref) => ref.trim());
    const check = checkMcq(item.payload, chosen);
    // No override: `override` exists because tolerant matching cannot enumerate free text, and
    // picking from a list needs no tolerance. A rejection here is never the grader's fault.
    return {
      correct: check.correct,
      overridden: false,
      expected: optionsText(item.payload, check.expected),
      explanation: item.payload.explanation,
      correctRefs: check.expected,
      missed: check.missed,
      spurious: check.spurious,
      distractors: item.payload.distractors,
      sourceRefs: item.payload.sourceRefs,
      progress: applyAttempt(progress, check.correct, stagesFor(item)),
    };
  }

  if (item.payload.kind === 'term') {
    const expected = stage === 1 ? item.payload.translation : item.payload.term;
    const answer = typeof given === 'string' ? given : given.join(' ');
    const matched = matches(answer, expected, input.matchOptions);
    const correct = matched || override;
    return {
      correct,
      overridden: !matched && override,
      expected,
      acceptedAlso: [...acceptedForms(expected, input.matchOptions)].sort(),
      progress: applyAttempt(progress, correct, stagesFor(item)),
    };
  }

  const built = Array.isArray(given) ? given : given.split('|').map((chunk) => chunk.trim());
  const check = checkOrder(built, item.payload, stage);
  const correct = check.correct || override;
  const other = stage === 2 ? item.payload.parts : check.alternative;

  return {
    correct,
    overridden: !check.correct && override,
    // The authored sentence is the truth for stage 1; stage 2 is rendered from its own chunks.
    expected: stage === 1 ? item.payload.sentence : renderOrder(check.expected),
    marks: check.marks,
    otherValidOrder: check.otherValidOrder,
    alternative: other ? renderOrder(other) : undefined,
    tip: item.payload.tip,
    progress: applyAttempt(progress, correct, stagesFor(item)),
  };
}
