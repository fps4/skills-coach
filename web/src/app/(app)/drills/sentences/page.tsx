import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { getDictionary } from '@/i18n/dictionaries';
import type { Block, Pack } from '@/lib/types';
import { SentenceDrill } from '@/components/sentence-drill';

export const dynamic = 'force-dynamic';

export default async function SentenceDrillPage({ searchParams }: { searchParams: Promise<{ blockId?: string }> }) {
  const { blockId } = await searchParams;
  if (!blockId) redirect('/');

  const dictionary = getDictionary();
  const { block } = await api<{ block: Block }>(`/api/v1/blocks/${blockId}`);
  const { pack } = await api<{ pack: Pack }>(`/api/v1/packs/${block.packId}`);

  return <SentenceDrill blockId={blockId} contentLanguage={pack.contentLanguage} dictionary={dictionary} />;
}
