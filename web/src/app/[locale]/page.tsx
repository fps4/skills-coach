/**
 * Vandaag — where the learner left off.
 *
 * The one question this page answers is "what do I do now", and the answer is a lesson number,
 * never a date. Everything else is secondary.
 */

import Link from 'next/link';
import { ArrowRight, BookOpen, Check, Puzzle, Sparkles, Target } from 'lucide-react';

import { PageShell, Meter, Pill, Stat } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { pickTitle } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Enrollment, Learner, PackProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  const t = dictionary.home;

  const [{ learner }, overview] = await Promise.all([
    api<{ learner: Learner; enrollments: Enrollment[] }>('/api/v1/me'),
    api<{ packs: PackProgress[] }>('/api/v1/progress'),
  ]);

  // A learner who has not opened anything yet has no enrollment, so the catalogue is the fallback.
  const enrolled = overview.packs;
  const catalogue = enrolled.length > 0 ? [] : (await api<{ packs: PackProgress['pack'][] }>('/api/v1/packs')).packs;

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
      {enrolled.length === 0 && catalogue.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm">{t.noPacks}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.noPacksHint}</p>
          </CardContent>
        </Card>
      ) : null}

      {catalogue.map((pack) => (
        <Card key={pack.packId}>
          <CardHeader>
            <CardTitle>{pickTitle(pack.title, locale)}</CardTitle>
            {pack.description ? <p className="text-sm text-muted-foreground">{pickTitle(pack.description, locale)}</p> : null}
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/${locale}/packs/${pack.packId}`}>
                {t.startPack} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ))}

      {enrolled.map((entry) => {
        const block = entry.currentBlock;
        const progress = entry.blockProgress;
        const next = progress?.nextLessonOrder ?? null;
        const decks = entry.decks;

        return (
          <div key={entry.pack.packId} className="space-y-5">
            {/* Summary before detail — the three figures a learner checks daily. */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                icon={<Check className="h-4 w-4 text-success" />}
                value={`${progress?.completed ?? 0}/${progress?.lessonCount ?? 0}`}
                label={t.lessonsDone}
              />
              <Stat
                icon={<Sparkles className="h-4 w-4 text-primary" />}
                value={`${decks.terms.mastered}/${decks.terms.total}`}
                label={dictionary.progress.words.toLowerCase()}
              />
              <Stat
                icon={<Target className="h-4 w-4 text-muted-foreground" />}
                value={block?.level ?? '—'}
                label={dictionary.common.level.toLowerCase()}
              />
            </div>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <CardTitle>{pickTitle(entry.pack.title, locale)}</CardTitle>
                  {block ? (
                    <Pill>
                      {dictionary.common.block} {block.order}
                    </Pill>
                  ) : null}
                </div>
                {block ? <p className="text-sm text-muted-foreground">{pickTitle(block.title, locale)}</p> : null}
              </CardHeader>

              <CardContent className="space-y-4">
                {progress ? (
                  <div>
                    <Meter value={progress.completed} total={progress.lessonCount} />
                    {progress.pendingOrders.length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {dictionary.pack.waitingOnCoach}: {dictionary.common.lesson} {progress.pendingOrders.join(', ')}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {block && next ? (
                    <Button asChild>
                      <Link href={`/${locale}/lessons/${block.blockId}.l${next}`}>
                        {t.continueLesson} {next} <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild variant="outline">
                    <Link href={`/${locale}/packs/${entry.pack.packId}`}>
                      <BookOpen className="h-4 w-4" /> {t.openPack}
                    </Link>
                  </Button>
                  {block ? (
                    <>
                      <Button asChild variant="ghost">
                        <Link href={`/${locale}/drills/words?blockId=${block.blockId}`}>
                          <Sparkles className="h-4 w-4" /> {dictionary.nav.words}
                        </Link>
                      </Button>
                      <Button asChild variant="ghost">
                        <Link href={`/${locale}/drills/sentences?blockId=${block.blockId}`}>
                          <Puzzle className="h-4 w-4" /> {dictionary.nav.sentences}
                        </Link>
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })}
    </PageShell>
  );
}
