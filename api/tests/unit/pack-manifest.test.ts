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
import { packManifestSchema } from '../../src/domain/schemas.js';

const base = {
  packId: 'test-pack',
  title: { en: 'Test pack' },
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
        tagline: { en: 'A tour' },
        surfaces: ['lessons', 'drills:terms'],
      },
    });

    expect(parsed.presentation).toEqual({
      palette: 'blue',
      icon: 'message-circle',
      tagline: { en: 'A tour' },
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
});
