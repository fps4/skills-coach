/**
 * The signed-in shell: header, rail, content.
 *
 * This layout is the structural gate. Every authenticated route is a child of it and nothing else
 * renders it, so the rail cannot appear on the sign-in screen — not briefly, not at all. The
 * middleware still redirects first, on a cheap `exp` decode; this is the check that runs with the
 * cookie actually in hand, and it awaits that answer *before* returning any chrome, so there is no
 * indeterminate state for the browser to paint. A token that expired between the two lands here as
 * "no session" and is sent to sign in rather than rendering a shell around a page that will 401.
 */

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/app-header';
import { LearnerRail } from '@/components/learner-rail';
import type { Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { api } from '@/lib/api';
import { currentToken } from '@/lib/auth';
import type { PackProgress } from '@/lib/types';

/**
 * The block the rail should point its drills at. Resolved here so every page shares one lookup; it
 * fails softly, because a rail without its drill links is a smaller problem than a shell that
 * refuses to render.
 */
async function currentBlockId(): Promise<string | null> {
  try {
    const { packs } = await api<{ packs: PackProgress[] }>('/api/v1/progress');
    return packs.find((entry) => entry.currentBlock)?.currentBlock?.blockId ?? null;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  // Narrowing is safe here: the locale layout above has already sent anything else to `notFound()`.
  const { locale } = (await params) as { locale: Locale };

  // The layout has no pathname, so it cannot preserve `?next=`. The middleware is what normally
  // sends someone here with it; this is the fallback for a session that ran out mid-visit.
  if (!(await currentToken())) redirect(`/${locale}/login`);

  const dictionary = getDictionary(locale);
  const blockId = await currentBlockId();

  return (
    <>
      <AppHeader locale={locale} dictionary={dictionary} />
      <div className="flex min-h-[calc(100dvh-57px)]">
        <LearnerRail locale={locale} dictionary={dictionary} currentBlockId={blockId} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
