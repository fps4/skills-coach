/**
 * A block: the two practice decks, then its lessons.
 *
 * Practice sits above the lessons because it is the daily habit and a lesson is the weekly one.
 */

import Link from 'next/link';
import { Check, Clock, Puzzle, Sparkles } from 'lucide-react';

import { Meter, PageShell, Pill } from '@/components/atoms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { pickTitle } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Block, BlockProgress, DeckSummary, LessonSummary } from '@/lib/types';
import type { Dictionary } from '@/i18n/dictionaries';

export const dynamic = 'force-dynamic';

interface BlockResponse {
  block: Block;
  progress: BlockProgress;
  decks: { terms: DeckSummary; wordOrder: DeckSummary };
  lessons: LessonSummary[];
}

function DeckCard({
  title,
  icon,
  summary,
  href,
  dictionary,
}: {
  title: string;
  icon: React.ReactNode;
  summary: DeckSummary;
  href: string;
  dictionary: Dictionary;
}) {
  if (summary.total === 0) return null;

  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              {icon}
              {title}
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {summary.mastered}/{summary.total} {dictionary.block.mastered}
            </span>
          </div>
          {/* Two meters, as the trainers had: what cleared the first direction, and what is done. */}
          <div className="space-y-1">
            <Meter value={summary.stage1Cleared} total={summary.total} />
            <Meter value={summary.mastered} total={summary.total} tone="success" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function BlockPage({ params }: { params: Promise<{ locale: Locale; blockId: string }> }) {
  const { locale, blockId } = await params;
  const dictionary = getDictionary(locale);
  const data = await api<BlockResponse>(`/api/v1/blocks/${blockId}`);

  const corrected = new Set(data.progress.correctedOrders);
  const pending = new Set(data.progress.pendingOrders);

  return (
    <PageShell
      title={pickTitle(data.block.title, locale)}
      subtitle={
        <>
          {dictionary.common.block} {data.block.order}
          {data.block.level ? ` · ${data.block.level}` : ''}
        </>
      }
    >
      {data.block.milestone ? <p className="max-w-prose text-sm text-muted-foreground">{data.block.milestone}</p> : null}

      {data.block.focus?.length ? (
        <div className="flex flex-wrap gap-2">
          {data.block.focus.map((item) => (
            <Pill key={item}>{item.replace(/^category:/, '')}</Pill>
          ))}
        </div>
      ) : null}

      <section className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{dictionary.block.practice}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeckCard
            title={dictionary.block.wordDeck}
            icon={<Sparkles className="h-4 w-4 text-primary" />}
            summary={data.decks.terms}
            href={`/${locale}/drills/words?blockId=${blockId}`}
            dictionary={dictionary}
          />
          <DeckCard
            title={dictionary.block.sentenceDeck}
            icon={<Puzzle className="h-4 w-4 text-primary" />}
            summary={data.decks.wordOrder}
            href={`/${locale}/drills/sentences?blockId=${blockId}`}
            dictionary={dictionary}
          />
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{dictionary.block.lessons}</p>
        <div className="space-y-2">
          {data.lessons.map((lesson) => {
            const isDone = corrected.has(lesson.order);
            const isPending = pending.has(lesson.order);

            return (
              <Link key={lesson.lessonId} href={`/${locale}/lessons/${lesson.lessonId}`} className="block">
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
                    <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{lesson.order}</span>
                    <span className="font-medium">{pickTitle(lesson.title, locale)}</span>
                    {lesson.estimatedMinutes ? (
                      <span className="text-sm text-muted-foreground">
                        {lesson.estimatedMinutes} {dictionary.common.minutes}
                      </span>
                    ) : null}
                    {isDone ? (
                      <Pill tone="success" className="ml-auto">
                        <Check className="mr-1 h-3 w-3" /> {dictionary.pack.complete}
                      </Pill>
                    ) : isPending ? (
                      <Pill tone="primary" className="ml-auto">
                        <Clock className="mr-1 h-3 w-3" /> {dictionary.pack.waitingOnCoach}
                      </Pill>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </PageShell>
  );
}
