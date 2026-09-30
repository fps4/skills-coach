'use client';

/**
 * The top of a skill's page: where it is filed, what it is called, and its tabs (ADR-0021).
 *
 * Rendered by the shell above whatever page is open, so every surface of a skill carries the same
 * header without each page having to remember it. Outside a skill — the home page, the wiki, the
 * archive — it renders nothing.
 *
 * The tabs are what the rail used to indent under a pack (ADR-0018). Which ones appear is decided in
 * `lib/pack-scope.ts` and nowhere else (ADR-0019).
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import { activeTab, packIdFromUrl, skillTabs } from '@/lib/pack-scope';
import { pickTitle } from '@/lib/text';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import type { LearnerMenu } from '@/lib/types';
import { ReadyBadge, type RailPack } from './learner-rail';

interface Props {
  locale: Locale;
  dictionary: Dictionary;
  packs: RailPack[];
  menu: LearnerMenu | null;
}

export function SkillHeader({ locale, dictionary, packs, menu }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const scoped = packIdFromUrl(pathname, searchParams);
  const skill = scoped ? packs.find((entry) => entry.packId === scoped) : undefined;
  // A skill opened for the first time is not in the shell's list until the next render — opening it
  // is what enrols. Its page still renders; it simply has no header for that one paint.
  if (!skill) return null;

  const folderId = menu?.placements.find((entry) => entry.packId === skill.packId)?.folderId ?? null;
  const folder = folderId ? menu?.folders.find((entry) => entry.folderId === folderId) : undefined;
  const tabs = skillTabs(locale, skill);
  const current = activeTab(pathname);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-6 md:px-8 md:pt-8">
      {folder ? <p className="text-xs text-muted-foreground">{folder.name} ›</p> : null}
      <p className="text-2xl font-semibold tracking-tight">{pickTitle(skill.title, locale)}</p>

      {/* Only worth a row when there is more than the overview to switch to. */}
      {tabs.length > 1 ? (
        <nav
          aria-label={dictionary.nav.sections}
          className="mt-3 flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_hsl(var(--border))]"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const label = dictionary.nav[tab.labelKey];
            const shape = 'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm';

            if (!tab.href) {
              return (
                <span
                  key={tab.id}
                  aria-disabled="true"
                  className={cn(shape, 'cursor-not-allowed border-transparent text-muted-foreground/50')}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
              );
            }

            const active = tab.id === current;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  shape,
                  'transition-colors',
                  active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {tab.id === 'drills:terms' && skill.ready ? (
                  <ReadyBadge count={skill.ready} label={dictionary.assist.ready} />
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
