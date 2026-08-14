'use client';

/**
 * The learner rail.
 *
 * Two levels, and only two (ADR-0018): a pack, then what that pack offers. The learner's started
 * packs are the top level — each one named as the pack names itself, landing on its own progress —
 * and the surfaces of the pack currently in scope sit indented beneath it. Nothing else nests.
 *
 * Which surfaces appear is three questions, asked in `lib/pack-scope.ts` and answered nowhere else
 * (ADR-0019): does the manifest *offer* it, does the pack *have* any material of that kind, and is
 * there something to open *right now*. The first two decide whether an item exists — a pack with no
 * questions never shows a practice test — and the third decides whether it is a link or greyed out.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LayoutGrid, Library } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { SURFACES, packIcon, packIdFromUrl, packLanding, visibleSurfaces, type PackMaterial } from '@/lib/pack-scope';
import { pickTitle } from '@/lib/text';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import type { PackSurface, TitleText } from '@/lib/types';

/** What the shell knows about one of the learner's packs. */
export interface RailPack {
  packId: string;
  /** The pack's own name, which is what the learner sees at the top level. */
  title: TitleText;
  /** A key into the icon registry; unknown ones fall back rather than leaving a gap (ADR-0009). */
  icon?: string;
  /** The block they are working through in that pack, when they have one. */
  currentBlockId: string | null;
  /** What the manifest offers; undefined means everything (ADR-0009). */
  surfaces?: PackSurface[];
  /** What the pack actually holds, which is what decides an item is there at all (ADR-0019). */
  material: PackMaterial;
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

  return (
    <nav
      aria-label={t.sections}
      className="hidden w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3 md:flex"
    >
      <RailItem href={home} icon={<LayoutGrid className="h-4 w-4" />} active={isActive(home, true)}>
        {t.home}
      </RailItem>

      {/*
        Only packs the learner has started, because those are the ones this list is fetched from.
        Choosing a *new* one is the landing page's job, and will be a marketplace of its own before
        long — a rail that also listed everything on offer would be answering both questions at once.
      */}
      {packs.map((pack) => {
        const landing = packLanding(locale, pack.packId);
        const inScope = pack.packId === scoped;
        const Icon = packIcon(pack.icon);

        return (
          <div key={pack.packId} className="contents">
            <RailItem
              href={landing}
              icon={<Icon className="h-4 w-4" />}
              active={inScope && isActive(`/${locale}/progress`)}
              open={inScope}
            >
              {/* The pack's own name — localized metadata, resolved here, never translated (ADR-0005). */}
              {pickTitle(pack.title, locale)}
            </RailItem>

            {inScope ? <PackSurfaces locale={locale} dictionary={dictionary} pack={pack} isActive={isActive} /> : null}
          </div>
        );
      })}

      {/*
        The wiki is the platform's, not a pack's, so it sits beside the packs rather than under one.
        It is on its way to becoming a pack of its own; until it is, this is the one item here that
        no manifest declares.
      */}
      <RailItem href={`/${locale}/wiki`} icon={<Library className="h-4 w-4" />} active={isActive(`/${locale}/wiki`)}>
        {t.wiki}
      </RailItem>

      {!active?.currentBlockId ? <p className="mt-auto px-2.5 pt-3 text-xs text-muted-foreground">{t.noBlockHint}</p> : null}
    </nav>
  );
}

/** What the pack in scope offers, one level under it. */
function PackSurfaces({
  locale,
  dictionary,
  pack,
  isActive,
}: {
  locale: Locale;
  dictionary: Dictionary;
  pack: RailPack;
  isActive: (href: string, exact?: boolean) => boolean;
}) {
  const context = { locale, packId: pack.packId, currentBlockId: pack.currentBlockId };
  const surfaces = visibleSurfaces(pack.surfaces, pack.material);

  // A pack with nothing under it yet — no blocks, no library — gets no rule and no empty box.
  if (surfaces.length === 0) return null;

  return (
    <div className="my-0.5 ml-3.5 space-y-0.5 border-l border-border pl-2">
      {surfaces.map((id) => {
        const surface = SURFACES[id];
        const Icon = surface.icon;
        const href = surface.href(context);

        return (
          <RailItem
            key={id}
            sub
            href={href}
            icon={<Icon className="h-4 w-4" />}
            active={href ? isActive(href.split('?')[0] as string) : false}
          >
            {dictionary.nav[surface.labelKey]}
          </RailItem>
        );
      })}
    </div>
  );
}

function RailItem({
  href,
  icon,
  active,
  open,
  sub,
  children,
}: {
  href: string | null;
  icon: ReactNode;
  active: boolean;
  /** The pack this URL is inside, when it is not itself the page on screen. */
  open?: boolean;
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
      className={cn(
        shape,
        active
          ? 'bg-muted font-medium text-foreground'
          : open
            ? 'font-medium text-foreground hover:bg-muted/60'
            : 'text-muted-foreground hover:bg-muted/60',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
    </Link>
  );
}
