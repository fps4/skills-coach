import { describe, expect, it } from 'vitest';

import { counts, matches, toQuery, type WikiMeta } from './wiki-labels';

const guide = (over: Partial<WikiMeta> = {}): WikiMeta => ({
  slug: 'a-guide',
  title: 'Kafka Streams',
  summary: 'Stateful processing on a log.',
  topic: 'streaming',
  format: 'primer',
  tags: ['kafka', 'windowing'],
  updated: '2026-08-07',
  ...over,
});

describe('matches', () => {
  it('keeps everything when nothing is selected', () => {
    expect(matches(guide(), {})).toBe(true);
  });

  it('narrows on topic and on format independently', () => {
    expect(matches(guide(), { topic: 'streaming' })).toBe(true);
    expect(matches(guide(), { topic: 'governance' })).toBe(false);
    expect(matches(guide(), { format: 'primer' })).toBe(true);
    expect(matches(guide(), { format: 'deep-dive' })).toBe(false);
  });

  it('narrows to nothing on a topic that does not exist, rather than ignoring it', () => {
    // A shared URL should show what the sender saw, or show that it is empty — never silently
    // show everything, which would misrepresent the link.
    expect(matches(guide(), { topic: 'nonsense' })).toBe(false);
  });

  it('searches the title, the summary and the tags', () => {
    expect(matches(guide(), { q: 'kafka' })).toBe(true);
    expect(matches(guide(), { q: 'stateful' })).toBe(true);
    expect(matches(guide(), { q: 'windowing' })).toBe(true);
    expect(matches(guide(), { q: 'terraform' })).toBe(false);
  });

  it('requires every search term to match, not just one', () => {
    expect(matches(guide(), { q: 'kafka windowing' })).toBe(true);
    expect(matches(guide(), { q: 'kafka terraform' })).toBe(false);
  });

  it('ignores case and stray whitespace in the search box', () => {
    expect(matches(guide(), { q: '  KAFKA   Streams ' })).toBe(true);
  });

  it('combines the axes with AND', () => {
    expect(matches(guide(), { topic: 'streaming', format: 'primer', q: 'kafka' })).toBe(true);
    expect(matches(guide(), { topic: 'streaming', format: 'refresher', q: 'kafka' })).toBe(false);
  });
});

describe('counts', () => {
  const corpus = [
    guide({ slug: 'a', topic: 'streaming', format: 'primer' }),
    guide({ slug: 'b', topic: 'streaming', format: 'refresher' }),
    guide({ slug: 'c', topic: 'governance', format: 'primer' }),
  ];

  it('counts an axis against the whole corpus when nothing else is filtering', () => {
    expect(counts(corpus, ['streaming', 'governance'] as const, 'topic', {})).toEqual({
      streaming: 2,
      governance: 1,
    });
  });

  it('counts an axis against the rest of the filter, not against its own selection', () => {
    // With `streaming` chosen, the topic row must still show what the other topics *would* give —
    // otherwise every unselected chip reads 0 and the row becomes unusable.
    const tally = counts(corpus, ['streaming', 'governance'] as const, 'topic', { topic: 'streaming' });
    expect(tally).toEqual({ streaming: 2, governance: 1 });
  });

  it('narrows the other axis by the current selection', () => {
    const tally = counts(corpus, ['primer', 'refresher'] as const, 'format', { topic: 'streaming' });
    expect(tally).toEqual({ primer: 1, refresher: 1 });
  });

  it('reports a genuine dead end as zero', () => {
    const tally = counts(corpus, ['primer', 'refresher'] as const, 'format', { topic: 'governance' });
    expect(tally.refresher).toBe(0);
  });
});

describe('toQuery', () => {
  it('drops empty values so a cleared filter is a clean URL', () => {
    expect(toQuery({})).toBe('');
    expect(toQuery({ topic: null, format: null, q: '' })).toBe('');
  });

  it('emits only what is set', () => {
    expect(toQuery({ topic: 'streaming' })).toBe('?topic=streaming');
    expect(toQuery({ topic: 'streaming', q: 'flink' })).toBe('?topic=streaming&q=flink');
  });
});
