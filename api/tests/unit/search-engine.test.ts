/**
 * The search engine over documents in memory (ADR-0030) — ranking, tolerance, visibility, facets.
 *
 * No database: the engine is fed documents the way the index feeds it. Invented content only
 * (ADR-0006).
 */

import { describe, expect, it } from 'vitest';
import { cardDocument, guideDocuments } from '../../src/domain/search.js';
import type { DrillItem } from '../../src/domain/types.js';
import { SearchEngine } from '../../src/services/search.js';

const LIMIT = { limit: 20 };

function card(id: string, term: string, translation: string, extra: Partial<DrillItem> = {}) {
  const item = {
    drillItemId: id,
    packId: 'streaming',
    blockId: 'streaming.b1',
    payload: { kind: 'term', term, translation },
    ...extra,
  } as DrillItem;
  return cardDocument(item)!;
}

function engine(): SearchEngine {
  const search = new SearchEngine();
  search.setSkillTitles(new Map([['streaming', 'Streaming & integration']]));
  for (const document of guideDocuments({
    skillId: 'streaming',
    slug: 'event-time',
    title: 'Event time',
    summary: 'Reasoning about when things happened.',
    body: [
      '## Watermarks',
      'A watermark is how a stream decides an event is late.',
      '## Idempotent consumers',
      'Processing a message twice must leave the same result.',
      '## Windows',
      'Tumbling and sliding windows group events by time.',
      '## Late data',
      'Late events past the watermark go to a side output.',
    ].join('\n\n'),
  })) {
    search.add(document);
  }
  search.add(card('c1', 'Watermark', 'How late an event may arrive'));
  search.add(card('c2', 'Exactly once', 'Each message affects state once'));
  search.add(card('c3', 'Mijn woord', 'My own word, watermark included', { learnerId: 'learner-a' }));
  return search;
}

describe('SearchEngine', () => {
  it('finds a heading and a card front, with the stronger field first', () => {
    const { hits } = engine().query('learner-a', 'watermark', LIMIT);
    expect(hits[0]?.title).toMatch(/watermark/i);
    expect(hits.map((hit) => hit.kind)).toContain('card');
    expect(hits.map((hit) => hit.kind)).toContain('guide');
  });

  it('forgives a typo', () => {
    const { hits } = engine().query('learner-a', 'watremark', LIMIT);
    expect(hits.map((hit) => hit.title)).toContain('Watermark');
  });

  it('matches the word still being typed as a prefix', () => {
    const { hits } = engine().query('learner-a', 'idempot', LIMIT);
    expect(hits[0]).toMatchObject({ kind: 'guide', anchor: 'idempotent-consumers' });
  });

  it('wants every term, and settles for any when nothing has them all', () => {
    const both = engine().query('learner-a', 'late watermark', LIMIT);
    expect(both.hits.every((hit) => /late/i.test(JSON.stringify(hit)))).toBe(true);

    const either = engine().query('learner-a', 'tumbling zeppelin', LIMIT);
    expect(either.hits[0]?.title).toBe('Windows');
  });

  it("shows a learner their own card and nobody else's", () => {
    const mine = engine().query('learner-a', 'watermark', LIMIT);
    const theirs = engine().query('learner-b', 'watermark', LIMIT);
    expect(mine.hits.map((hit) => hit.title)).toContain('Mijn woord');
    expect(theirs.hits.map((hit) => hit.title)).not.toContain('Mijn woord');
    expect(theirs.total).toBe(mine.total - 1);
  });

  it('marks the matched words in the snippet', () => {
    const { hits } = engine().query('learner-a', 'exactly', LIMIT);
    const exactly = hits.find((hit) => hit.title === 'Exactly once');
    expect(exactly?.snippet).toEqual([{ text: 'Each message affects state once' }]);

    const message = engine().query('learner-a', 'message', LIMIT);
    expect(message.hits[0]?.snippet.some((part) => part.match && /message/i.test(part.text))).toBe(true);
  });

  it('counts by kind and by skill, and filters by either', () => {
    const all = engine().query('learner-a', 'watermark', LIMIT);
    expect(all.counts.card).toBe(2);
    expect(all.counts.guide).toBeGreaterThan(0);
    expect(all.skills).toEqual([{ skillId: 'streaming', title: 'Streaming & integration', count: all.total }]);

    const cards = engine().query('learner-a', 'watermark', { ...LIMIT, kind: 'card' });
    expect(cards.hits.every((hit) => hit.kind === 'card')).toBe(true);
    expect(cards.counts).toEqual(all.counts);

    expect(engine().query('learner-a', 'watermark', { ...LIMIT, skill: 'elsewhere' }).total).toBe(0);
  });

  it('drops a block wholesale when it is replaced', () => {
    const search = engine();
    search.replaceBlock('streaming.b1', [card('c4', 'Backpressure', 'Slowing the producer down')]);
    expect(search.query('learner-a', 'exactly', LIMIT).hits.filter((hit) => hit.kind === 'card')).toEqual([]);
    expect(search.query('learner-a', 'backpressure', LIMIT).hits[0]?.title).toBe('Backpressure');
  });

  it('caps a result list at the limit and reports the total', () => {
    const { hits, total } = engine().query('learner-a', 'watermark', { limit: 1 });
    expect(hits).toHaveLength(1);
    expect(total).toBeGreaterThan(1);
  });
});
