import { redirect } from 'next/navigation';

import { QuizRunner } from '@/components/quiz-runner';
import { api } from '@/lib/api';
import { getDictionary } from '@/i18n/dictionaries';
import type { Block, Pack } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function QuizPage({ searchParams }: { searchParams: Promise<{ blockId?: string }> }) {
  const { blockId } = await searchParams;
  if (!blockId) redirect('/');

  const dictionary = getDictionary();
  const { block } = await api<{ block: Block }>(`/api/v1/blocks/${blockId}`);
  const { pack } = await api<{ pack: Pack }>(`/api/v1/packs/${block.packId}`);

  return <QuizRunner blockId={blockId} contentLanguage={pack.contentLanguage} dictionary={dictionary} />;
}
