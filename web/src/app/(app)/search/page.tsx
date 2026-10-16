/**
 * Search results (ADR-0030): everything the bar's popover had no room for, filterable by kind and
 * by skill. Rendered on the server from the address, so a search is a link — shareable, bookmarkable,
 * and the back button returns to it.
 */

import Link from 'next/link';

import { PageShell } from '@/components/atoms';
import { SearchResultBody } from '@/components/search-result';
import { Card, CardContent } from '@/components/ui/card';
import { getDictionary } from '@/i18n/dictionaries';
import { api, query } from '@/lib/api';
import { hitHref, searchHref, type SearchKind, type SearchResponse } from '@/lib/search';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 50;

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));

type SearchParams = Promise<{ q?: string; kind?: string; skill?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const { q } = await searchParams;
  const t = getDictionary().search;
  return { title: q ? `${q} — ${t.title}` : t.title };
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition-colors',
        active ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const kind: SearchKind | undefined = params.kind === 'guide' || params.kind === 'card' ? params.kind : undefined;
  const skill = params.skill || undefined;
  const t = getDictionary().search;

  if (!q) {
    return (
      <PageShell title={t.title}>
        <p className="text-sm text-muted-foreground">{t.emptyQuery}</p>
      </PageShell>
    );
  }

  const response = await api<SearchResponse>(`/api/v1/search${query({ q, kind, skill, limit: PAGE_LIMIT })}`);
  const all = response.counts.guide + response.counts.card;
  const subtitle = fill(response.total === 1 ? t.oneResult : t.results, { n: response.total, q });

  return (
    <PageShell title={t.title} subtitle={subtitle}>
      <nav aria-label={t.title} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Chip href={searchHref(q, { skill })} active={!kind}>
            {t.all} ({all})
          </Chip>
          <Chip href={searchHref(q, { kind: 'guide', skill })} active={kind === 'guide'}>
            {t.guides} ({response.counts.guide})
          </Chip>
          <Chip href={searchHref(q, { kind: 'card', skill })} active={kind === 'card'}>
            {t.cards} ({response.counts.card})
          </Chip>
        </div>
        {response.skills.length > 1 || skill ? (
          <div className="flex flex-wrap gap-2">
            <Chip href={searchHref(q, { kind })} active={!skill}>
              {t.allSkills}
            </Chip>
            {response.skills.map((entry) => (
              <Chip key={entry.skillId} href={searchHref(q, { kind, skill: entry.skillId })} active={skill === entry.skillId}>
                {entry.title} ({entry.count})
              </Chip>
            ))}
          </div>
        ) : null}
      </nav>

      {response.hits.length === 0 ? (
        <div className="space-y-1 text-sm">
          <p>{fill(t.noResults, { q })}</p>
          <p className="text-muted-foreground">{t.noResultsHint}</p>
        </div>
      ) : (
        <ol className="space-y-3">
          {response.hits.map((hit) => (
            <li key={`${hit.kind}:${hit.drillItemId ?? `${hit.slug}#${hit.anchor ?? ''}`}`}>
              <Link href={hitHref(hit)} className="block">
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="p-4">
                    <SearchResultBody hit={hit} />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}
