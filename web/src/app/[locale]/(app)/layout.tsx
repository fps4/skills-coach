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
 * It also carries what the shell needs to know about the learner's skills — what each one is called,
 * which surfaces it offers and what material it actually holds (ADR-0009, ADR-0019) — and how the
 * learner has arranged them into folders (ADR-0021). The first comes from the progress call this
 * layout was already making; the menu is one more small read.
 */

import { Suspense, type ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/app-header';
import { LearnerRail, type RailPack } from '@/components/learner-rail';
import { SkillHeader } from '@/components/skill-header';
import { PackPaletteSync } from '@/components/pack-palette-sync';
import { PACK_HEADER } from '@/lib/pack-scope';
import type { Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { api } from '@/lib/api';
import { currentToken } from '@/lib/auth';
import type { LearnerMenu, PackProgress } from '@/lib/types';

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
        title: entry.pack.title,
        icon: entry.pack.presentation?.icon,
        currentBlockId: entry.currentBlock?.blockId ?? null,
        // Words a coach has filled in that wait on the learner (ADR-0023).
        ready: entry.wordRequests?.ready ?? 0,
        surfaces: entry.pack.presentation?.surfaces,
        // Pack-wide totals, which is what these already are: the deck summaries are counted per pack
        // and per learner, never per block, so what the rail offers cannot flicker as the learner
        // moves through the program (ADR-0019).
        material: {
          // Blocks with lessons in them. A skill that is only a deck has one block holding its words
          // and no lessons, and must not grow a Lessons tab for it (ADR-0022).
          blocks: entry.blocks.filter(({ block }) => block.lessonCount > 0).length,
          terms: entry.decks.terms.total,
          wordOrder: entry.decks.wordOrder.total,
          quiz: entry.decks.quiz.total,
          reading: entry.reading?.total ?? 0,
        },
      })),
      palettes: Object.fromEntries(packs.map((entry) => [entry.pack.packId, entry.pack.presentation?.palette])),
    };
  } catch {
    return { packs: [], palettes: {} };
  }
}

/** The learner's folders. Soft for the same reason: without it every skill simply shows, loose. */
async function learnerMenu(): Promise<LearnerMenu | null> {
  try {
    return (await api<{ menu: LearnerMenu }>('/api/v1/me/menu')).menu;
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
  const [{ packs, palettes }, menu] = await Promise.all([railPacks(), learnerMenu()]);

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
          <LearnerRail locale={locale} dictionary={dictionary} packs={packs} menu={menu} />
        </Suspense>
        <main className="min-w-0 flex-1">
          <Suspense fallback={null}>
            <SkillHeader locale={locale} dictionary={dictionary} packs={packs} menu={menu} />
          </Suspense>
          {children}
        </main>
      </div>
    </>
  );
}
