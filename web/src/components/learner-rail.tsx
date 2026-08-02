'use client';

/**
 * The learner rail.
 *
 * The pack tiles, then the exercises indented beneath their parent, then progress. The two drills need a
 * block to practise, so when the learner has not started one they render disabled rather than
 * disappearing — a rail whose items come and go is harder to learn than one that explains itself.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Dumbbell, LayoutGrid, Puzzle, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface Props {
  locale: Locale;
  dictionary: Dictionary;
  /** The block the learner is currently working through, when they have one. */
  currentBlockId: string | null;
}

export function LearnerRail({ locale, dictionary, currentBlockId }: Props) {
  const pathname = usePathname();
  const t = dictionary.nav;

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`);

  const home = `/${locale}`;
  const blockHref = currentBlockId ? `/${locale}/blocks/${currentBlockId}` : null;
  const words = currentBlockId ? `/${locale}/drills/words?blockId=${currentBlockId}` : null;
  const sentences = currentBlockId ? `/${locale}/drills/sentences?blockId=${currentBlockId}` : null;

  return (
    <nav
      aria-label={t.sections}
      className="hidden w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3 md:flex"
    >
      <RailItem href={home} icon={<LayoutGrid className="h-4 w-4" />} active={isActive(home, true)}>
        {t.home}
      </RailItem>

      <RailItem href={blockHref} icon={<Dumbbell className="h-4 w-4" />} active={isActive(`/${locale}/blocks`)}>
        {t.lessons}
      </RailItem>

      <div className="my-0.5 ml-3.5 space-y-0.5 border-l border-border pl-2">
        <RailItem sub href={words} icon={<Sparkles className="h-4 w-4" />} active={pathname === `/${locale}/drills/words`}>
          {t.words}
        </RailItem>
        <RailItem sub href={sentences} icon={<Puzzle className="h-4 w-4" />} active={pathname === `/${locale}/drills/sentences`}>
          {t.sentences}
        </RailItem>
      </div>

      <RailItem href={`/${locale}/progress`} icon={<BarChart3 className="h-4 w-4" />} active={isActive(`/${locale}/progress`)}>
        {t.progress}
      </RailItem>

      {!currentBlockId ? <p className="mt-auto px-2.5 pt-3 text-xs text-muted-foreground">{t.noBlockHint}</p> : null}
    </nav>
  );
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
