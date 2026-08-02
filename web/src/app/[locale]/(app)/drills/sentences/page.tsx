import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Block, Pack } from '@/lib/types';
import { SentenceDrill } from '@/components/sentence-drill';

export const dynamic = 'force-dynamic';

export default async function SentenceDrillPage({
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

  return <SentenceDrill blockId={blockId} contentLanguage={pack.contentLanguage} dictionary={dictionary} />;
}
