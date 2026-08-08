/**
 * Reading rules — language resolution and the two filters (ADR-0017).
 *
 * The language tests are the load-bearing ones. Reading is the single surface where the interface
 * language changes *content*, so the order it resolves in is a product decision, not a detail.
 */

import { describe, expect, it } from 'vitest';
import {
  availableLanguages,
  baseLanguage,
  filterArticles,
  labelFacets,
  matchBody,
  pickBody,
  readingCounts,
} from '../../src/domain/reading.js';
import type { Article, ArticleBody } from '../../src/domain/types.js';

const body = (language: string, title = `title-${language}`): ArticleBody => ({
  language,
  title,
  body: `body in ${language}`,
});

function article(slug: string, options: Partial<Article> = {}): Article {
  return {
    articleId: `pack-1.rowner.${slug}`,
    packId: 'pack-1',
    learnerId: 'learner-1',
    slug,
    labels: [],
    bodies: [body('nl'), body('en')],
    addedAt: new Date('2026-08-01T10:00:00Z'),
    ...options,
  };
}

const readNone = () => false;
const readAll = () => true;

describe('baseLanguage', () => {
  it('drops the region so a regional interface still matches a plain tag', () => {
    expect(baseLanguage('nl-BE')).toBe('nl');
    expect(baseLanguage('en_GB')).toBe('en');
    expect(baseLanguage('NL')).toBe('nl');
  });
});

describe('matchBody', () => {
  it('prefers the exact tag over the same base language', () => {
    const bodies = [body('nl'), body('nl-BE')];
    expect(matchBody(bodies, 'nl-BE')?.language).toBe('nl-BE');
  });

  it('falls back to the same base language when the exact tag is absent', () => {
    expect(matchBody([body('nl')], 'nl-BE')?.language).toBe('nl');
  });

  it('returns null rather than guessing at an unrelated language', () => {
    expect(matchBody([body('nl'), body('en')], 'de')).toBeNull();
  });
});

describe('pickBody', () => {
  it('gives the learner the interface language — this is where the switch changes content', () => {
    const picked = pickBody([body('nl'), body('en')], 'en', 'nl');
    expect(picked?.body.language).toBe('en');
    expect(picked?.requested).toBe(true);
  });

  it('falls back to the language the pack teaches, and says that it did', () => {
    const picked = pickBody([body('nl')], 'en', 'nl');
    expect(picked?.body.language).toBe('nl');
    expect(picked?.requested).toBe(false);
  });

  it('shows something rather than nothing when neither language is present', () => {
    const picked = pickBody([body('de')], 'en', 'nl');
    expect(picked?.body.language).toBe('de');
    expect(picked?.requested).toBe(false);
  });

  it('has nothing to show for an article with no variants', () => {
    expect(pickBody([], 'nl', 'nl')).toBeNull();
  });
});

describe('availableLanguages', () => {
  it('lists what the article can be read in', () => {
    expect(availableLanguages(article('a'))).toEqual(['nl', 'en']);
  });
});

describe('labelFacets', () => {
  const articles = [
    article('a', { labels: ['netwerken', 'security'] }),
    article('b', { labels: ['netwerken'] }),
    article('c', { labels: ['security'] }),
  ];

  it('counts every article carrying a label', () => {
    const facets = labelFacets(articles, readNone);
    expect(facets.map((facet) => [facet.label, facet.total])).toEqual([
      ['netwerken', 2],
      ['security', 2],
    ]);
  });

  it('counts a label repeated on one article once — it is a tag, not a tally', () => {
    const facets = labelFacets([article('a', { labels: ['aws', 'aws'] })], readNone);
    expect(facets).toEqual([{ label: 'aws', total: 1, unread: 1 }]);
  });

  it('keeps a label with nothing unread rather than hiding it', () => {
    const facets = labelFacets(articles, readAll);
    expect(facets.every((facet) => facet.unread === 0)).toBe(true);
    expect(facets).toHaveLength(2);
  });

  it('puts what has most unread first, so the list says where to go next', () => {
    const read = new Set(['pack-1.rowner.a', 'pack-1.rowner.b']);
    const facets = labelFacets(articles, (id) => read.has(id));
    expect(facets[0]?.label).toBe('security');
  });
});

describe('filterArticles', () => {
  const articles = [
    article('a', { labels: ['netwerken'], addedAt: new Date('2026-07-01T00:00:00Z') }),
    article('b', { labels: ['netwerken', 'security'], addedAt: new Date('2026-07-03T00:00:00Z') }),
    article('c', { labels: ['security'], addedAt: new Date('2026-07-02T00:00:00Z') }),
  ];

  it('shows only unread by default', () => {
    const read = new Set(['pack-1.rowner.b']);
    expect(filterArticles(articles, {}, (id) => read.has(id)).map((entry) => entry.slug)).toEqual(['c', 'a']);
  });

  it('brings read articles back rather than deleting them', () => {
    expect(filterArticles(articles, { unreadOnly: false }, readAll)).toHaveLength(3);
  });

  it('narrows: an article must carry every label asked for', () => {
    const both = filterArticles(articles, { labels: ['netwerken', 'security'] }, readNone);
    expect(both.map((entry) => entry.slug)).toEqual(['b']);
  });

  it('orders newest first, so a fresh load lands at the top', () => {
    expect(filterArticles(articles, {}, readNone).map((entry) => entry.slug)).toEqual(['b', 'c', 'a']);
  });
});

describe('readingCounts', () => {
  it('reports how much is there and how much is waiting', () => {
    const articles = [article('a'), article('b')];
    const read = new Set(['pack-1.rowner.a']);
    expect(readingCounts(articles, (id) => read.has(id))).toEqual({ total: 2, unread: 1 });
  });
});
