import { describe, expect, it } from 'vitest';
import { cardSchema, toSuggestion, userMessage, type QueuedTermRequest } from '../src/card.js';

// Synthetic: an invented request, not anyone's word (ADR-0006).
const request: QueuedTermRequest = {
  requestId: 'req-1',
  term: 'de fiets',
  contentLanguage: 'nl',
  translationLanguage: 'en',
  topics: [
    { id: 'getting-around', title: 'Getting around' },
    { id: 'food', title: 'Food & shopping' },
  ],
};

describe('toSuggestion', () => {
  it('passes a complete card through as the suggestion the api expects', () => {
    const suggestion = toSuggestion(
      {
        translation: 'the bicycle / the bike',
        example: 'Ik ga met de fiets naar het werk.',
        exampleTranslation: 'I cycle to work.',
        partOfSpeech: 'noun',
        forms: [
          { label: 'article', value: 'de' },
          { label: 'plural', value: 'fietsen' },
        ],
        synonyms: ['het rijwiel'],
        note: 'A very common word.',
        topic: 'getting-around',
      },
      request,
    );
    expect(suggestion).toEqual({
      translation: 'the bicycle / the bike',
      example: 'Ik ga met de fiets naar het werk.',
      group: 'getting-around',
      details: {
        partOfSpeech: 'noun',
        forms: [
          { label: 'article', value: 'de' },
          { label: 'plural', value: 'fietsen' },
        ],
        exampleTranslation: 'I cycle to work.',
        synonyms: ['het rijwiel'],
        note: 'A very common word.',
      },
    });
  });

  it('is nothing without a translation, the side that gets practised', () => {
    expect(toSuggestion({ translation: '   ', example: 'Een zin.' }, request)).toBeNull();
  });

  it('keeps a topic only when the skill declares it', () => {
    expect(toSuggestion({ translation: 'bike', topic: 'vehicles' }, request)?.group).toBeUndefined();
    expect(toSuggestion({ translation: 'bike', topic: ' food ' }, request)?.group).toBe('food');
  });

  it("drops the example's translation when there is no example", () => {
    const suggestion = toSuggestion({ translation: 'bike', exampleTranslation: 'An orphan.' }, request);
    expect(suggestion).toEqual({ translation: 'bike' });
  });

  it('drops empty fields, blank forms and repeated synonyms rather than sending them', () => {
    const suggestion = toSuggestion(
      {
        translation: ' bike ',
        partOfSpeech: ' ',
        forms: [
          { label: 'plural', value: ' ' },
          { label: '', value: 'fietsen' },
        ],
        synonyms: ['rijwiel', 'Rijwiel', ''],
        antonyms: [],
        note: '',
      },
      request,
    );
    expect(suggestion).toEqual({
      translation: 'bike',
      details: { forms: [{ label: '', value: 'fietsen' }], synonyms: ['rijwiel'] },
    });
  });

  it("clips every field to the api's limits instead of having the suggestion refused", () => {
    const long = 'x'.repeat(1_000);
    const suggestion = toSuggestion(
      {
        translation: long,
        example: long,
        exampleTranslation: long,
        note: long,
        forms: Array.from({ length: 20 }, (_, i) => ({ label: long, value: `${i}` })),
        synonyms: Array.from({ length: 20 }, (_, i) => `syn${i}`),
      },
      request,
    )!;
    expect(suggestion.translation).toHaveLength(200);
    expect(suggestion.example).toHaveLength(500);
    expect(suggestion.details?.exampleTranslation).toHaveLength(500);
    expect(suggestion.details?.note).toHaveLength(500);
    expect(suggestion.details?.forms).toHaveLength(12);
    expect(suggestion.details?.forms?.[0]?.label).toHaveLength(60);
    expect(suggestion.details?.synonyms).toHaveLength(12);
  });
});

describe('what the model is asked', () => {
  it('carries the word, its languages and the topics — and no request id', () => {
    const message = JSON.parse(userMessage(request));
    expect(message).toEqual({
      term: 'de fiets',
      contentLanguage: 'nl',
      translationLanguage: 'en',
      topics: request.topics,
    });
  });

  it('requires only the translation of a card', () => {
    expect(cardSchema.safeParse({ translation: 'bike' }).success).toBe(true);
    expect(cardSchema.safeParse({ example: 'Een zin.' }).success).toBe(false);
  });
});
