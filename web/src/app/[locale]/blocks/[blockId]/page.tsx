/**
 * A block: its lessons, their state, and the two practice decks.
 */

import Link from 'next/link';
import { api } from '@/lib/api';
import { pickTitle, percent } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Block, BlockProgress, DeckSummary, LessonSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface BlockResponse {
  block: Block;
  progress: BlockProgress;
  decks: { terms: DeckSummary; wordOrder: DeckSummary };
  lessons: LessonSummary[];
}

function DeckCard({
  title,
  summary,
  href,
  masteredLabel,
}: {
  title: string;
  summary: DeckSummary;
  href: string;
  masteredLabel: string;
}) {
  if (summary.total === 0) return null;
  return (
    <Link href={href} className="card block transition hover:border-accent">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <span className="text-sm tabular-nums text-muted">
          {summary.mastered}/{summary.total} {masteredLabel}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-accent transition-all" style={{ width: `${percent(summary.mastered, summary.total)}%` }} />
      </div>
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
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted">
          {dictionary.common.block} {data.block.order}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{pickTitle(data.block.title, locale)}</h1>
        {data.block.milestone ? <p className="mt-2 max-w-prose text-muted">{data.block.milestone}</p> : null}
        {data.block.focus?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.block.focus.map((item) => (
              <span key={item} className="chip text-muted">
                {item.replace(/^category:/, '')}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{dictionary.block.practice}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeckCard
            title={dictionary.block.wordDeck}
            summary={data.decks.terms}
            href={`/${locale}/drills/words?blockId=${blockId}`}
            masteredLabel={dictionary.block.mastered}
          />
          <DeckCard
            title={dictionary.block.sentenceDeck}
            summary={data.decks.wordOrder}
            href={`/${locale}/drills/sentences?blockId=${blockId}`}
            masteredLabel={dictionary.block.mastered}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{dictionary.block.lessons}</h2>
        <ol className="space-y-2">
          {data.lessons.map((lesson) => {
            const state = corrected.has(lesson.order)
              ? dictionary.pack.complete
              : pending.has(lesson.order)
                ? dictionary.pack.waitingOnCoach
                : null;

            return (
              <li key={lesson.lessonId}>
                <Link
                  href={`/${locale}/lessons/${lesson.lessonId}`}
                  className="card flex flex-wrap items-center gap-x-4 gap-y-1 transition hover:border-accent"
                >
                  <span className="w-8 shrink-0 tabular-nums text-muted">{lesson.order}</span>
                  <span className="font-medium">{pickTitle(lesson.title, locale)}</span>
                  {lesson.estimatedMinutes ? (
                    <span className="text-sm text-muted">
                      {lesson.estimatedMinutes} {dictionary.common.minutes}
                    </span>
                  ) : null}
                  {state ? <span className="ml-auto chip text-muted">{state}</span> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
