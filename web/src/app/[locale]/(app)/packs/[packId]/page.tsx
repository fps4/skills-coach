/**
 * A pack: its blocks, and how far the learner is through each.
 *
 * Opening this page is what enrols a learner — there is nothing to sign up for.
 */

import Link from 'next/link';
import { Check, CircleDashed, Clock } from 'lucide-react';

import { Meter, PageShell, Pill } from '@/components/atoms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { pickTitle } from '@/lib/text';
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
    <PageShell
      title={pickTitle(progress.pack.title, locale)}
      subtitle={progress.pack.description ? pickTitle(progress.pack.description, locale) : undefined}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{dictionary.pack.blocks}</p>

      <div className="space-y-3">
        {progress.blocks.map(({ block, progress: blockProgress }) => {
          const done = blockProgress.complete;
          const started = blockProgress.completed > 0 || blockProgress.pendingOrders.length > 0;

          return (
            <Card key={block.blockId} className="transition-colors hover:border-primary/50">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <CardTitle>
                    <Link href={`/${locale}/blocks/${block.blockId}`} className="hover:text-primary">
                      {dictionary.common.block} {block.order} · {pickTitle(block.title, locale)}
                    </Link>
                  </CardTitle>
                  <Pill tone={done ? 'success' : started ? 'primary' : 'muted'}>
                    {done ? (
                      <>
                        <Check className="mr-1 h-3 w-3" /> {dictionary.pack.complete}
                      </>
                    ) : started ? (
                      <>
                        <Clock className="mr-1 h-3 w-3" /> {dictionary.pack.inProgress}
                      </>
                    ) : (
                      <>
                        <CircleDashed className="mr-1 h-3 w-3" /> {dictionary.pack.notStarted}
                      </>
                    )}
                  </Pill>
                </div>
                {block.level ? <p className="text-sm text-muted-foreground">{block.level}</p> : null}
              </CardHeader>

              <CardContent className="space-y-3">
                {block.milestone ? (
                  <p className="max-w-prose text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{dictionary.pack.milestone}: </span>
                    {block.milestone}
                  </p>
                ) : null}

                <div className="flex items-center gap-3">
                  <Meter
                    value={blockProgress.completed}
                    total={blockProgress.lessonCount}
                    tone={done ? 'success' : 'primary'}
                    className="flex-1"
                  />
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {blockProgress.completed}/{blockProgress.lessonCount}
                  </span>
                </div>

                {blockProgress.pendingOrders.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {dictionary.pack.waitingOnCoach}: {dictionary.common.lesson} {blockProgress.pendingOrders.join(', ')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}
