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
    expect(DEFAULT_SURFACES).toEqual(['lessons', 'drills:terms', 'drills:word-order', 'progress']);
    expect(Object.keys(SURFACES).sort()).toEqual([...DEFAULT_SURFACES].sort());
  });

  it('disables a drill whose deck is empty rather than hiding it', () => {
    const context = {
      locale: 'nl',
      currentBlockId: 'demo.b1',
      decks: { terms: 20, wordOrder: 0 },
    };

    expect(SURFACES['drills:terms'].href(context)).toBe('/nl/drills/words?blockId=demo.b1');
    expect(SURFACES['drills:word-order'].href(context)).toBeNull();
  });

  it('disables everything block-scoped before the learner has a block', () => {
    const context = { locale: 'nl', currentBlockId: null, decks: { terms: 20, wordOrder: 20 } };

    expect(SURFACES.lessons.href(context)).toBeNull();
    expect(SURFACES['drills:terms'].href(context)).toBeNull();
    // Progress is not block-scoped, so it stays reachable.
    expect(SURFACES.progress.href(context)).toBe('/nl/progress');
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
