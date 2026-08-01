import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Block, Pack } from '@/lib/types';
import { WordDrill } from '@/components/word-drill';

export const dynamic = 'force-dynamic';

export default async function WordDrillPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ blockId?: string }>;
}) {
  const { locale } = await params;
  const { blockId } = await searchParams;
  if (!blockId) redirect(`/${locale}`);

  const dictionary = getDictionary(locale);
  const { block } = await api<{ block: Block }>(`/api/v1/blocks/${blockId}`);
  const { pack } = await api<{ pack: Pack }>(`/api/v1/packs/${block.packId}`);

  return (
    <WordDrill
      blockId={blockId}
      contentLanguage={pack.contentLanguage}
      translationLanguage={pack.translationLanguage}
      dictionary={dictionary}
    />
  );
}
