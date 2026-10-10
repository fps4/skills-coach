/**
 * The interface dictionary (ADR-0025).
 *
 * The interface is English only, so what is left to pin is that the dictionary is whole — a blank
 * value renders as a blank label — and that no Dutch chrome survived the collapse to one language.
 */

import { describe, expect, it } from 'vitest';
import { dictionary, getDictionary } from './dictionaries';

/** Every leaf string of the dictionary, with its dotted path. */
function leaves(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

describe('the dictionary', () => {
  it('is the one the surfaces get', () => {
    expect(getDictionary()).toBe(dictionary);
  });

  it('has no empty string anywhere', () => {
    for (const [path, value] of leaves(dictionary)) expect(value.trim(), path).not.toBe('');
  });

  it('is English — no Dutch chrome left over from the second language', () => {
    // Words that only ever appeared in the Dutch dictionary. A string matching one is a leftover.
    const dutch = /\b(je|jouw|het|een|vaardigheid|lessen|opslaan|annuleren|bezig|afmelden)\b/i;
    for (const [path, value] of leaves(dictionary)) expect(value, path).not.toMatch(dutch);
  });
});
