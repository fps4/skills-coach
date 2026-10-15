import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { getDictionary } from '@/i18n/dictionaries';
import type { Block, Pack } from '@/lib/types';
import { PageShell } from '@/components/atoms';
import { Flashcards } from '@/components/flashcards';
import { WordAssist } from '@/components/word-assist';

export const dynamic = 'force-dynamic';

/**
 * Flashcards: practising a deck, and adding to it (ADR-0023, ADR-0027).
 *
 * Two views of one deck, switched by `?view=add` so each is a link a learner can come back to. How
 * a card is answered — typed or self-graded — is the skill's, read off its manifest here and handed
 * down; the surface never decides it.
 *
 * The switch between them is a button beside the deck's controls and a back link here, not a row of
 * its own: on a laptop screen that row was what pushed the card under the fold.
 *
 * This was `/drills/words`; that address redirects here with its query intact.
 */
export default async function FlashcardsPage({ searchParams }: { searchParams: Promise<{ blockId?: string; view?: string }> }) {
  const { blockId, view } = await searchParams;
  if (!blockId) redirect('/');

  const dictionary = getDictionary();
  const { block } = await api<{ block: Block }>(`/api/v1/blocks/${blockId}`);
  const { pack } = await api<{ pack: Pack }>(`/api/v1/packs/${block.packId}`);
  const base = `/flashcards?blockId=${encodeURIComponent(blockId)}`;

  if (view === 'add') {
    return (
      <PageShell
        tab
        title={dictionary.assist.addWords}
        back={
          <Link href={base} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {dictionary.flashcards.title}
          </Link>
        }
      >
        <WordAssist
          blockId={blockId}
          contentLanguage={pack.contentLanguage}
          translationLanguage={pack.translationLanguage}
          dictionary={dictionary}
        />
      </PageShell>
    );
  }

  return (
    <Flashcards
      blockId={blockId}
      contentLanguage={pack.contentLanguage}
      translationLanguage={pack.translationLanguage}
      grading={pack.flashcards?.grading ?? 'typed'}
      dictionary={dictionary}
      addHref={`${base}&view=add`}
    />
  );
}
