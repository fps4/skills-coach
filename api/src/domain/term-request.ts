/**
 * Word requests: a learner names a word, a coach fills it in, the learner decides (ADR-0023).
 *
 * The runtime generates nothing (ADR-0001). What it can do is hold the question — "what should the
 * card for *verdwijnen* say?" — until a coach answers it through `/coach/v1`, and then hold the answer
 * until the learner has looked at it. These are the rules for that: which order things may happen in,
 * and how what the learner accepted is assembled from what was suggested.
 *
 * Nothing a coach suggests reaches a deck on its own. Accepting is the learner's act, and what they
 * accept is the suggestion *as they edited it*, minus whatever they left out.
 */

/** One inflected or related form, labelled in whatever terms the language uses — "past", "plural". */
export interface TermForm {
  label: string;
  value: string;
}

/**
 * What a card can carry beyond the pair that gets practised.
 *
 * Language-neutral on purpose: a Dutch verb's past tense and an English noun's plural are both just
 * labelled forms, so nothing here knows which language it is holding (ADR-0004). Shown after an
 * answer and on the word list; never graded — only `term` and `translation` are.
 */
export interface TermDetails {
  partOfSpeech?: string;
  forms?: TermForm[];
  /** The translation of the card's `example`, which lives beside `term` because it predates these. */
  exampleTranslation?: string;
  synonyms?: string[];
  antonyms?: string[];
  note?: string;
}

/** What a coach proposes for a requested word. */
export interface TermSuggestion {
  translation: string;
  example?: string;
  details?: TermDetails;
}

/** A field the learner can leave off the card. The translation is not one: it is what is practised. */
export type OptionalTermField = 'example' | keyof TermDetails;

export const OPTIONAL_TERM_FIELDS: readonly OptionalTermField[] = [
  'example',
  'exampleTranslation',
  'partOfSpeech',
  'forms',
  'synonyms',
  'antonyms',
  'note',
];

export type TermRequestStatus = 'requested' | 'suggested' | 'added' | 'discarded';
export type TermRequestAction = 'suggest' | 'accept' | 'retry' | 'discard';

export class TermRequestTransitionError extends Error {
  constructor(
    readonly from: TermRequestStatus,
    readonly action: TermRequestAction,
  ) {
    super(`cannot ${action} a request that is ${from}`);
  }
}

const TRANSITIONS: Record<TermRequestStatus, Partial<Record<TermRequestAction, TermRequestStatus>>> = {
  requested: { suggest: 'suggested', discard: 'discarded' },
  // A coach may replace a suggestion nobody has acted on — a better one, or a correction.
  suggested: { suggest: 'suggested', accept: 'added', retry: 'requested', discard: 'discarded' },
  // Once in the deck, the word is edited there; the request is history.
  added: {},
  discarded: { retry: 'requested' },
};

export function nextStatus(from: TermRequestStatus, action: TermRequestAction): TermRequestStatus {
  const to = TRANSITIONS[from][action];
  if (!to) throw new TermRequestTransitionError(from, action);
  return to;
}

export const MAX_REQUESTED_TERMS = 50;
export const MAX_TERM_LENGTH = 120;

/**
 * The words in a request, as a learner typed or pasted them: trimmed, spaces collapsed, blanks
 * dropped, each word once however it was capitalised, and no more than the limit — a long paste is
 * cut rather than refused, because refusing it loses the whole list.
 */
export function requestedTerms(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of input) {
    const term = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_LENGTH);
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_REQUESTED_TERMS) break;
  }
  return terms;
}

/** The card a learner accepted, ready to become one of their own words. */
export interface AcceptedTerm {
  term: string;
  translation: string;
  example?: string;
  details?: TermDetails;
}

/**
 * Assemble what the learner accepted: the suggestion, with their edits laid over it field by field,
 * and without the fields they left out.
 *
 * Empty values are dropped rather than stored, so "the coach suggested no antonyms" and "the learner
 * cleared the antonyms" read the same way downstream. The example's translation goes with the
 * example: a translation of a sentence that is not on the card means nothing.
 */
export function acceptedTerm(
  term: string,
  suggestion: TermSuggestion,
  edits: Partial<TermSuggestion> = {},
  omit: readonly OptionalTermField[] = [],
): AcceptedTerm {
  const translation = (edits.translation ?? suggestion.translation).trim();
  if (!translation) throw new Error('a word needs a translation — it is the side that gets practised');

  const left = new Set(omit);
  if (left.has('example')) left.add('exampleTranslation');

  const example = left.has('example') ? undefined : clean(edits.example ?? suggestion.example);
  const merged: TermDetails = { ...suggestion.details, ...edits.details };
  const details: TermDetails = {};
  for (const field of OPTIONAL_TERM_FIELDS) {
    if (field === 'example' || left.has(field)) continue;
    const value = cleanDetail(merged[field]);
    if (value !== undefined) (details as Record<string, unknown>)[field] = value;
  }

  return {
    term,
    translation,
    ...(example ? { example } : {}),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanDetail(value: TermDetails[keyof TermDetails]): TermDetails[keyof TermDetails] {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return clean(value);
  if (value.length === 0) return undefined;
  if (typeof value[0] === 'string') {
    const strings = (value as string[]).map((entry) => entry.trim()).filter(Boolean);
    return strings.length > 0 ? strings : undefined;
  }
  const forms = (value as TermForm[])
    .map((form) => ({ label: form.label.trim(), value: form.value.trim() }))
    .filter((form) => form.value);
  return forms.length > 0 ? forms : undefined;
}
