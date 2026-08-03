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
