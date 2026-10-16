/**
 * Search in the web, as rules (ADR-0030): where a result leads, how results group, which keys
 * reach for the bar.
 */

import { describe, expect, it } from 'vitest';

import { focusesSearch, groupHits, hitHref, searchHref, type KeyInput, type SearchHit } from './search';

const hit = (overrides: Partial<SearchHit>): SearchHit => ({
  kind: 'guide',
  skillId: 'data-pipelines',
  skillTitle: 'Data pipelines',
  title: 'A title',
  context: '',
  snippet: [],
  ...overrides,
});

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: document.body,
  ...extra,
});

describe('hitHref', () => {
  it('opens a guide section at its heading', () => {
    expect(hitHref(hit({ slug: 'dbt', anchor: '4-ref-and-source' }))).toBe('/guides/data-pipelines/dbt#4-ref-and-source');
  });

  it('opens the top of a guide when the match was the guide itself', () => {
    expect(hitHref(hit({ slug: 'dbt' }))).toBe('/guides/data-pipelines/dbt');
  });

  it("opens a card's deck in learn mode, where the back is meant to be seen", () => {
    expect(hitHref(hit({ kind: 'card', blockId: 'data-pipelines.b1' }))).toBe('/flashcards?blockId=data-pipelines.b1&mode=learn');
  });
});

describe('searchHref', () => {
  it('carries the query and only the filters that are set', () => {
    expect(searchHref(' late data ')).toBe('/search?q=late+data');
    expect(searchHref('x', { kind: 'card', skill: 'streaming' })).toBe('/search?q=x&kind=card&skill=streaming');
  });
});

describe('groupHits', () => {
  it('groups by kind, the group with the best result first, rank kept within each', () => {
    const groups = groupHits([
      hit({ kind: 'card', title: 'c1' }),
      hit({ kind: 'guide', title: 'g1' }),
      hit({ kind: 'card', title: 'c2' }),
    ]);
    expect(groups.map((group) => [group.kind, group.hits.map((entry) => entry.title)])).toEqual([
      ['card', ['c1', 'c2']],
      ['guide', ['g1']],
    ]);
  });
});

describe('focusesSearch', () => {
  it('answers ⌘K and Ctrl-K from anywhere, even a text field', () => {
    const input = document.createElement('input');
    expect(focusesSearch(press('k', { metaKey: true }))).toBe(true);
    expect(focusesSearch(press('K', { ctrlKey: true, target: input }))).toBe(true);
  });

  it('answers / only when the learner is not typing', () => {
    expect(focusesSearch(press('/'))).toBe(true);
    expect(focusesSearch(press('/', { target: document.createElement('textarea') }))).toBe(false);
  });

  it('leaves a read-only answer box alone, as the flashcards do', () => {
    const box = document.createElement('input');
    box.readOnly = true;
    expect(focusesSearch(press('/', { target: box }))).toBe(true);
  });

  it('ignores other modified keys and anything already handled', () => {
    expect(focusesSearch(press('/', { metaKey: true }))).toBe(false);
    expect(focusesSearch(press('k', { altKey: true, metaKey: true }))).toBe(false);
    expect(focusesSearch(press('/', { defaultPrevented: true }))).toBe(false);
  });
});
