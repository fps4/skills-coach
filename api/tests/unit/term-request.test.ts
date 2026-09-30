/**
 * Word requests — a learner asks, a coach suggests, the learner decides (ADR-0023).
 *
 * Pinned here: the order things can happen in, and that what reaches the deck is what the learner
 * accepted — the suggestion as they edited it, minus what they left out — never the suggestion alone.
 */

import { describe, expect, it } from 'vitest';
import {
  acceptedTerm,
  MAX_REQUESTED_TERMS,
  nextStatus,
  requestedTerms,
  TermRequestTransitionError,
  type TermSuggestion,
} from '../../src/domain/term-request.js';

const SUGGESTION: TermSuggestion = {
  translation: 'to disappear',
  example: 'De kat verdween achter het huis.',
  details: {
    partOfSpeech: 'verb — strong',
    forms: [
      { label: 'past', value: 'verdween, verdwenen' },
      { label: 'perfect', value: 'is verdwenen' },
    ],
    exampleTranslation: 'The cat disappeared behind the house.',
    synonyms: ['wegraken'],
    antonyms: ['verschijnen'],
    note: 'Perfect tense takes zijn.',
  },
};

describe('requestedTerms', () => {
  it('trims, collapses spaces and drops blank lines — what a pasted list looks like', () => {
    expect(requestedTerms(['  verdwijnen ', '', 'de   gewoonte', '\t'])).toEqual(['verdwijnen', 'de gewoonte']);
  });

  it('asks for a word once, however it was capitalised', () => {
    expect(requestedTerms(['Ondanks', 'ondanks', 'ONDANKS'])).toEqual(['Ondanks']);
  });

  it('stops at the limit rather than refusing the whole list', () => {
    const many = Array.from({ length: MAX_REQUESTED_TERMS + 5 }, (_, index) => `woord${index}`);
    expect(requestedTerms(many)).toHaveLength(MAX_REQUESTED_TERMS);
  });
});

describe('nextStatus', () => {
  it('moves a request through its life: asked, suggested, added', () => {
    expect(nextStatus('requested', 'suggest')).toBe('suggested');
    expect(nextStatus('suggested', 'accept')).toBe('added');
  });

  it('lets the learner ask again, or throw it away, at any point before it is added', () => {
    expect(nextStatus('suggested', 'retry')).toBe('requested');
    expect(nextStatus('discarded', 'retry')).toBe('requested');
    expect(nextStatus('requested', 'discard')).toBe('discarded');
    expect(nextStatus('suggested', 'discard')).toBe('discarded');
  });

  it('lets a coach replace a suggestion nobody has acted on yet', () => {
    expect(nextStatus('suggested', 'suggest')).toBe('suggested');
  });

  it('never accepts what has not been suggested — the learner decides on something, not on nothing', () => {
    expect(() => nextStatus('requested', 'accept')).toThrow(TermRequestTransitionError);
  });

  it('is finished once added: the word is in the deck and is edited there', () => {
    for (const action of ['suggest', 'accept', 'retry', 'discard'] as const) {
      expect(() => nextStatus('added', action)).toThrow(TermRequestTransitionError);
    }
  });

  it('does not take a suggestion for a request the learner threw away', () => {
    expect(() => nextStatus('discarded', 'suggest')).toThrow(TermRequestTransitionError);
  });
});

describe('acceptedTerm', () => {
  it('takes the suggestion whole when the learner changes nothing', () => {
    expect(acceptedTerm('verdwijnen', SUGGESTION)).toEqual({
      term: 'verdwijnen',
      translation: 'to disappear',
      example: 'De kat verdween achter het huis.',
      details: SUGGESTION.details,
    });
  });

  it('lets the learner’s edits win, field by field', () => {
    const accepted = acceptedTerm('verdwijnen', SUGGESTION, {
      translation: 'to vanish',
      details: { note: 'Like "verdwijnen" in a magic trick.' },
    });

    expect(accepted.translation).toBe('to vanish');
    expect(accepted.details?.note).toBe('Like "verdwijnen" in a magic trick.');
    expect(accepted.details?.synonyms).toEqual(['wegraken']);
  });

  it('leaves out what the learner unticked', () => {
    const accepted = acceptedTerm('verdwijnen', SUGGESTION, {}, ['antonyms', 'example', 'note']);

    expect(accepted.example).toBeUndefined();
    expect(accepted.details?.antonyms).toBeUndefined();
    expect(accepted.details?.note).toBeUndefined();
    expect(accepted.details?.forms).toHaveLength(2);
  });

  it('drops the example’s translation with the example — one without the other means nothing', () => {
    expect(acceptedTerm('verdwijnen', SUGGESTION, {}, ['example']).details?.exampleTranslation).toBeUndefined();
  });

  it('carries no empty field, and no details at all when nothing is left', () => {
    const accepted = acceptedTerm(
      'ondanks',
      { translation: 'despite', details: { synonyms: [], note: '  ', forms: [] } },
      { details: { partOfSpeech: '' } },
    );

    expect(accepted).toEqual({ term: 'ondanks', translation: 'despite' });
  });

  it('never lets the translation be taken away — it is the side that gets practised', () => {
    expect(() => acceptedTerm('ondanks', SUGGESTION, { translation: '   ' })).toThrow();
  });
});
