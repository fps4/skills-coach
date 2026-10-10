/**
 * The manifest as a validation boundary.
 *
 * What is pinned here is the *asymmetry* in ADR-0009: presentation keys the viewer resolves fall
 * back when unrecognised, and the one set the runtime must be able to render does not. Getting that
 * backwards is invisible until a pack ships — a mistyped surface would silently hide a rail item,
 * and a rejected palette would fail a publish over a cosmetic.
 *
 * Fixtures are invented (ADR-0006).
 */

import { describe, expect, it } from 'vitest';
import { packManifestSchema, publishBlockSchema } from '../../src/domain/schemas.js';

const base = {
  packId: 'test-pack',
  title: 'Test pack',
  contentLanguage: 'nl',
  translationLanguage: 'en',
  skill: 'conversation',
  framework: { id: 'cefr', levels: ['B1.1'] },
  errorCategories: [{ id: 'word-order' }],
};

describe('pack manifest', () => {
  it('accepts a manifest with no presentation at all', () => {
    const parsed = packManifestSchema.parse(base);
    expect(parsed.presentation).toBeUndefined();
  });

  it('carries presentation through untouched', () => {
    const parsed = packManifestSchema.parse({
      ...base,
      presentation: {
        palette: 'blue',
        icon: 'message-circle',
        tagline: 'A tour',
        surfaces: ['lessons', 'drills:terms'],
      },
    });

    expect(parsed.presentation).toEqual({
      palette: 'blue',
      icon: 'message-circle',
      tagline: 'A tour',
      surfaces: ['lessons', 'drills:terms'],
    });
  });

  it('takes any palette or icon — those are keys the viewer resolves, and it falls back', () => {
    const parsed = packManifestSchema.parse({
      ...base,
      presentation: { palette: 'chartreuse', icon: 'not-an-icon' },
    });

    expect(parsed.presentation?.palette).toBe('chartreuse');
  });

  it('refuses a surface the runtime cannot render', () => {
    expect(() => packManifestSchema.parse({ ...base, presentation: { surfaces: ['drills:word-ordr'] } })).toThrow();
  });

  it('refuses an empty surface list — omit the key to mean "all of them"', () => {
    expect(() => packManifestSchema.parse({ ...base, presentation: { surfaces: [] } })).toThrow();
  });

  it('drops keys it does not know, so an invented field never reaches the database', () => {
    const parsed = packManifestSchema.parse({ ...base, presentation: { palette: 'blue', layout: 'wide' } });

    expect(parsed.presentation).toEqual({ palette: 'blue' });
  });
});

/**
 * The method block sits on the *other* side of the same asymmetry: it is authoring guidance, acted
 * on by whoever writes the next block and never by the runtime. So it validates like a ramp's dials
 * — shape only — and anything a pack chooses to say inside it survives to the brief unchanged.
 */
describe('pack manifest method', () => {
  it('is optional — a pack that declares no method is still valid', () => {
    expect(packManifestSchema.parse(base).method).toBeUndefined();
  });

  it('carries principles, arc, rules and sequencing through untouched', () => {
    const method = {
      principles: ['Every lesson makes the learner produce, not only read.'],
      lessonArc: ['input', 'form', 'practice', 'output'],
      rules: { newTermsPerLesson: '8–12, as chunks' },
      sequencing: { articles: 'drilled as chunks, never taught as a rule' },
    };

    expect(packManifestSchema.parse({ ...base, method }).method).toEqual(method);
  });

  it('takes any rule and any sequencing key — the author reads them, nothing parses them', () => {
    const parsed = packManifestSchema.parse({
      ...base,
      method: { rules: { somethingOnlyThisPackCaresAbout: 'yes' }, sequencing: { er: 'one function per block' } },
    });

    expect(parsed.method?.rules?.somethingOnlyThisPackCaresAbout).toBe('yes');
    expect(parsed.method?.sequencing?.er).toBe('one function per block');
  });

  it('refuses an empty principle list — omit the key rather than declaring nothing loudly', () => {
    expect(() => packManifestSchema.parse({ ...base, method: { principles: [] } })).toThrow();
  });

  it('refuses a blank principle, which would reach an author as an empty instruction', () => {
    expect(() => packManifestSchema.parse({ ...base, method: { principles: ['  '] } })).toThrow();
  });

  it('drops keys it does not know, so an invented field never reaches the database', () => {
    const parsed = packManifestSchema.parse({ ...base, method: { lessonArc: ['input'], tone: 'friendly' } });

    expect(parsed.method).toEqual({ lessonArc: ['input'] });
  });

  it('accepts a skill with no error categories — a word deck has nothing to correct (ADR-0022)', () => {
    const { errorCategories: _dropped, ...withoutCategories } = base;
    expect(packManifestSchema.parse(withoutCategories).errorCategories).toEqual([]);
  });
});

describe('publishing a block', () => {
  it('accepts a block that is only a deck, with no lessons (ADR-0022)', () => {
    const parsed = publishBlockSchema.parse({ order: 1, slug: 'word-list', title: 'Word list' });
    expect(parsed.lessons).toEqual([]);
    expect(parsed.drillItems).toEqual([]);
  });
});

/** A skill is written in one language (ADR-0026): its text fields are one string, never one per language. */
describe('a skill in one language', () => {
  it('takes its title, description, goal and labels as plain strings', () => {
    const parsed = packManifestSchema.parse({
      ...base,
      description: 'Practise Dutch words.',
      goal: 'A thousand words.',
      errorCategories: [{ id: 'word-order', label: 'Word order', group: 'Grammar' }],
    });
    expect(parsed.title).toBe('Test pack');
    expect(parsed.errorCategories[0]).toEqual({ id: 'word-order', label: 'Word order', group: 'Grammar' });
  });

  it.each([
    ['title', { title: { nl: 'Testpakket', en: 'Test pack' } }],
    ['description', { description: { en: 'Two languages' } }],
    ['goal', { goal: { nl: 'Doel' } }],
    ['a category label', { errorCategories: [{ id: 'x', label: { en: 'X' } }] }],
    ['a tagline', { presentation: { tagline: { en: 'A tour' } } }],
  ])('refuses %s given per language, and says why', (_field, change) => {
    const result = packManifestSchema.safeParse({ ...base, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/one language/);
  });

  it('refuses a block or lesson title given per language', () => {
    expect(publishBlockSchema.safeParse({ order: 1, slug: 's', title: { en: 'Start' } }).success).toBe(false);
    expect(
      publishBlockSchema.safeParse({
        order: 1,
        slug: 's',
        title: 'Start',
        lessons: [{ order: 1, title: { nl: 'Les' }, sections: [{ id: 't', kind: 'text', body: 'x' }] }],
      }).success,
    ).toBe(false);
  });
});

describe('flashcards (ADR-0027)', () => {
  it('leaves the grading mode out when the manifest says nothing — typed is the default', () => {
    expect(packManifestSchema.parse(base).flashcards).toBeUndefined();
  });

  it('takes self-grading', () => {
    expect(packManifestSchema.parse({ ...base, flashcards: { grading: 'self' } }).flashcards).toEqual({
      grading: 'self',
    });
  });

  it('defaults an empty flashcards block to typed', () => {
    expect(packManifestSchema.parse({ ...base, flashcards: {} }).flashcards).toEqual({ grading: 'typed' });
  });

  it('refuses a grading mode it cannot run', () => {
    expect(packManifestSchema.safeParse({ ...base, flashcards: { grading: 'peer' } }).success).toBe(false);
  });

  const card = {
    kind: 'term',
    term: 'Widget join',
    translation: 'Matching two widget lists on a shared key.',
    hint: 'A zipper.',
    group: 'Basics',
    details: {
      analogy: 'Like a SQL inner join.',
      code: '  left JOIN right',
      source: 'Widgets guide · Joining',
    },
  };

  const block = (drillItems: unknown[]) => ({ order: 1, slug: 'deck', title: 'Deck', drillItems });

  it('publishes a card with a cue, a section, an analogy, code and a source', () => {
    expect(publishBlockSchema.parse(block([{ payload: card }])).drillItems[0]?.payload).toEqual(card);
  });

  it('takes the same fields on a vocabulary row', () => {
    const { kind: _kind, ...row } = card;
    const parsed = publishBlockSchema.parse({
      order: 1,
      slug: 'deck',
      title: 'Deck',
      lessons: [{ order: 1, title: 'L', sections: [{ id: 'v', kind: 'vocabulary', items: [row] }] }],
    });
    const section = parsed.lessons[0]?.sections[0];
    expect(section?.kind === 'vocabulary' ? section.items[0] : null).toEqual(row);
  });

  it('refuses blank code and an oversized cue', () => {
    const blank = { ...card, details: { code: '   ' } };
    expect(publishBlockSchema.safeParse(block([{ payload: blank }])).success).toBe(false);
    const long = { ...card, hint: 'x'.repeat(301) };
    expect(publishBlockSchema.safeParse(block([{ payload: long }])).success).toBe(false);
  });
});
