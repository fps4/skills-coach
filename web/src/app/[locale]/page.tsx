/**
 * Home: where the learner left off.
 *
 * The one question this page answers is "what do I do now" — which is a lesson number, never a
 * date. Everything else is secondary.
 */

import Link from 'next/link';
import { api } from '@/lib/api';
import { pickTitle, percent } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Learner, Enrollment, PackProgress } from '@/lib/types';

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
  const packs = overview.packs.length > 0 ? overview.packs : null;
  const catalogue = packs ? [] : (await api<{ packs: PackProgress['pack'][] }>('/api/v1/packs')).packs;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t.title}
          {learner.displayName ? <span className="text-muted">, {learner.displayName}</span> : null}
        </h1>
        <p className="mt-1 text-muted">{t.subtitle}</p>
      </header>

      {packs ? (
        <div className="space-y-4">
          {packs.map((entry) => {
            const block = entry.currentBlock;
            const progress = entry.blockProgress;
            const nextLesson = progress?.nextLessonOrder ?? null;

            return (
              <article key={entry.pack.packId} className="card">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">{pickTitle(entry.pack.title, locale)}</h2>
                  {block?.level ? <span className="chip text-muted">{block.level}</span> : null}
                </div>

                {block ? (
                  <p className="mt-1 text-sm text-muted">
                    {dictionary.common.block} {block.order} · {pickTitle(block.title, locale)}
                  </p>
                ) : null}

                {progress ? (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm text-muted">
                      <span>
                        {progress.completed}/{progress.lessonCount} {t.lessonsDone}
                      </span>
                      <span>{percent(progress.completed, progress.lessonCount)}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{ width: `${percent(progress.completed, progress.lessonCount)}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-2">
                  {block && nextLesson ? (
                    <Link href={`/${locale}/lessons/${block.blockId}.l${nextLesson}`} className="btn-primary">
                      {t.continueLesson} {nextLesson}
                    </Link>
                  ) : null}
                  <Link href={`/${locale}/packs/${entry.pack.packId}`} className="btn-secondary">
                    {t.openPack}
                  </Link>
                  {block ? (
                    <>
                      <Link href={`/${locale}/drills/words?blockId=${block.blockId}`} className="btn-ghost">
                        {dictionary.nav.words}
                      </Link>
                      <Link href={`/${locale}/drills/sentences?blockId=${block.blockId}`} className="btn-ghost">
                        {dictionary.nav.sentences}
                      </Link>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : catalogue.length > 0 ? (
        <div className="space-y-4">
          {catalogue.map((pack) => (
            <article key={pack.packId} className="card">
              <h2 className="text-lg font-semibold tracking-tight">{pickTitle(pack.title, locale)}</h2>
              {pack.description ? <p className="mt-1 text-muted">{pickTitle(pack.description, locale)}</p> : null}
              <Link href={`/${locale}/packs/${pack.packId}`} className="btn-primary mt-4">
                {t.startPack}
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="card">
          <p>{t.noPacks}</p>
          <p className="mt-1 text-sm text-muted">{t.noPacksHint}</p>
        </div>
      )}
    </div>
  );
}
