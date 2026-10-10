import { describe, expect, it } from 'vitest';
import { withoutRetiredLocale } from './legacy-locale';

describe('withoutRetiredLocale', () => {
  it('strips the locale a bookmarked URL still carries', () => {
    expect(withoutRetiredLocale('/nl/drills/words')).toBe('/drills/words');
    expect(withoutRetiredLocale('/en/reading/demo.rab12cd34.x')).toBe('/reading/demo.rab12cd34.x');
  });

  it('sends a bare locale to the start page', () => {
    expect(withoutRetiredLocale('/nl')).toBe('/');
    expect(withoutRetiredLocale('/en/')).toBe('/');
  });

  it('leaves every other path alone', () => {
    expect(withoutRetiredLocale('/')).toBeNull();
    expect(withoutRetiredLocale('/drills/words')).toBeNull();
    expect(withoutRetiredLocale('/de/drills/words')).toBeNull();
    expect(withoutRetiredLocale('/nlx/words')).toBeNull();
  });
});
