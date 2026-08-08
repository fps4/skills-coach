/**
 * Pack scoping (ADR-0009).
 *
 * Two things are pinned here. The URL→pack derivation, because it rests on the id format the api
 * mints (`${packId}.b${order}`) and a change there would silently un-scope the whole shell. And the
 * palette precedence, because "the pack colours the app, but never over a person's choice" is a rule
 * you cannot see by reading the component.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SURFACES, SURFACES, packIcon, packIdFromUrl, resolvePalette, visibleSurfaces } from './pack-scope';

const search = (query: string) => new URLSearchParams(query);

/** A rail context, with the parts a test does not care about defaulted. */
const context = (overrides: Partial<Parameters<(typeof SURFACES)['lessons']['href']>[0]> = {}) => ({
  locale: 'nl',
  currentBlockId: 'demo.b1',
  packId: 'demo',
  decks: { terms: 20, wordOrder: 20, quiz: 20 },
  reading: 0,
  ...overrides,
});

describe('packIdFromUrl', () => {
  it('reads it straight off a pack URL', () => {
    expect(packIdFromUrl('/nl/packs/dutch-conversation-nl')).toBe('dutch-conversation-nl');
  });

  it('recovers it from a block or lesson id', () => {
    expect(packIdFromUrl('/nl/blocks/dutch-conversation-nl.b3')).toBe('dutch-conversation-nl');
    expect(packIdFromUrl('/en/lessons/dutch-conversation-nl.b3.l2')).toBe('dutch-conversation-nl');
  });

  it('takes it from the drill query, which is where a drill carries its block', () => {
    expect(packIdFromUrl('/nl/drills/words', search('blockId=demo-conversation-nl.b1'))).toBe('demo-conversation-nl');
    expect(packIdFromUrl('/nl/drills/sentences', search(''))).toBeNull();
  });

  it('reads it off the reading library’s query, and off an article id', () => {
    expect(packIdFromUrl('/nl/reading', search('packId=demo-conversation-nl'))).toBe('demo-conversation-nl');
    expect(packIdFromUrl('/nl/reading/demo-conversation-nl.rab12cd34.failover')).toBe('demo-conversation-nl');
    expect(packIdFromUrl('/nl/reading', search(''))).toBeNull();
  });

  it('returns null where the URL names no pack — those surfaces stay generic', () => {
    expect(packIdFromUrl('/nl')).toBeNull();
    expect(packIdFromUrl('/nl/progress')).toBeNull();
    expect(packIdFromUrl('/nl/sessions/8f14e45f-ceea-467a-9a3f-4d2b5c9a1e77')).toBeNull();
  });

  it('refuses to guess from an id it did not mint', () => {
    // No dot: not `${packId}.b${order}`, so there is no pack to read out of it.
    expect(packIdFromUrl('/nl/blocks/whatever')).toBeNull();
  });

  it('works without a locale segment, as the middleware sees it before negotiation', () => {
    expect(packIdFromUrl('/packs/demo-conversation-nl')).toBe('demo-conversation-nl');
  });
});

describe('resolvePalette', () => {
  it('lets an explicit choice win over the pack', () => {
    expect(resolvePalette('violet', 'blue')).toBe('violet');
  });

  it('follows the pack when nothing is pinned', () => {
    expect(resolvePalette(null, 'blue')).toBe('blue');
  });

  it('falls back to the default when neither is usable', () => {
    expect(resolvePalette(null, undefined)).toBe('orange');
    expect(resolvePalette(null, 'chartreuse')).toBe('orange');
    // A stored value for a palette the app no longer ships must not strand the learner.
    expect(resolvePalette('sepia', 'blue')).toBe('blue');
  });
});

describe('surfaces', () => {
  it('offers every surface by default — a pack opts out, never in', () => {
    expect(DEFAULT_SURFACES).toEqual(['lessons', 'reading', 'drills:terms', 'drills:word-order', 'quiz', 'progress']);
    expect(Object.keys(SURFACES).sort()).toEqual([...DEFAULT_SURFACES].sort());
  });

  it('disables a drill whose deck is empty rather than hiding it', () => {
    const empty = context({ decks: { terms: 20, wordOrder: 0, quiz: 20 } });

    expect(SURFACES['drills:terms'].href(empty)).toBe('/nl/drills/words?blockId=demo.b1');
    expect(SURFACES['drills:word-order'].href(empty)).toBeNull();
    expect(SURFACES.quiz.href(empty)).toBe('/nl/quiz?blockId=demo.b1');
  });

  // A language pack has no questions and a certification pack has no word-order sentences; both
  // disable the surface they do not fill rather than hiding it.
  it('disables the quiz for a pack with no questions', () => {
    expect(SURFACES.quiz.href(context({ decks: { terms: 20, wordOrder: 20, quiz: 0 } }))).toBeNull();
  });

  it('disables everything block-scoped before the learner has a block', () => {
    const noBlock = context({ currentBlockId: null });

    expect(SURFACES.lessons.href(noBlock)).toBeNull();
    expect(SURFACES['drills:terms'].href(noBlock)).toBeNull();
    expect(SURFACES.quiz.href(noBlock)).toBeNull();
    // Progress is not block-scoped, so it stays reachable.
    expect(SURFACES.progress.href(noBlock)).toBe('/nl/progress');
  });

  // Reading belongs to a pack, not to a block (ADR-0017): it survives having no current block, and
  // is disabled by an empty library rather than by where the learner is in the program.
  it('keeps reading reachable without a block, and disables it when the library is empty', () => {
    expect(SURFACES.reading.href(context({ currentBlockId: null, reading: 4 }))).toBe('/nl/reading?packId=demo');
    expect(SURFACES.reading.href(context({ reading: 0 }))).toBeNull();
    expect(SURFACES.reading.href(context({ packId: null, reading: 4 }))).toBeNull();
  });
});

describe('visibleSurfaces', () => {
  it('shows no pack surfaces at all before a pack is chosen', () => {
    // The landing page is the product's, not any pack's. Lessons and drills belong to a pack, so
    // outside one they are absent — not greyed out, absent.
    expect(visibleSurfaces(false, undefined)).toEqual(['progress']);
  });

  it('keeps showing them absent even when the learner has packs with material', () => {
    expect(visibleSurfaces(false, ['lessons', 'drills:terms', 'drills:word-order', 'progress'])).toEqual(['progress']);
  });

  it('shows everything a pack offers once inside it', () => {
    expect(visibleSurfaces(true, undefined)).toEqual(DEFAULT_SURFACES);
  });

  it('honours a pack that opts out of one', () => {
    expect(visibleSurfaces(true, ['lessons', 'drills:terms', 'progress'])).toEqual(['lessons', 'drills:terms', 'progress']);
  });

  it('renders in the platform’s order, not the order the pack listed them', () => {
    expect(visibleSurfaces(true, ['progress', 'drills:word-order', 'lessons'])).toEqual([
      'lessons',
      'drills:word-order',
      'progress',
    ]);
  });
});

describe('packIcon', () => {
  it('falls back rather than rendering nothing', () => {
    expect(packIcon('not-an-icon')).toBe(packIcon(undefined));
    expect(packIcon('message-circle')).not.toBe(packIcon(undefined));
  });
});
