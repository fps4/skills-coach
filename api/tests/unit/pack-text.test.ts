/**
 * A skill is written in one language (ADR-0026).
 *
 * Its titles and labels are single strings now, but packs, blocks and lessons published before the
 * decision are still stored with `{ nl, en }` objects. These pin how such a value is read: one
 * string, chosen the same way everywhere, so no surface ever renders `[object Object]`.
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeBlockText,
  normalizeLessonText,
  normalizePackText,
  singleLanguageText,
} from '../../src/domain/pack-text.js';

describe('singleLanguageText', () => {
  it('passes a string through untouched — that is the shape now', () => {
    expect(singleLanguageText('Woordtrainer', 'nl')).toBe('Woordtrainer');
  });

  it('prefers English from a legacy per-language object — the interface is English', () => {
    expect(singleLanguageText({ nl: 'Woordenlijst', en: 'Word list' }, 'nl')).toBe('Word list');
  });

  it('falls back to the content language when there is no English', () => {
    expect(singleLanguageText({ de: 'Wortliste', nl: 'Woordenlijst' }, 'nl')).toBe('Woordenlijst');
  });

  it('falls back to the first value when neither is there', () => {
    expect(singleLanguageText({ de: 'Wortliste', fr: 'Liste' }, 'nl')).toBe('Wortliste');
  });

  it('skips empty values rather than choosing a blank', () => {
    expect(singleLanguageText({ en: '', nl: 'Woordenlijst' }, 'nl')).toBe('Woordenlijst');
  });

  it('has nothing to give for nothing', () => {
    expect(singleLanguageText(undefined, 'nl')).toBeUndefined();
    expect(singleLanguageText({}, 'nl')).toBeUndefined();
    expect(singleLanguageText(42, 'nl')).toBeUndefined();
  });

  it('works without a content language, as a block read on its own is', () => {
    expect(singleLanguageText({ nl: 'Blok één' })).toBe('Blok één');
  });
});

describe('normalizePackText', () => {
  const legacy = {
    packId: 'demo',
    title: { nl: 'Demo gesprek', en: 'Demo conversation' },
    description: { nl: 'Een demo.' },
    goal: { en: 'Hold a conversation.' },
    contentLanguage: 'nl',
    presentation: { palette: 'blue', tagline: { nl: 'Praat mee', en: 'Join in' } },
    errorCategories: [
      { id: 'word-order', label: { nl: 'Woordvolgorde', en: 'Word order' }, group: { en: 'Grammar' } },
      { id: 'spelling' },
    ],
  };

  it('turns every per-language field of a stored pack into one string', () => {
    const pack = normalizePackText(legacy);
    expect(pack.title).toBe('Demo conversation');
    expect(pack.description).toBe('Een demo.');
    expect(pack.goal).toBe('Hold a conversation.');
    expect(pack.presentation?.tagline).toBe('Join in');
    expect(pack.presentation?.palette).toBe('blue');
    expect(pack.errorCategories).toEqual([
      { id: 'word-order', label: 'Word order', group: 'Grammar' },
      { id: 'spelling' },
    ]);
  });

  it('leaves a pack already in the new shape exactly as it was', () => {
    const current = {
      packId: 'demo',
      title: 'Woordtrainer',
      contentLanguage: 'nl',
      errorCategories: [{ id: 'x', label: 'X' }],
    };
    expect(normalizePackText(current)).toEqual(current);
  });

  it('does not invent fields the pack never had', () => {
    const pack = normalizePackText({ packId: 'demo', title: 'T', contentLanguage: 'nl', errorCategories: [] });
    expect(Object.keys(pack)).not.toContain('description');
    expect(Object.keys(pack)).not.toContain('goal');
    expect(Object.keys(pack)).not.toContain('presentation');
  });

  it('falls back to the pack id for a title that has nothing in it', () => {
    expect(normalizePackText({ packId: 'demo', title: {}, contentLanguage: 'nl', errorCategories: [] }).title).toBe(
      'demo',
    );
  });
});

describe('block and lesson titles', () => {
  it('reads a legacy block title as one string', () => {
    expect(normalizeBlockText({ slug: 'start', title: { nl: 'Begin', en: 'Start' } }).title).toBe('Start');
  });

  it('falls back to the slug for a block title that has nothing in it', () => {
    expect(normalizeBlockText({ slug: 'start', title: {} }).title).toBe('start');
  });

  it('reads a legacy lesson title as one string', () => {
    expect(normalizeLessonText({ order: 2, title: { nl: 'Les twee' } }).title).toBe('Les twee');
  });
});
