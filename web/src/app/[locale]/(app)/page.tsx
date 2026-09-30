/**
 * Home — the skills the learner has turned on, arranged as their menu is (ADR-0024).
 *
 * A version of the menu, not a catalogue: one tile per skill that shows in the menu, grouped under
 * the learner's own folders in the learner's order, each with the one action that continues it.
 * Finding and adding a skill is the "All my skills" page's job, so a hidden or not-yet-added skill
 * has no tile here. A folder with nothing shown in it has no heading either — unlike the rail, which
 * keeps an empty folder so a new one is visible where it was made.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, BookOpen, Folder } from 'lucide-react';
import { PageShell, Meter, Pill } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { arrangeRail } from '@/lib/menu';
import { packIcon } from '@/lib/pack-scope';
import { pickTitle } from '@/lib/text';
import { getDictionary, type Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Enrollment, Learner, LearnerMenu, PackProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  const t = dictionary.home;

  const [{ learner }, overview, { menu }] = await Promise.all([
    api<{ learner: Learner; enrollments: Enrollment[] }>('/api/v1/me'),
    api<{ packs: PackProgress[] }>('/api/v1/progress'),
    api<{ menu: LearnerMenu }>('/api/v1/me/menu'),
  ]);

  const arranged = arrangeRail(
    menu,
    overview.packs.map((entry) => ({ packId: entry.pack.packId, entry })),
  );
  const folders = arranged.folders.filter((folder) => folder.items.length > 0);
  const nothingShown = folders.length === 0 && arranged.loose.length === 0;

  const tile = (entry: PackProgress) => {
    const block = entry.currentBlock;
    const progress = entry.blockProgress;
    const next = progress?.nextLessonOrder ?? null;
    const packHref = `/${locale}/packs/${entry.pack.packId}`;

    return (
      <Tile
        key={entry.pack.packId}
        href={packHref}
        icon={entry.pack.presentation?.icon}
        title={pickTitle(entry.pack.title, locale)}
        pill={block?.level ? <Pill className="shrink-0 whitespace-nowrap">{block.level}</Pill> : null}
        // The block's own title, unprefixed: pack authors habitually name it "Blok 01 — …"
        // already, and a runtime prefix would say it twice.
        caption={block ? pickTitle(block.title, locale) : undefined}
      >
        {progress && progress.lessonCount > 0 ? (
          <div>
            <Meter value={progress.completed} total={progress.lessonCount} />
            <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
              <span>
                {progress.completed}/{progress.lessonCount} {t.lessonsDone}
              </span>
              <span>
                {entry.decks.terms.mastered}/{entry.decks.terms.total} {dictionary.progress.words.toLowerCase()}
              </span>
            </div>
            {progress.pendingOrders.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {dictionary.pack.waitingOnCoach}: {dictionary.common.lesson} {progress.pendingOrders.join(', ')}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* A skill without lessons says what it holds instead (ADR-0022). */}
        {!progress || progress.lessonCount === 0 ? <SkillHoldings entry={entry} dictionary={dictionary} /> : null}

        {/* `relative` lifts the action above the tile-wide link behind it. */}
        {block && next ? (
          <Button asChild size="sm" className="relative w-full">
            <Link href={`/${locale}/lessons/${block.blockId}.l${next}`}>
              {t.continueLesson} {next} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline" className="relative w-full">
            <Link href={packHref}>
              <BookOpen className="h-4 w-4" /> {t.openPack}
            </Link>
          </Button>
        )}
      </Tile>
    );
  };

  const grid = (items: { entry: PackProgress }[]) => (
    <div className="grid gap-4 sm:grid-cols-2">{items.map(({ entry }) => tile(entry))}</div>
  );

  return (
    <PageShell
      title={
        <>
          {t.title}
          {learner.displayName ? <span className="text-muted-foreground">, {learner.displayName}</span> : null}
        </>
      }
      subtitle={t.subtitle}
    >
      {nothingShown ? (
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-sm">{t.emptyMenu}</p>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${locale}/skills`}>
                {t.addSkills} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-6">
        {folders.map((folder) => (
          <section key={folder.folderId} aria-labelledby={`folder-${folder.folderId}`} className="space-y-3">
            <h2 id={`folder-${folder.folderId}`} className="flex items-center gap-2 text-sm font-semibold">
              <Folder className="h-4 w-4 text-muted-foreground" aria-hidden />
              {/* The learner's own name for it — neither chrome nor pack content. */}
              {folder.name}
            </h2>
            {grid(folder.items)}
          </section>
        ))}

        {arranged.loose.length > 0 ? grid(arranged.loose) : null}
      </div>
    </PageShell>
  );
}

/** One line on what a skill without lessons holds: its words, its reading, or both. */
function SkillHoldings({ entry, dictionary }: { entry: PackProgress; dictionary: Dictionary }) {
  const parts: string[] = [];
  if (entry.decks.terms.total > 0) {
    parts.push(`${entry.decks.terms.mastered}/${entry.decks.terms.total} ${dictionary.progress.words.toLowerCase()}`);
  }
  if (entry.reading.total > 0) parts.push(`${entry.reading.unread}/${entry.reading.total} ${dictionary.home.unread}`);
  if (parts.length === 0) return null;

  return (
    <div>
      {entry.decks.terms.total > 0 ? <Meter value={entry.decks.terms.mastered} total={entry.decks.terms.total} /> : null}
      <p className="mt-2 text-xs text-muted-foreground">{parts.join(' · ')}</p>
    </div>
  );
}

/**
 * One pack, as a tile.
 *
 * The whole tile is the link — the title carries it and spreads over the card, so the target is one
 * word for a screen reader and the full rectangle for a pointer. Nothing is nested inside that
 * anchor, which is what keeps the actions in the footer legal and clickable.
 */
function Tile({
  href,
  icon,
  title,
  pill,
  caption,
  children,
}: {
  href: string;
  /** A key the pack declared; unknown ones fall back rather than leaving a gap (ADR-0009). */
  icon?: string;
  title: string;
  pill?: ReactNode;
  caption?: string;
  children: ReactNode;
}) {
  const Icon = packIcon(icon);

  return (
    <Card className="relative flex flex-col transition-colors hover:border-primary/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-start gap-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <Link href={href} className="hover:text-primary after:absolute after:inset-0 after:content-['']">
              {title}
            </Link>
          </CardTitle>
          {pill}
        </div>
        {caption ? <p className="text-sm text-muted-foreground">{caption}</p> : null}
      </CardHeader>
      <CardContent className="mt-auto space-y-3">{children}</CardContent>
    </Card>
  );
}
