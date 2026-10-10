import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getDictionary } from '@/i18n/dictionaries';
import type { Block, Pack } from '@/lib/types';
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
 * This was `/drills/words`; that address redirects here with its query intact.
 */
export default async function FlashcardsPage({ searchParams }: { searchParams: Promise<{ blockId?: string; view?: string }> }) {
  const { blockId, view } = await searchParams;
  if (!blockId) redirect('/');

  const dictionary = getDictionary();
  const { block } = await api<{ block: Block }>(`/api/v1/blocks/${blockId}`);
  const { pack } = await api<{ pack: Pack }>(`/api/v1/packs/${block.packId}`);
  const adding = view === 'add';
  const base = `/flashcards?blockId=${encodeURIComponent(blockId)}`;

  const tab = (href: string, active: boolean, label: string) => (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm transition-colors',
        active ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );

  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-6 pt-5 md:px-8">
        <nav aria-label={dictionary.nav.words} className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {tab(base, !adding, dictionary.flashcards.title)}
          {tab(`${base}&view=add`, adding, dictionary.assist.addWords)}
        </nav>
      </div>
      {adding ? (
        <div className="mx-auto w-full max-w-3xl space-y-5 p-6 md:p-8">
          <WordAssist
            blockId={blockId}
            contentLanguage={pack.contentLanguage}
            translationLanguage={pack.translationLanguage}
            dictionary={dictionary}
          />
        </div>
      ) : (
        <Flashcards
          blockId={blockId}
          contentLanguage={pack.contentLanguage}
          translationLanguage={pack.translationLanguage}
          grading={pack.flashcards?.grading ?? 'typed'}
          dictionary={dictionary}
          addHref={`${base}&view=add`}
        />
      )}
    </>
  );
}
