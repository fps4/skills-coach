/**
 * The reading library (ADR-0017).
 *
 * A queue, not an archive: unread first and by default, newest at the top, with the two filters the
 * surface promises — read/unread and label — held in the URL rather than in component state. That
 * is what makes a filtered view something a learner can bookmark, share with themselves on another
 * device, and come back to.
 *
 * The filters are links rather than a client component on purpose. There is nothing here that needs
 * to happen without a round trip, and the api is already applying the filters — resolving them
 * twice, once on each side, is how the two end up disagreeing.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookOpenCheck, Clock, ExternalLink, Newspaper } from 'lucide-react';

import { PageShell, Pill } from '@/components/atoms';
import { Card, CardContent } from '@/components/ui/card';
import { api, query } from '@/lib/api';
import { formatDate } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { ArticleSummary, Library } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Search {
  packId?: string;
  labels?: string;
  unread?: string;
}

/** A filter link that keeps whatever the other filter is currently set to. */
function filterHref(locale: Locale, search: Search, changes: Partial<Search>): string {
  const next = { ...search, ...changes };
  return `/${locale}/reading${query({
    packId: next.packId,
    labels: next.labels,
    // `true` is the default the api applies, so it is left out of the URL rather than restated.
    unread: next.unread === 'false' ? 'false' : undefined,
  })}`;
}

function ArticleCard({
  article,
  locale,
  readLabel,
  minutesLabel,
}: {
  article: ArticleSummary;
  locale: Locale;
  readLabel: string;
  minutesLabel: string;
}) {
  return (
    <Link href={`/${locale}/reading/${article.articleId}`} className="block">
      <Card className={cn('transition-colors hover:border-primary/50', article.readAt ? 'opacity-60' : undefined)}>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-3">
            {/* The title is content, in whichever variant the api resolved — so it is marked up as
                that language, not as the interface's. */}
            <h2 className="font-medium leading-snug" lang={article.language}>
              {article.title}
            </h2>
            {article.readAt ? (
              <Pill tone="success" className="shrink-0">
                <BookOpenCheck className="mr-1 h-3 w-3" />
                {readLabel}
              </Pill>
            ) : null}
          </div>

          {article.summary ? (
            <p className="line-clamp-2 text-sm text-muted-foreground" lang={article.language}>
              {article.summary}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {article.source?.site ? <span>{article.source.site}</span> : null}
            {article.source?.publishedAt ? <span>{formatDate(article.source.publishedAt, locale)}</span> : null}
            {article.estimatedMinutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {article.estimatedMinutes} {minutesLabel}
              </span>
            ) : null}
            {article.languages.length > 1 ? (
              <span className="uppercase tracking-wide">{article.languages.join(' · ')}</span>
            ) : null}
          </div>

          {article.labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {article.labels.map((label) => (
                <Pill key={label}>{label}</Pill>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function ReadingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  const search = await searchParams;
  // The library belongs to a pack, so without one there is nothing to show — back to the packs.
  if (!search.packId) redirect(`/${locale}`);

  const dictionary = getDictionary(locale);
  const t = dictionary.reading;
  const selected = search.labels?.split(',').filter(Boolean) ?? [];

  const library = await api<Library>(
    `/api/v1/packs/${search.packId}/reading${query({
      labels: search.labels,
      unread: search.unread,
      // Reading is the one surface where the interface language selects content (ADR-0017).
      language: locale,
    })}`,
  );

  const unreadOnly = search.unread !== 'false';

  return (
    <PageShell
      title={t.title}
      subtitle={
        library.counts.total > 0
          ? `${library.counts.unread} ${t.unread} ${dictionary.common.of} ${library.counts.total}`
          : t.subtitle
      }
    >
      {library.counts.total === 0 ? (
        <Card>
          <CardContent className="space-y-1 p-8 text-center">
            <Newspaper className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="font-medium">{t.empty}</p>
            <p className="text-sm text-muted-foreground">{t.emptyHint}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={filterHref(locale, search, { unread: unreadOnly ? 'false' : 'true' })}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                unreadOnly
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {unreadOnly ? t.unreadOnly : t.showRead}
            </Link>

            <span className="mx-1 h-4 w-px bg-border" aria-hidden />

            <Link
              href={filterHref(locale, search, { labels: undefined })}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                selected.length === 0
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t.allLabels}
            </Link>

            {library.labels.map((facet) => {
              const active = selected.includes(facet.label);
              return (
                <Link
                  key={facet.label}
                  href={filterHref(locale, search, { labels: active ? undefined : facet.label })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {facet.label}
                  <span className="ml-1.5 tabular-nums text-muted-foreground">{unreadOnly ? facet.unread : facet.total}</span>
                </Link>
              );
            })}
          </div>

          {library.articles.length === 0 ? (
            <Card>
              <CardContent className="space-y-2 p-8 text-center">
                <p className="text-sm text-muted-foreground">{selected.length > 0 ? t.noMatch : t.allRead}</p>
                {unreadOnly ? (
                  <Link
                    href={filterHref(locale, search, { unread: 'false' })}
                    className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t.showRead}
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {library.articles.map((article) => (
                <ArticleCard
                  key={article.articleId}
                  article={article}
                  locale={locale}
                  readLabel={t.read}
                  minutesLabel={t.readingTime}
                />
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
