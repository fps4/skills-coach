/**
 * Reading: a learner's own library of long-form material (ADR-0017).
 *
 * Everything here is scoped to one learner by the filter itself, never by a check after the read.
 * An article that is not theirs is not found — the same guarantee `learner-terms.ts` gives, and for
 * the same reason: this is personalized content, and a route that could return someone else's by
 * guessing an id would be the whole feature's failure mode.
 *
 * Two divisions worth keeping:
 *
 * - **Content and state are separate documents.** An article can be re-loaded — a translation gets
 *   corrected — and re-loading must not mark it unread. So `readAt` lives in `readingState`, the
 *   way a drill item's streak lives in `drillState` rather than on the item.
 * - **The runtime resolves the language, the viewer renders the markdown.** Which variant a learner
 *   sees is a rule (`domain/reading.ts`) and is applied once, here, so the list and the article
 *   itself cannot disagree. What that variant's markdown *looks like* is the surface's business.
 */

import { notFound } from '../http/errors.js';
import { articleSchema, type ArticleInput } from '../domain/schemas.js';
import {
  availableLanguages,
  filterArticles,
  labelFacets,
  pickBody,
  readingCounts,
  type LabelFacet,
  type ReadingCounts,
  type ReadingFilter,
} from '../domain/reading.js';
import type { Article, ArticleSource } from '../domain/types.js';
import type { ArticleDoc } from '../db/collections.js';
import { getPack } from './content.js';
import { articleIdFor, readingStateIdFor, type ServiceContext } from './context.js';

// ---------------------------------------------------------------------------
// What a caller gets back
// ---------------------------------------------------------------------------

/**
 * One article as the library lists it: everything except the text.
 *
 * `language` is the variant the caller is actually being shown and `inRequestedLanguage` says
 * whether that is the one they asked for — a list of Dutch titles that silently turns English
 * because one article was never translated is worse than one that says so.
 */
export interface ArticleSummary {
  articleId: string;
  packId: string;
  slug: string;
  labels: string[];
  source?: ArticleSource;
  estimatedMinutes?: number;
  addedAt: Date;
  /** Null means unread. There is no row to write for "not yet read". */
  readAt: Date | null;
  language: string;
  title: string;
  summary?: string;
  inRequestedLanguage: boolean;
  /** Every language this article can be read in — what the language switch is worth here. */
  languages: string[];
}

/** The article itself, with the resolved variant's markdown. */
export interface ArticleView extends ArticleSummary {
  body: string;
}

export interface Library {
  articles: ArticleSummary[];
  /** Every label in the learner's library for this pack, not merely the filtered subset. */
  labels: LabelFacet[];
  counts: ReadingCounts;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The list projection: bodies without their text, which is most of the document. */
type ArticleIndexDoc = Omit<ArticleDoc, 'bodies'> & {
  bodies: { language: string; title: string; summary?: string }[];
};

const INDEX_PROJECTION = {
  packId: 1,
  learnerId: 1,
  slug: 1,
  labels: 1,
  source: 1,
  estimatedMinutes: 1,
  addedAt: 1,
  'bodies.language': 1,
  'bodies.title': 1,
  'bodies.summary': 1,
} as const;

/** Which articles this learner has read, as a lookup the domain filters can ask. */
async function readMap(ctx: ServiceContext, learnerId: string, packId: string): Promise<Map<string, Date>> {
  const docs = await ctx.store.collections.readingState.find({ learnerId, packId }).toArray();
  return new Map(docs.map((doc) => [doc.articleId, doc.readAt]));
}

function summarize(
  doc: ArticleIndexDoc,
  readAt: Date | null,
  uiLanguage: string,
  contentLanguage: string,
): ArticleSummary | null {
  // `pickBody` wants full bodies; the projection's are enough for a title, so it is handed a
  // body-less shape rather than the whole document being read to choose a language.
  const picked = pickBody(
    doc.bodies.map((entry) => ({ ...entry, body: '' })),
    uiLanguage,
    contentLanguage,
  );
  // An article with no variants cannot be published — the schema demands one — so this is a
  // document that predates its own rules rather than a case to render around.
  if (!picked) return null;

  return {
    articleId: doc._id,
    packId: doc.packId,
    slug: doc.slug,
    labels: doc.labels,
    source: doc.source,
    estimatedMinutes: doc.estimatedMinutes,
    addedAt: doc.addedAt,
    readAt,
    language: picked.body.language,
    title: picked.body.title,
    summary: picked.body.summary,
    inRequestedLanguage: picked.requested,
    languages: availableLanguages(doc),
  };
}

/**
 * The library: what to read next, and what the filters would give.
 *
 * The label facets are computed over the learner's *whole* library rather than the filtered view,
 * because a filter that hides its own way out is a trap — narrow to one label and every other label
 * would vanish along with the articles carrying it.
 */
export async function library(
  ctx: ServiceContext,
  learnerId: string,
  packId: string,
  filter: ReadingFilter,
  uiLanguage: string,
): Promise<Library> {
  const pack = await getPack(ctx, packId);
  const docs = await ctx.store.collections.articles
    .find({ learnerId, packId })
    .project<ArticleIndexDoc>(INDEX_PROJECTION)
    .toArray();

  const read = await readMap(ctx, learnerId, packId);
  const isRead = (articleId: string): boolean => read.has(articleId);
  const refs = docs.map((doc) => ({ ...doc, articleId: doc._id }));

  const articles = filterArticles(refs, filter, isRead)
    .map((doc) => summarize(doc, read.get(doc._id) ?? null, uiLanguage, pack.contentLanguage))
    .filter((entry): entry is ArticleSummary => entry !== null);

  return {
    articles,
    labels: labelFacets(refs, isRead),
    counts: readingCounts(refs, isRead),
  };
}

/** One article, with the text of whichever variant the language rules chose. */
export async function getArticle(
  ctx: ServiceContext,
  learnerId: string,
  articleId: string,
  uiLanguage: string,
): Promise<ArticleView> {
  // Scoped by the filter: another learner's article is not found, never forbidden.
  const doc = await ctx.store.collections.articles.findOne({ _id: articleId, learnerId });
  if (!doc) throw notFound(`article ${articleId}`);

  const pack = await getPack(ctx, doc.packId);
  const picked = pickBody(doc.bodies, uiLanguage, pack.contentLanguage);
  if (!picked) throw notFound(`article ${articleId} has no readable variant`);

  const state = await ctx.store.collections.readingState.findOne({
    _id: readingStateIdFor(learnerId, articleId),
  });

  const summary = summarize(doc, state?.readAt ?? null, uiLanguage, pack.contentLanguage);
  if (!summary) throw notFound(`article ${articleId} has no readable variant`);

  return { ...summary, body: picked.body.body };
}

/** How much is in a learner's library for a pack, and how much of it is still waiting. */
export async function counts(ctx: ServiceContext, learnerId: string, packId: string): Promise<ReadingCounts> {
  const docs = await ctx.store.collections.articles
    .find({ learnerId, packId })
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  const read = await readMap(ctx, learnerId, packId);
  return readingCounts(
    docs.map((doc) => ({ articleId: doc._id })),
    (articleId) => read.has(articleId),
  );
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Mark an article read, or put it back.
 *
 * Reversible on purpose. Read is a filter, not an achievement — a learner who marked the wrong one
 * should be able to say so, and one who wants to read a piece again should not have to be given it
 * a second time.
 */
export async function setRead(
  ctx: ServiceContext,
  learnerId: string,
  articleId: string,
  read: boolean,
): Promise<{ articleId: string; readAt: Date | null }> {
  // Projected: this needs to know the article exists and is theirs, not to read it.
  const doc = await ctx.store.collections.articles.findOne(
    { _id: articleId, learnerId },
    { projection: { packId: 1 } },
  );
  if (!doc) throw notFound(`article ${articleId}`);

  const _id = readingStateIdFor(learnerId, articleId);
  if (!read) {
    await ctx.store.collections.readingState.deleteOne({ _id });
    return { articleId, readAt: null };
  }

  const readAt = ctx.now();
  await ctx.store.collections.readingState.replaceOne(
    { _id },
    { learnerId, articleId, packId: doc.packId, readAt },
    { upsert: true },
  );
  return { articleId, readAt };
}

export interface UpsertReadingResult {
  articles: Article[];
  added: number;
  updated: number;
}

/**
 * Load articles into one learner's library.
 *
 * Idempotent by slug, exactly as publishing a block is idempotent by position: loading the same
 * slug again replaces the article in place and leaves whether it had been read alone. That is what
 * makes re-running a scrape safe, and what lets a bad translation be fixed by loading it again
 * rather than by deleting and re-adding — which would lose the learner's place in the library.
 *
 * `addedAt` is preserved across a re-load for the same reason: the library is ordered newest first,
 * and correcting a typo should not jump an old article back to the top.
 */
export async function upsertArticles(
  ctx: ServiceContext,
  packId: string,
  learnerId: string,
  input: ArticleInput[],
): Promise<UpsertReadingResult> {
  // Refuses a pack that does not exist rather than orphaning a library nothing can reach.
  await getPack(ctx, packId);
  const now = ctx.now();

  const articles: Article[] = [];
  let added = 0;
  let updated = 0;

  for (const entry of input) {
    const parsed = articleSchema.parse(entry);
    const articleId = articleIdFor(packId, learnerId, parsed.slug);
    const existing = await ctx.store.collections.articles.findOne({ _id: articleId }, { projection: { addedAt: 1 } });

    const doc: Omit<ArticleDoc, '_id'> = {
      packId,
      learnerId,
      slug: parsed.slug,
      labels: parsed.labels,
      bodies: parsed.bodies,
      ...(parsed.source ? { source: parsed.source } : {}),
      ...(parsed.estimatedMinutes ? { estimatedMinutes: parsed.estimatedMinutes } : {}),
      addedAt: existing?.addedAt ?? now,
    };

    await ctx.store.collections.articles.replaceOne({ _id: articleId }, doc, { upsert: true });
    if (existing) updated += 1;
    else added += 1;
    articles.push({ ...doc, articleId });
  }

  return { articles, added, updated };
}

/** Take an article out of a learner's library, and the read mark with it. */
export async function removeArticle(ctx: ServiceContext, learnerId: string, articleId: string): Promise<void> {
  const removed = await ctx.store.collections.articles.deleteOne({ _id: articleId, learnerId });
  if (removed.deletedCount === 0) throw notFound(`article ${articleId}`);
  await ctx.store.collections.readingState.deleteOne({ _id: readingStateIdFor(learnerId, articleId) });
}

/** The coach's view of what a learner has been given. Titles and labels, never the text. */
export async function listForCoach(ctx: ServiceContext, packId: string, learnerId: string): Promise<ArticleSummary[]> {
  const pack = await getPack(ctx, packId);
  const docs = await ctx.store.collections.articles
    .find({ learnerId, packId })
    .project<ArticleIndexDoc>(INDEX_PROJECTION)
    .sort({ addedAt: -1 })
    .toArray();

  const read = await readMap(ctx, learnerId, packId);
  return docs
    .map((doc) => summarize(doc, read.get(doc._id) ?? null, pack.contentLanguage, pack.contentLanguage))
    .filter((entry): entry is ArticleSummary => entry !== null);
}
