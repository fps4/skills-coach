'use client';

/**
 * The learner rail.
 *
 * The pack tiles, then whatever the pack in scope offers, then progress. Two independent things
 * decide an item (ADR-0009): the manifest's `surfaces` say what this pack *offers* — a pack with no
 * word-order material never shows the puzzle at all — and the live deck counts say whether there is
 * anything to practise *today*. Offered-but-empty renders disabled rather than disappearing, because
 * a rail whose items come and go is harder to learn than one that explains itself.
 *
 * Outside a pack the rail shows the platform's full set, which is exactly how it looked before a
 * pack could declare anything.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { SURFACES, packIdFromUrl, visibleSurfaces, type DeckTotals } from '@/lib/pack-scope';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import type { PackSurface } from '@/lib/types';

/** What the shell knows about one of the learner's packs. */
export interface RailPack {
  packId: string;
  /** The block they are working through in that pack, when they have one. */
  currentBlockId: string | null;
  surfaces?: PackSurface[];
  decks: DeckTotals;
}

interface Props {
  locale: Locale;
  dictionary: Dictionary;
  packs: RailPack[];
}

export function LearnerRail({ locale, dictionary, packs }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = dictionary.nav;

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`);

  const home = `/${locale}`;

  // The pack this URL is inside, if any. No fallback to "their first pack": a pack's surfaces
  // belong to that pack, and offering them before one is chosen is offering something that does
  // not exist yet.
  const scoped = packIdFromUrl(pathname, searchParams);
  const active = scoped ? (packs.find((entry) => entry.packId === scoped) ?? null) : null;

  const context = {
    locale,
    currentBlockId: active?.currentBlockId ?? null,
    decks: active?.decks ?? { terms: 0, wordOrder: 0 },
  };

  // A pack the learner has not opened yet is not in `packs`, so its surfaces fall back to the full
  // set: it is a real pack, there is simply no progress for it until opening the page enrols them.
  const offered = visibleSurfaces(Boolean(scoped), active?.surfaces);

  return (
    <nav
      aria-label={t.sections}
      className="hidden w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3 md:flex"
    >
      <RailItem href={home} icon={<LayoutGrid className="h-4 w-4" />} active={isActive(home, true)}>
        {t.home}
      </RailItem>

      {group(offered).map((run, index) => {
        const items = run.ids.map((id) => {
          const surface = SURFACES[id];
          const Icon = surface.icon;
          const href = surface.href(context);
          return (
            <RailItem
              key={id}
              sub={run.sub}
              href={href}
              icon={<Icon className="h-4 w-4" />}
              active={href ? isActive(href.split('?')[0] as string) : false}
            >
              {t[surface.labelKey]}
            </RailItem>
          );
        });

        return run.sub ? (
          <div key={index} className="my-0.5 ml-3.5 space-y-0.5 border-l border-border pl-2">
            {items}
          </div>
        ) : (
          items
        );
      })}

      {!context.currentBlockId ? <p className="mt-auto px-2.5 pt-3 text-xs text-muted-foreground">{t.noBlockHint}</p> : null}
    </nav>
  );
}

/** Consecutive sub-surfaces share one indent rule, so they are rendered as a run rather than singly. */
function group(ids: PackSurface[]): { sub: boolean; ids: PackSurface[] }[] {
  const runs: { sub: boolean; ids: PackSurface[] }[] = [];
  for (const id of ids) {
    const sub = Boolean(SURFACES[id].sub);
    const last = runs[runs.length - 1];
    if (last && last.sub === sub) last.ids.push(id);
    else runs.push({ sub, ids: [id] });
  }
  return runs;
}

function RailItem({
  href,
  icon,
  active,
  sub,
  children,
}: {
  href: string | null;
  icon: ReactNode;
  active: boolean;
  sub?: boolean;
  children: ReactNode;
}) {
  const shape = cn(
    'flex items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors',
    sub ? 'py-1.5 text-[13px]' : 'py-2 text-sm',
  );

  if (!href) {
    return (
      <span className={cn(shape, 'cursor-not-allowed text-muted-foreground/50')} aria-disabled="true">
        {icon}
        <span className="flex-1">{children}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(shape, active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60')}
    >
      {icon}
      <span className="flex-1">{children}</span>
    </Link>
  );
}
