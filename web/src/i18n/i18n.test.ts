/**
 * The i18n boundary (ADR-0005).
 *
 * Two things are pinned here: locale negotiation behaves, and the dictionaries stay in step. The
 * second matters more than it looks — a missing English key would render as a blank label, and a
 * Dutch string left in the English dictionary is the classic way a "translated" interface ships
 * half-translated.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, isLocale, localeFromPath, negotiateLocale, withLocale } from './config';
import { getDictionary } from './dictionaries';

describe('locale detection', () => {
  it('recognises the locales the product ships and nothing else', () => {
    expect(isLocale('nl')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('reads the locale segment of a path', () => {
    expect(localeFromPath('/nl/blocks/abc')).toBe('nl');
    expect(localeFromPath('/blocks/abc')).toBeNull();
  });
});

describe('negotiateLocale', () => {
  it('lets an explicit choice win over the browser', () => {
    expect(negotiateLocale('en', 'nl-NL,nl;q=0.9')).toBe('en');
  });

  it('falls back to the browser preference', () => {
    expect(negotiateLocale(undefined, 'en-GB,en;q=0.9')).toBe('en');
    expect(negotiateLocale(undefined, 'nl-NL,nl;q=0.9')).toBe('nl');
  });

  it('ignores a cookie that is not a locale we ship', () => {
    expect(negotiateLocale('de', 'en-GB')).toBe('en');
  });

  it('falls back to the default when nothing matches', () => {
    expect(negotiateLocale(undefined, 'de-DE,fr;q=0.8')).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
  });
});

describe('withLocale', () => {
  it('swaps the locale, keeping the rest of the path', () => {
    expect(withLocale('/nl/blocks/abc', 'en')).toBe('/en/blocks/abc');
  });

  it('adds a locale to a path that has none', () => {
    expect(withLocale('/blocks/abc', 'nl')).toBe('/nl/blocks/abc');
  });

  it('handles the root path without doubling the slash', () => {
    expect(withLocale('/', 'en')).toBe('/en');
  });
});

describe('dictionaries', () => {
  /** Walk both dictionaries in parallel, collecting the leaf paths of each. */
  function leaves(value: unknown, prefix = ''): string[] {
    if (typeof value === 'string') return [prefix];
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
    }
    return [];
  }

  it('define exactly the same keys', () => {
    const nl = leaves(getDictionary('nl')).sort();
    const en = leaves(getDictionary('en')).sort();
    expect(en).toEqual(nl);
  });

  it('are non-empty everywhere', () => {
    for (const locale of LOCALES) {
      const dictionary = getDictionary(locale);
      const values = JSON.stringify(dictionary);
      expect(values).not.toContain('""');
    }
  });

  it('actually differ — a copied dictionary is an untranslated one', () => {
    const nl = getDictionary('nl');
    const en = getDictionary('en');
    expect(en.nav.progress).not.toBe(nl.nav.progress);
    expect(en.progress.errorLog).not.toBe(nl.progress.errorLog);
    expect(en.login.submit).not.toBe(nl.login.submit);
  });

  it('shares only what genuinely is the same in both languages', () => {
    const nl = getDictionary('nl');
    const en = getDictionary('en');
    // The product name is a proper noun, and "min" is the same abbreviation in both.
    expect(en.appName).toBe(nl.appName);
    expect(en.common.minutes).toBe(nl.common.minutes);
  });
});
