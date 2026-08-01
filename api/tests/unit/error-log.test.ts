/**
 * Error-log rules — the arithmetic the runtime owns so that adaptation stays deterministic even
 * though its input is a model's judgement (ADR-0001).
 *
 * Categories here are invented; a pack declares its own.
 */

import { describe, expect, it } from 'vitest';
import {
  applyOccurrences,
  closeBlock,
  deriveStatus,
  redrillCategories,
  retireCategories,
  tallyCategories,
  topRecurring,
} from '../../src/domain/error-log.js';
import type { ErrorLogEntry } from '../../src/domain/types.js';

const AT = new Date('2026-08-01T10:00:00Z');
const context = { learnerId: 'learner-1', packId: 'pack-1', blockOrder: 1, now: AT };

function occurrence(n = 1) {
  return Array.from({ length: n }, (_, i) => ({ wrong: `wrong-${i}`, right: `right-${i}` }));
}

/** Build an entry by feeding it `count` occurrences, then closing `cleanBlocks` empty blocks. */
function entryWith(category: string, count: number, cleanBlocks = 0): ErrorLogEntry {
  let entry = applyOccurrences(undefined, category, occurrence(count), context);
  for (let i = 1; i <= cleanBlocks; i += 1) {
    entry = closeBlock([entry], context.blockOrder + i)[0] as ErrorLogEntry;
  }
  return entry;
}

describe('deriveStatus', () => {
  it('calls a category new below the recurring threshold', () => {
    expect(deriveStatus(1, 0)).toBe('new');
    expect(deriveStatus(2, 0)).toBe('new');
  });

  it('calls it recurring at three occurrences', () => {
    expect(deriveStatus(3, 0)).toBe('recurring');
  });

  it('calls it improving after one clean block', () => {
    expect(deriveStatus(5, 1)).toBe('improving');
  });

  it('calls it mastered after two clean blocks', () => {
    expect(deriveStatus(5, 2)).toBe('mastered');
  });

  it('lets recency beat volume — a much-repeated but long-absent mistake is mastered', () => {
    expect(deriveStatus(50, 2)).toBe('mastered');
  });
});

describe('applyOccurrences', () => {
  it('creates an entry on first sighting', () => {
    const entry = applyOccurrences(undefined, 'word-order', occurrence(1), context);
    expect(entry).toMatchObject({ category: 'word-order', count: 1, status: 'new', cleanBlocks: 0 });
    expect(entry.firstSeen).toEqual(AT);
  });

  it('accumulates the count across sightings', () => {
    const first = applyOccurrences(undefined, 'word-order', occurrence(2), context);
    const second = applyOccurrences(first, 'word-order', occurrence(2), context);
    expect(second.count).toBe(4);
    expect(second.status).toBe('recurring');
  });

  it('preserves when the category was first seen', () => {
    const later = new Date('2026-09-01T10:00:00Z');
    const first = applyOccurrences(undefined, 'spelling', occurrence(1), context);
    const second = applyOccurrences(first, 'spelling', occurrence(1), { ...context, now: later });
    expect(second.firstSeen).toEqual(AT);
    expect(second.lastSeen).toEqual(later);
  });

  it('keeps only the most recent examples', () => {
    const entry = applyOccurrences(undefined, 'spelling', occurrence(20), context);
    expect(entry.examples.length).toBe(8);
    expect(entry.examples.at(-1)?.wrong).toBe('wrong-19');
  });

  it('resets the clean-block run, so a mastered category reappearing goes straight back to active', () => {
    const mastered = entryWith('articles', 4, 2);
    expect(mastered.status).toBe('mastered');

    const recurred = applyOccurrences(mastered, 'articles', occurrence(1), { ...context, blockOrder: 4 });
    expect(recurred.cleanBlocks).toBe(0);
    expect(recurred.status).toBe('recurring');
  });
});

describe('closeBlock', () => {
  it('gives a clean block to a category that did not appear in it', () => {
    const entry = entryWith('articles', 3);
    const [after] = closeBlock([entry], 2);
    expect(after?.cleanBlocks).toBe(1);
    expect(after?.status).toBe('improving');
  });

  it('gives nothing to a category that did appear in the block being closed', () => {
    const entry = entryWith('articles', 3);
    const [after] = closeBlock([entry], 1);
    expect(after?.cleanBlocks).toBe(0);
    expect(after?.status).toBe('recurring');
  });

  it('masters a category after two consecutive clean blocks', () => {
    let entries = [entryWith('articles', 3)];
    entries = closeBlock(entries, 2);
    entries = closeBlock(entries, 3);
    expect(entries[0]?.status).toBe('mastered');
  });

  it('is idempotent for a block already closed', () => {
    const entry = entryWith('articles', 3);
    const once = closeBlock([entry], 2);
    const twice = closeBlock(once, 2);
    expect(twice[0]?.cleanBlocks).toBe(1);
  });
});

describe('briefing lists', () => {
  const entries = [
    entryWith('word-order', 5),
    entryWith('spelling', 3),
    entryWith('articles', 4, 2),
    entryWith('er', 1),
  ];

  it('re-drills what is still recurring, worst first', () => {
    expect(redrillCategories(entries)).toEqual(['word-order', 'spelling']);
  });

  it('retires what has gone quiet', () => {
    expect(retireCategories(entries)).toEqual(['articles']);
  });

  it('leaves a one-off out of both lists', () => {
    expect(redrillCategories(entries)).not.toContain('er');
    expect(retireCategories(entries)).not.toContain('er');
  });

  it('ranks the top recurring categories for the next block focus', () => {
    expect(topRecurring(entries, 2).map((entry) => entry.category)).toEqual(['word-order', 'spelling']);
  });

  it('breaks count ties by name so the order is stable', () => {
    const tied = [entryWith('beta', 3), entryWith('alpha', 3)];
    expect(redrillCategories(tied)).toEqual(['alpha', 'beta']);
  });
});

describe('tallyCategories', () => {
  it('folds per-item categories into occurrence counts', () => {
    const tally = tallyCategories([
      { categories: ['word-order', 'spelling'] },
      { categories: ['spelling'] },
      { categories: [] },
    ]);
    expect(tally).toEqual({ 'word-order': 1, spelling: 2 });
  });
});
