/**
 * A pack: its blocks, and how far the learner is through each.
 *
 * Opening this page is what enrols a learner in the pack — there is nothing to sign up for.
 */

import Link from 'next/link';
import { api } from '@/lib/api';
import { pickTitle, percent } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Block, PackProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PackPage({ params }: { params: Promise<{ locale: Locale; packId: string }> }) {
  const { locale, packId } = await params;
  const dictionary = getDictionary(locale);

  // The GET is what enrols; the progress call then has an enrollment to report against.
  await api<{ pack: unknown; blocks: Block[] }>(`/api/v1/packs/${packId}`);
  const progress = await api<PackProgress>(`/api/v1/progress?packId=${packId}`);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{pickTitle(progress.pack.title, locale)}</h1>
        {progress.pack.description ? (
          <p className="mt-1 max-w-prose text-muted">{pickTitle(progress.pack.description, locale)}</p>
        ) : null}
      </header>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{dictionary.pack.blocks}</h2>

        {progress.blocks.map(({ block, progress: blockProgress }) => {
          const done = blockProgress.complete;
          const started = blockProgress.completed > 0 || blockProgress.pendingOrders.length > 0;

          return (
            <article key={block.blockId} className="card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold tracking-tight">
                  <Link href={`/${locale}/blocks/${block.blockId}`} className="hover:text-accent">
                    {dictionary.common.block} {block.order} · {pickTitle(block.title, locale)}
                  </Link>
                </h3>
                <span className="chip text-muted">
                  {done ? dictionary.pack.complete : started ? dictionary.pack.inProgress : dictionary.pack.notStarted}
                </span>
              </div>

              {block.level ? <p className="mt-1 text-sm text-muted">{block.level}</p> : null}
              {block.milestone ? (
                <p className="mt-2 max-w-prose text-sm text-muted">
                  <span className="font-medium text-ink">{dictionary.pack.milestone}: </span>
                  {block.milestone}
                </p>
              ) : null}

              <div className="mt-4 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${percent(blockProgress.completed, blockProgress.lessonCount)}%` }}
                  />
                </div>
                <span className="text-sm tabular-nums text-muted">
                  {blockProgress.completed}/{blockProgress.lessonCount}
                </span>
              </div>

              {blockProgress.pendingOrders.length > 0 ? (
                <p className="mt-2 text-sm text-warn">
                  {dictionary.pack.waitingOnCoach}: {dictionary.common.lesson} {blockProgress.pendingOrders.join(', ')}
                </p>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
