/**
 * The wiki index — one tile per guide, with the two chip rows above.
 *
 * Filtering happens *here*, on the server, from the query string. `WikiFilters` only writes that
 * query string. That split is what keeps the corpus off the client and makes every filtered view a
 * URL someone can send to someone else.
 *
 * A tile shows what the guide is (title, one-line summary) and what kind of thing it is (topic,
 * format). Everything else — how long it is, when it changed — belongs on the guide itself.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { PageShell, Pill } from '@/components/atoms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WikiFilters } from '@/components/wiki-filters';
import { allMeta } from '@/lib/wiki';
import { FORMATS, TOPICS, counts, matches, type WikiFilter } from '@/lib/wiki-labels';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';

export default async function WikiIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const dictionary = getDictionary(locale);
  const t = dictionary.wiki;

  /** A repeated param (`?topic=a&topic=b`) is a malformed URL, not a multi-select — take the first. */
  const one = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value[0] : value) ?? null;

  const filter: WikiFilter = { topic: one(query.topic), format: one(query.format), q: one(query.q) };

  const guides = allMeta();
  const shown = guides.filter((guide) => matches(guide, filter));

  return (
    <PageShell title={t.title} subtitle={t.subtitle}>
      <WikiFilters
        locale={locale}
        dictionary={dictionary}
        filter={filter}
        topicCounts={counts(guides, TOPICS, 'topic', filter)}
        formatCounts={counts(guides, FORMATS, 'format', filter)}
        total={shown.length}
      />

      {shown.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm">{t.noResults}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((guide) => (
            <Card key={guide.slug} className="relative flex flex-col transition-colors hover:border-primary/50">
              <CardHeader className="pb-3">
                <CardTitle>
                  {/* The whole tile is the target — same pattern as a pack tile on the landing page. */}
                  <Link
                    href={`/${locale}/wiki/${guide.slug}`}
                    lang="en"
                    className="hover:text-primary after:absolute after:inset-0 after:content-['']"
                  >
                    {guide.title}
                  </Link>
                </CardTitle>
                <p className="text-sm text-muted-foreground" lang="en">
                  {guide.summary}
                </p>
              </CardHeader>
              <CardContent className="mt-auto flex flex-wrap items-center gap-1.5">
                <Pill tone="primary">{t.topics[guide.topic]}</Pill>
                <Pill>{t.formats[guide.format]}</Pill>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
