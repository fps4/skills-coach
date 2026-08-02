/**
 * Home — one tile per pack the learner can reach.
 *
 * The landing surface after sign-in. A tile is a pack: what it is, how far in they are, and the one
 * action that continues it. Detail belongs on the pack page, so a tile stays readable at a glance
 * whether the learner has one pack or six.
 *
 * The catalogue is fetched every time, not only when nothing is enrolled: a learner who has opened
 * one pack must still be able to see and start another.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, BookOpen, CircleDashed } from 'lucide-react';

import { PageShell, Meter, Pill } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { pickTitle } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Enrollment, Learner, Pack, PackProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  const t = dictionary.home;

  const [{ learner }, overview, catalogue] = await Promise.all([
    api<{ learner: Learner; enrollments: Enrollment[] }>('/api/v1/me'),
    api<{ packs: PackProgress[] }>('/api/v1/progress'),
    api<{ packs: Pack[] }>('/api/v1/packs'),
  ]);

  // Started packs first, then everything published the learner has not opened yet.
  const started = overview.packs;
  const startedIds = new Set(started.map((entry) => entry.pack.packId));
  const available = catalogue.packs.filter((pack) => !startedIds.has(pack.packId));

  return (
    <PageShell
      title={
        <>
          {t.title}
          {learner.displayName ? <span className="text-muted-foreground">, {learner.displayName}</span> : null}
        </>
      }
      subtitle={t.subtitle}
    >
      {started.length === 0 && available.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm">{t.noPacks}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.noPacksHint}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {started.map((entry) => {
          const block = entry.currentBlock;
          const progress = entry.blockProgress;
          const next = progress?.nextLessonOrder ?? null;
          const packHref = `/${locale}/packs/${entry.pack.packId}`;

          return (
            <Tile
              key={entry.pack.packId}
              href={packHref}
              title={pickTitle(entry.pack.title, locale)}
              pill={block?.level ? <Pill className="shrink-0 whitespace-nowrap">{block.level}</Pill> : null}
              // The block's own title, unprefixed: pack authors habitually name it "Blok 01 — …"
              // already, and a runtime prefix would say it twice.
              caption={block ? pickTitle(block.title, locale) : undefined}
            >
              {progress ? (
                <div>
                  <Meter value={progress.completed} total={progress.lessonCount} />
                  <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
                    <span>
                      {progress.completed}/{progress.lessonCount} {t.lessonsDone}
                    </span>
                    <span>
                      {entry.decks.terms.mastered}/{entry.decks.terms.total} {dictionary.progress.words.toLowerCase()}
                    </span>
                  </div>
                  {progress.pendingOrders.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dictionary.pack.waitingOnCoach}: {dictionary.common.lesson} {progress.pendingOrders.join(', ')}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* `relative` lifts the action above the tile-wide link behind it. */}
              {block && next ? (
                <Button asChild size="sm" className="relative w-full">
                  <Link href={`/${locale}/lessons/${block.blockId}.l${next}`}>
                    {t.continueLesson} {next} <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <Button asChild size="sm" variant="outline" className="relative w-full">
                  <Link href={packHref}>
                    <BookOpen className="h-4 w-4" /> {t.openPack}
                  </Link>
                </Button>
              )}
            </Tile>
          );
        })}

        {available.map((pack) => (
          <Tile
            key={pack.packId}
            href={`/${locale}/packs/${pack.packId}`}
            title={pickTitle(pack.title, locale)}
            pill={
              <Pill className="shrink-0 whitespace-nowrap">
                <CircleDashed className="mr-1 h-3 w-3 shrink-0" /> {dictionary.pack.notStarted}
              </Pill>
            }
            caption={pack.description ? pickTitle(pack.description, locale) : undefined}
          >
            <Button asChild size="sm" variant="outline" className="relative w-full">
              <Link href={`/${locale}/packs/${pack.packId}`}>
                {t.startPack} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Tile>
        ))}
      </div>
    </PageShell>
  );
}

/**
 * One pack, as a tile.
 *
 * The whole tile is the link — the title carries it and spreads over the card, so the target is one
 * word for a screen reader and the full rectangle for a pointer. Nothing is nested inside that
 * anchor, which is what keeps the actions in the footer legal and clickable.
 */
function Tile({
  href,
  title,
  pill,
  caption,
  children,
}: {
  href: string;
  title: string;
  pill?: ReactNode;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <Card className="relative flex flex-col transition-colors hover:border-primary/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle>
            <Link href={href} className="hover:text-primary after:absolute after:inset-0 after:content-['']">
              {title}
            </Link>
          </CardTitle>
          {pill}
        </div>
        {caption ? <p className="text-sm text-muted-foreground">{caption}</p> : null}
      </CardHeader>
      <CardContent className="mt-auto space-y-3">{children}</CardContent>
    </Card>
  );
}
