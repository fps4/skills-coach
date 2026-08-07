/**
 * The signed-in shell: header, rail, content.
 *
 * This layout is the structural gate. Every authenticated route is a child of it and nothing else
 * renders it, so the rail cannot appear on the sign-in screen — not briefly, not at all. The
 * middleware still redirects first, on a cheap `exp` decode; this is the check that runs with the
 * cookie actually in hand, and it awaits that answer *before* returning any chrome, so there is no
 * indeterminate state for the browser to paint. A token that expired between the two lands here as
 * "no session" and is sent to sign in rather than rendering a shell around a page that will 401.
 *
 * It also carries what the shell needs to know about the learner's packs — which surfaces each one
 * offers and how full its decks are (ADR-0009). That comes from the progress call this layout was
 * already making, so per-pack chrome costs no extra request.
 */

import { Suspense, type ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/app-header';
import { LearnerRail, type RailPack } from '@/components/learner-rail';
import { PackPaletteSync } from '@/components/pack-palette-sync';
import { PACK_HEADER } from '@/lib/pack-scope';
import type { Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { api } from '@/lib/api';
import { currentToken } from '@/lib/auth';
import type { PackProgress } from '@/lib/types';

/**
 * Everything the shell needs about the learner's packs, from one call.
 *
 * It fails softly, because a rail without its drill links is a smaller problem than a shell that
 * refuses to render.
 */
async function railPacks(): Promise<{ packs: RailPack[]; palettes: Record<string, string | undefined> }> {
  try {
    const { packs } = await api<{ packs: PackProgress[] }>('/api/v1/progress');
    return {
      packs: packs.map((entry) => ({
        packId: entry.pack.packId,
        currentBlockId: entry.currentBlock?.blockId ?? null,
        surfaces: entry.pack.presentation?.surfaces,
        decks: {
          terms: entry.decks.terms.total,
          wordOrder: entry.decks.wordOrder.total,
          quiz: entry.decks.quiz.total,
        },
      })),
      palettes: Object.fromEntries(packs.map((entry) => [entry.pack.packId, entry.pack.presentation?.palette])),
    };
  } catch {
    return { packs: [], palettes: {} };
  }
}

export default async function AppLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  // Narrowing is safe here: the locale layout above has already sent anything else to `notFound()`.
  const { locale } = (await params) as { locale: Locale };

  // The layout has no pathname, so it cannot preserve `?next=`. The middleware is what normally
  // sends someone here with it; this is the fallback for a session that ran out mid-visit.
  if (!(await currentToken())) redirect(`/${locale}/login`);

  const dictionary = getDictionary(locale);
  const { packs, palettes } = await railPacks();

  // The middleware resolved the pack from the URL before render, which is the only way to get the
  // right hue into the *first* paint — this layout sits above the segment that names the pack.
  // After that, `PackPaletteSync` keeps it in step across client navigations.
  const scoped = (await headers()).get(PACK_HEADER);
  const packPalette = scoped ? palettes[scoped] : undefined;
  const firstPaint = packPalette
    ? `(function(){try{if(!localStorage.getItem('sc.palette'))document.documentElement.setAttribute('data-palette','${packPalette}');}catch(e){}})();`
    : null;

  return (
    <>
      {firstPaint ? <script dangerouslySetInnerHTML={{ __html: firstPaint }} /> : null}
      <AppHeader locale={locale} dictionary={dictionary} />
      <div className="flex min-h-[calc(100dvh-57px)]">
        {/* Both read the query string, which Next requires to be suspended so a statically
            prerendered page still has something to send. */}
        <Suspense fallback={null}>
          <PackPaletteSync palettes={palettes} />
          <LearnerRail locale={locale} dictionary={dictionary} packs={packs} />
        </Suspense>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
