/**
 * Tolerant matching. Each test names the rule it pins.
 *
 * Test data here is invented — no content from any real pack (ADR-0006). The shapes are the ones the
 * format produces: "a / b" alternatives, "(parenthetical)" hints, English infinitives.
 */

import { describe, expect, it } from 'vitest';
import { acceptedForms, matches, normalize, splitAlternatives, stripLeadingWords } from '../../src/domain/matching.js';

describe('normalize', () => {
  it('ignores case, surrounding whitespace and edge punctuation', () => {
    expect(normalize('  Ingewikkeld.  ')).toBe('ingewikkeld');
    expect(normalize('"tevreden"')).toBe('tevreden');
  });

  it('collapses interior whitespace but keeps interior punctuation', () => {
    expect(normalize('erop   neerkomen  dat')).toBe('erop neerkomen dat');
    expect(normalize("'s ochtends")).toBe('s ochtends');
  });

  it('keeps diacritics significant — dropping an accent is the mistake being drilled', () => {
    expect(normalize('potentiële')).not.toBe(normalize('potentiele'));
  });
});

describe('stripLeadingWords', () => {
  it('drops a single leading article', () => {
    expect(stripLeadingWords('de doorlooptijd', ['de', 'het'])).toBe('doorlooptijd');
  });

  it('leaves a word alone when the article is all there is', () => {
    expect(stripLeadingWords('de', ['de'])).toBe('de');
  });

  it('drops only the first word, not every occurrence', () => {
    expect(stripLeadingWords('het het huis', ['het'])).toBe('het huis');
  });
});

describe('splitAlternatives', () => {
  it('splits on a spaced slash, the notation the source format uses', () => {
    expect(splitAlternatives('by now / meanwhile')).toEqual(['by now', 'meanwhile']);
  });

  it('does not split an unspaced slash', () => {
    expect(splitAlternatives('and/or')).toEqual(['and/or']);
  });

  it('splits a comma or a semicolon — a hand-typed list of meanings', () => {
    expect(splitAlternatives('by now, meanwhile')).toEqual(['by now', 'meanwhile']);
    expect(splitAlternatives('by now; meanwhile')).toEqual(['by now', 'meanwhile']);
    expect(splitAlternatives('by now, meanwhile / in the meantime')).toEqual([
      'by now',
      'meanwhile',
      'in the meantime',
    ]);
  });

  it('does not split inside a parenthetical — that comma qualifies, it does not separate', () => {
    expect(splitAlternatives('to move (house, home) to')).toEqual(['to move (house, home) to']);
  });
});

describe('matches', () => {
  it('accepts the exact answer', () => {
    expect(matches('ingewikkeld', 'ingewikkeld')).toBe(true);
  });

  it('accepts either side of a synonym pair', () => {
    expect(matches('meanwhile', 'by now / meanwhile')).toBe(true);
    expect(matches('by now', 'by now / meanwhile')).toBe(true);
  });

  it('accepts any one meaning of a comma-separated key', () => {
    expect(matches('to discuss', 'to discuss, to talk about')).toBe(true);
    expect(matches('to talk about', 'to discuss, to talk about')).toBe(true);
    expect(matches('to finish', 'to finish; to complete')).toBe(true);
  });

  it('accepts a key with three meanings from any one of them', () => {
    const key = 'lately / recently, of late';
    expect(matches('lately', key)).toBe(true);
    expect(matches('recently', key)).toBe(true);
    expect(matches('of late', key)).toBe(true);
  });

  it('accepts the whole list too, whichever separator the learner used', () => {
    expect(matches('by now / meanwhile', 'by now / meanwhile')).toBe(true);
    expect(matches('by now, meanwhile', 'by now / meanwhile')).toBe(true);
    expect(matches('meanwhile, by now', 'by now / meanwhile')).toBe(true);
  });

  it('rejects a list containing a meaning the key does not have', () => {
    expect(matches('by now, tomorrow', 'by now / meanwhile')).toBe(false);
  });

  it('still rejects a wrong answer when the key lists several meanings', () => {
    expect(matches('tevreden', 'to discuss, to talk about')).toBe(false);
  });

  it('treats a parenthetical as optional in either direction', () => {
    expect(matches('to move', 'to move (house)')).toBe(true);
    expect(matches('to move (house)', 'to move (house)')).toBe(true);
  });

  it('accepts an English infinitive with or without "to"', () => {
    expect(matches('send', 'to send')).toBe(true);
    expect(matches('to send', 'to send')).toBe(true);
  });

  it('accepts a noun with or without its article', () => {
    expect(matches('doorlooptijd', 'de doorlooptijd')).toBe(true);
    expect(matches('de doorlooptijd', 'doorlooptijd')).toBe(true);
    expect(matches('lead time', 'the lead time')).toBe(true);
  });

  it('rejects a misspelling — shape is forgiven, spelling is not', () => {
    expect(matches('ingewikkelt', 'ingewikkeld')).toBe(false);
    expect(matches('potentiele', 'potentiële')).toBe(false);
  });

  it('rejects a different word', () => {
    expect(matches('tevreden', 'ingewikkeld')).toBe(false);
  });

  it('rejects an empty answer', () => {
    expect(matches('', 'ingewikkeld')).toBe(false);
    expect(matches('   ', 'ingewikkeld')).toBe(false);
  });

  it('rejects a partial answer', () => {
    expect(matches('erop', 'erop neerkomen dat')).toBe(false);
  });
});

describe('acceptedForms', () => {
  it('reports every form it would have taken, so the surface can show them', () => {
    const forms = acceptedForms('to switch (to)');
    expect(forms).toContain('to switch');
    expect(forms).toContain('switch');
    expect(forms).toContain('to switch (to)');
  });

  it('never contains an empty string', () => {
    expect(acceptedForms('de')).not.toContain('');
  });
});
