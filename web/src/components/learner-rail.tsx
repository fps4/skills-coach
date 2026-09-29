'use client';

/**
 * The learner rail: the learner's own menu of skills (ADR-0021).
 *
 * Two levels, and only two: a folder, then the skills in it. Folders and what shows are the
 * learner's — they file skills where they like and hide the ones they are not studying now. What a
 * skill *offers* is no longer in the rail at all; it is the row of tabs on that skill's own page
 * (`skill-header.tsx`), which is what freed the second level for folders.
 *
 * Which skill is in scope is still read off the URL (`lib/pack-scope.ts`), so the rail can mark it
 * and open the folder it sits in.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Folder, HardDriveDownload, LayoutGrid, Library, ListTree, Rows3 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { arrangeRail } from '@/lib/menu';
import { packIcon, packIdFromUrl, packLanding, type PackMaterial } from '@/lib/pack-scope';
import { pickTitle } from '@/lib/text';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import type { LearnerMenu, PackSurface, TitleText } from '@/lib/types';

/** What the shell knows about one of the learner's skills. */
export interface RailPack {
  packId: string;
  /** The skill's own name, which is what the learner sees. */
  title: TitleText;
  /** A key into the icon registry; unknown ones fall back rather than leaving a gap (ADR-0009). */
  icon?: string;
  /** The block they are working through in that skill, when they have one. */
  currentBlockId: string | null;
  /** What the manifest offers; undefined means everything (ADR-0009). */
  surfaces?: PackSurface[];
  /** What the skill actually holds, which is what decides a tab is there at all (ADR-0019). */
  material: PackMaterial;
}

interface Props {
  locale: Locale;
  dictionary: Dictionary;
  packs: RailPack[];
  /** Null when it could not be fetched — every skill then shows, loose. */
  menu: LearnerMenu | null;
}

/** Folders the learner closed. Remembered per browser: it is a view preference, not their menu. */
const CLOSED_KEY = 'sc.menu.closed';

function readClosed(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function LearnerRail({ locale, dictionary, packs, menu }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = dictionary.nav;

  const [closed, setClosed] = useState<Set<string>>(new Set());
  useEffect(() => setClosed(readClosed()), []);

  const toggle = (folderId: string): void => {
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify([...next]));
      } catch {
        // A browser that will not store it just forgets the choice on reload.
      }
      return next;
    });
  };

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const home = `/${locale}`;
  const skills = `/${locale}/skills`;
  const scoped = packIdFromUrl(pathname, searchParams);
  const arranged = arrangeRail(menu, packs);

  const skillItem = (pack: RailPack, nested: boolean) => {
    const Icon = packIcon(pack.icon);
    return (
      <RailItem
        key={pack.packId}
        href={packLanding(locale, pack.packId)}
        icon={<Icon className="h-4 w-4" />}
        active={pack.packId === scoped}
        nested={nested}
      >
        {/* The skill's own name — localized metadata, resolved here, never translated (ADR-0005). */}
        {pickTitle(pack.title, locale)}
      </RailItem>
    );
  };

  return (
    <nav
      aria-label={t.sections}
      className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3 md:flex"
    >
      <RailItem href={home} icon={<LayoutGrid className="h-4 w-4" />} active={isActive(home, true)}>
        {t.home}
      </RailItem>

      <div className="flex items-center justify-between px-2.5 pb-1 pt-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.myMenu}</span>
        <Link
          href={skills}
          aria-label={t.organise}
          title={t.organise}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ListTree className="h-3.5 w-3.5" />
        </Link>
      </div>

      {arranged.folders.map((folder) => {
        // The folder holding the skill on screen stays open, whatever was remembered: closing the
        // folder you are standing in would hide where you are.
        const holdsScoped = folder.items.some((item) => item.packId === scoped);
        const open = holdsScoped || !closed.has(folder.folderId);

        return (
          <div key={folder.folderId} className="contents">
            <button
              type="button"
              onClick={() => toggle(folder.folderId)}
              aria-expanded={open}
              title={t.openFolder}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
              <Folder className={cn('h-4 w-4 shrink-0', holdsScoped ? 'text-primary' : 'text-muted-foreground')} />
              {/* The learner's own name for it — neither chrome nor pack content. */}
              <span className="flex-1 truncate">{folder.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{folder.items.length}</span>
            </button>
            {open ? (
              <div className="my-0.5 ml-4 space-y-0.5 border-l border-border pl-2">
                {folder.items.map((pack) => skillItem(pack, true))}
              </div>
            ) : null}
          </div>
        );
      })}

      {arranged.loose.map((pack) => skillItem(pack, false))}

      <div className="mx-1 my-3 h-px bg-border" />

      <RailItem href={skills} icon={<Rows3 className="h-4 w-4" />} active={isActive(skills)}>
        <span className="flex items-center justify-between gap-2">
          {t.allSkills}
          {arranged.hidden > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground" title={`${arranged.hidden} ${t.hidden}`}>
              <span aria-hidden="true">+{arranged.hidden}</span>
              <span className="sr-only">
                {arranged.hidden} {t.hidden}
              </span>
            </span>
          ) : null}
        </span>
      </RailItem>

      {/*
        The wiki is the platform's, not a skill's, so it sits beside the skills rather than in the
        menu the learner arranges.
      */}
      <RailItem href={`/${locale}/wiki`} icon={<Library className="h-4 w-4" />} active={isActive(`/${locale}/wiki`)}>
        {t.wiki}
      </RailItem>

      {/*
        Beside the skills for the opposite reason the wiki is: the archive belongs to *every* skill at
        once, so filing it under one of them would be filing it under the wrong one.
      */}
      <RailItem
        href={`/${locale}/archive`}
        icon={<HardDriveDownload className="h-4 w-4" />}
        active={isActive(`/${locale}/archive`)}
      >
        {t.yourData}
      </RailItem>
    </nav>
  );
}

function RailItem({
  href,
  icon,
  active,
  nested,
  children,
}: {
  href: string;
  icon: ReactNode;
  active: boolean;
  nested?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors',
        nested ? 'py-1.5' : 'py-2',
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}
