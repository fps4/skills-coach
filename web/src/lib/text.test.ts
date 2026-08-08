import { describe, expect, it } from 'vitest';
import { readingMinutes } from './text';

describe('readingMinutes', () => {
  it('never reports less than a minute', () => {
    expect(readingMinutes('drie woorden hier')).toBe(1);
  });

  it('scales with length', () => {
    expect(readingMinutes(Array.from({ length: 600 }, () => 'woord').join(' '))).toBe(3);
  });

  it('does not count whitespace as words', () => {
    expect(readingMinutes('   \n\n  ')).toBe(1);
  });
});
