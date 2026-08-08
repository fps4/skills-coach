/**
 * Reading: which language a learner is shown, and what the two filters mean (ADR-0017).
 *
 * Pure, like every other module here. The library surface is two filters over a list and one
 * language decision per article, and all three are rules worth pinning in tests rather than
 * discovering in a component.
 */

import type { ArticleBody } from './types.js';

/**
 * The least an article has to be for the filters to work on it.
 *
 * Structural rather than the whole `Article`, because the library list is served from a projection
 * that leaves the bodies in the database — an article runs to tens of thousands of characters and
 * the list shows a title. Same rules, either shape.
 */
export interface ArticleRef {
  articleId: string;
  slug: string;
  labels: string[];
  addedAt: Date;
}

/**
 * The base of a BCP-47 tag: `nl-BE` → `nl`.
 *
 * Matching on the base is what lets a pack authored in `nl` serve an interface negotiated to
 * `nl-BE` without either side having to know about the other's regional refinement.
 */
export function baseLanguage(tag: string): string {
  const base = tag.trim().toLocaleLowerCase().split(/[-_]/)[0];
  return base ?? '';
}

/** The variant written in `wanted`, exact tag first, then same base language. Null when neither. */
export function matchBody(bodies: ArticleBody[], wanted: string): ArticleBody | null {
  const target = wanted.trim().toLocaleLowerCase();
  if (!target) return null;

  const exact = bodies.find((body) => body.language.trim().toLocaleLowerCase() === target);
  if (exact) return exact;

  const base = baseLanguage(wanted);
  return bodies.find((body) => baseLanguage(body.language) === base) ?? null;
}

/**
 * Which variant to show, and whether the learner got the one they asked for.
 *
 * The order is deliberate. **The interface language wins** — this is the one place where flipping
 * the language switch changes content rather than chrome, and it is the whole point of a parallel
 * text (ADR-0017). Where the article has no such variant it falls back to the language the pack
 * teaches, because a Dutch program showing English by default would quietly stop being practice.
 *
 * `requested` says which of those happened, so the surface can tell the learner it fell back
 * instead of silently serving a language they did not choose.
 */
export function pickBody(
  bodies: ArticleBody[],
  uiLanguage: string,
  contentLanguage: string,
): { body: ArticleBody; requested: boolean } | null {
  const wanted = matchBody(bodies, uiLanguage);
  if (wanted) return { body: wanted, requested: true };

  const content = matchBody(bodies, contentLanguage);
  if (content) return { body: content, requested: false };

  const first = bodies[0];
  return first ? { body: first, requested: false } : null;
}

/** Every language an article can be read in, in the order its variants were supplied. */
export function availableLanguages(article: { bodies: Pick<ArticleBody, 'language'>[] }): string[] {
  return article.bodies.map((body) => body.language);
}

export interface LabelFacet {
  label: string;
  total: number;
  unread: number;
}

/**
 * The label filter's options, with what each one would yield.
 *
 * Both counts are carried because the two filters compose: a learner looking at unread articles
 * needs to know a label has none left, and a label that reads `0` is more useful than a label that
 * has silently disappeared.
 *
 * Sorted by how much unread material sits behind them, then alphabetically — the list is a place to
 * go next, so the label with something waiting belongs at the top.
 */
export function labelFacets(
  articles: Pick<ArticleRef, 'articleId' | 'labels'>[],
  isRead: (articleId: string) => boolean,
): LabelFacet[] {
  const counts = new Map<string, LabelFacet>();

  for (const article of articles) {
    const read = isRead(article.articleId);
    // A label repeated on one article counts once — it is a tag, not a tally.
    for (const label of new Set(article.labels)) {
      const facet = counts.get(label) ?? { label, total: 0, unread: 0 };
      facet.total += 1;
      if (!read) facet.unread += 1;
      counts.set(label, facet);
    }
  }

  return [...counts.values()].sort(
    (a, b) => b.unread - a.unread || b.total - a.total || a.label.localeCompare(b.label),
  );
}

export interface ReadingFilter {
  /** An article must carry **every** label named here. Narrowing, not widening. */
  labels?: string[];
  /** The surface's default. `false` shows everything, read and unread alike. */
  unreadOnly?: boolean;
}

/**
 * Apply the two filters, newest first.
 *
 * Unread-by-default is the rule the whole surface is built on: a library where finished articles
 * keep their place stops being a queue and becomes an archive, and nothing in it says what to read
 * next. Read articles are never removed — the filter is a view, and `unreadOnly: false` brings them
 * all back.
 */
export function filterArticles<T extends ArticleRef>(
  articles: T[],
  filter: ReadingFilter,
  isRead: (articleId: string) => boolean,
): T[] {
  const wanted = filter.labels ?? [];
  const unreadOnly = filter.unreadOnly ?? true;

  return articles
    .filter((article) => {
      if (unreadOnly && isRead(article.articleId)) return false;
      const carried = new Set(article.labels);
      return wanted.every((label) => carried.has(label));
    })
    .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime() || a.slug.localeCompare(b.slug));
}

export interface ReadingCounts {
  total: number;
  unread: number;
}

/** What the rail shows: how much is there, and how much is still waiting. */
export function readingCounts(
  articles: Pick<ArticleRef, 'articleId'>[],
  isRead: (articleId: string) => boolean,
): ReadingCounts {
  return {
    total: articles.length,
    unread: articles.filter((article) => !isRead(article.articleId)).length,
  };
}
