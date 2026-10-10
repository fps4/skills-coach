import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The word trainer's old address. Flashcards live at `/flashcards` now (ADR-0027); a bookmark, a
 * link in an old message or a tab left open still lands on the same deck, query and all.
 */
export default async function OldWordTrainer({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
  }
  const rendered = params.toString();
  redirect(rendered ? `/flashcards?${rendered}` : '/flashcards');
}
