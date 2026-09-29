/**
 * All my skills — the organise page for the menu (ADR-0021).
 *
 * Every skill the learner has started, grouped by their folders, with the switch that decides
 * whether it shows in the menu. A skill switched off is not left or reset; it waits here with its
 * progress, and switching it back on puts it where it was.
 *
 * Starting a *new* skill is the home page's job, not this one's: this lists what is already theirs.
 */

import { PageShell } from '@/components/atoms';
import { MenuEditor } from '@/components/menu-editor';
import { api } from '@/lib/api';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { LearnerMenu, PackProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SkillsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);

  const [{ menu }, overview] = await Promise.all([
    api<{ menu: LearnerMenu }>('/api/v1/me/menu'),
    api<{ packs: PackProgress[] }>('/api/v1/progress'),
  ]);

  const skills = overview.packs.map((entry) => ({
    packId: entry.pack.packId,
    title: entry.pack.title,
    icon: entry.pack.presentation?.icon,
    description: entry.pack.description,
  }));

  return (
    <PageShell title={dictionary.menu.title} subtitle={dictionary.menu.subtitle}>
      <MenuEditor locale={locale} dictionary={dictionary} initial={menu} skills={skills} />
    </PageShell>
  );
}
