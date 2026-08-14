/**
 * Pack scoping (ADR-0009).
 *
 * Two things are pinned here. The URL→pack derivation, because it rests on the id format the api
 * mints (`${packId}.b${order}`) and a change there would silently un-scope the whole shell. And the
 * palette precedence, because "the pack colours the app, but never over a person's choice" is a rule
 * you cannot see by reading the component.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURFACES,
  SURFACES,
  packIcon,
  packIdFromUrl,
  packLanding,
  resolvePalette,
  visibleSurfaces,
  type PackMaterial,
} from './pack-scope';

const search = (query: string) => new URLSearchParams(query);

/** A rail context, with the parts a test does not care about defaulted. */
const context = (overrides: Partial<Parameters<(typeof SURFACES)['lessons']['href']>[0]> = {}) => ({
  locale: 'nl',
  currentBlockId: 'demo.b1',
  packId: 'demo',
  ...overrides,
});

/** A pack that has some of everything, so a test can zero out only what it is about. */
const material = (overrides: Partial<PackMaterial> = {}): PackMaterial => ({
  blocks: 3,
  terms: 20,
  wordOrder: 20,
  quiz: 20,
  reading: 4,
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

  it('reads it off the pack landing page, which names its pack in the query', () => {
    expect(packIdFromUrl('/nl/progress', search('packId=demo-conversation-nl'))).toBe('demo-conversation-nl');
  });

  it('returns null where the URL names no pack — those surfaces stay generic', () => {
    expect(packIdFromUrl('/nl')).toBeNull();
    expect(packIdFromUrl('/nl/progress', search(''))).toBeNull();
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
    expect(DEFAULT_SURFACES).toEqual(['lessons', 'reading', 'drills:terms', 'drills:word-order', 'quiz']);
    expect(Object.keys(SURFACES).sort()).toEqual([...DEFAULT_SURFACES].sort());
  });

  // The pack is the rail item progress hangs off, so it is not an item beside the others (ADR-0018).
  it('does not carry progress as a surface — a pack lands on it', () => {
    expect(Object.keys(SURFACES)).not.toContain('progress');
    expect(packLanding('nl', 'demo-conversation-nl')).toBe('/nl/progress?packId=demo-conversation-nl');
  });

  // Every surface answers this, and nothing else in the app asks the question — a new surface is a
  // new entry here, never a branch in the rail (ADR-0019).
  it('asks each surface whether the pack has any of it', () => {
    for (const id of DEFAULT_SURFACES) {
      expect(SURFACES[id].has(material())).toBe(true);
    }

    expect(SURFACES.quiz.has(material({ quiz: 0 }))).toBe(false);
    expect(SURFACES['drills:terms'].has(material({ terms: 0 }))).toBe(false);
    expect(SURFACES['drills:word-order'].has(material({ wordOrder: 0 }))).toBe(false);
    expect(SURFACES.reading.has(material({ reading: 0 }))).toBe(false);
    expect(SURFACES.lessons.has(material({ blocks: 0 }))).toBe(false);
  });

  it('disables everything block-scoped before the learner has a block', () => {
    const noBlock = context({ currentBlockId: null });

    expect(SURFACES.lessons.href(noBlock)).toBeNull();
    expect(SURFACES['drills:terms'].href(noBlock)).toBeNull();
    expect(SURFACES.quiz.href(noBlock)).toBeNull();
    // The pack's own landing is not block-scoped, so it stays reachable throughout.
    expect(packLanding('nl', 'demo')).toBe('/nl/progress?packId=demo');
  });

  // Reading belongs to a pack, not to a block (ADR-0017), so it opens whether or not the learner has
  // one. Whether it is there at all is `has`, above.
  it('keeps reading reachable without a block', () => {
    expect(SURFACES.reading.href(context({ currentBlockId: null }))).toBe('/nl/reading?packId=demo');
  });
});

describe('visibleSurfaces', () => {
  it('shows everything a pack offers and has when it declares nothing', () => {
    expect(visibleSurfaces(undefined, material())).toEqual(DEFAULT_SURFACES);
  });

  it('honours a pack that opts out of one', () => {
    expect(visibleSurfaces(['lessons', 'drills:terms'], material())).toEqual(['lessons', 'drills:terms']);
  });

  it('renders in the platform’s order, not the order the pack listed them', () => {
    expect(visibleSurfaces(['drills:word-order', 'lessons'], material())).toEqual(['lessons', 'drills:word-order']);
  });

  // The rule that retires the dead item: a language program that never quizzes stops showing a
  // practice test without its author having to declare anything (ADR-0019).
  it('hides a surface the pack has no material for, declared or not', () => {
    expect(visibleSurfaces(undefined, material({ quiz: 0 }))).toEqual([
      'lessons',
      'reading',
      'drills:terms',
      'drills:word-order',
    ]);
    expect(visibleSurfaces(['lessons', 'quiz'], material({ quiz: 0 }))).toEqual(['lessons']);
  });

  it('leaves a pack with nothing in it yet with nothing under it', () => {
    expect(visibleSurfaces(undefined, material({ blocks: 0, terms: 0, wordOrder: 0, quiz: 0, reading: 0 }))).toEqual([]);
  });

  // Packs published against ADR-0009 name it, and the api still accepts it. It moves nothing now
  // that the pack itself lands on progress, and it must not fail the pack's other surfaces with it.
  it('ignores a declared progress surface rather than choking on it', () => {
    expect(visibleSurfaces(['quiz', 'progress'], material())).toEqual(['quiz']);
    expect(visibleSurfaces(['progress'], material())).toEqual([]);
  });
});

describe('packIcon', () => {
  it('falls back rather than rendering nothing', () => {
    expect(packIcon('not-an-icon')).toBe(packIcon(undefined));
    expect(packIcon('message-circle')).not.toBe(packIcon(undefined));
  });
});
