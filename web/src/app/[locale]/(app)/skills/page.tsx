/**
 * All my skills — the organise page for the menu (ADR-0021).
 *
 * Every published skill (ADR-0024). The ones the learner has added are grouped by their folders,
 * with the switch that decides whether each shows in the menu; a skill switched off is not left or
 * reset — it waits here with its progress. The rest are listed below them, ready to be added, which
 * is what starts a skill.
 */

import { PageShell } from '@/components/atoms';
import { MenuEditor } from '@/components/menu-editor';
import { api } from '@/lib/api';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { LearnerMenu, Pack } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SkillsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);

  const [{ menu }, catalogue] = await Promise.all([
    api<{ menu: LearnerMenu }>('/api/v1/me/menu'),
    api<{ packs: Pack[] }>('/api/v1/packs'),
  ]);

  const skills = catalogue.packs.map((pack) => ({
    packId: pack.packId,
    title: pack.title,
    icon: pack.presentation?.icon,
    description: pack.description,
  }));

  return (
    <PageShell title={dictionary.menu.title} subtitle={dictionary.menu.subtitle}>
      <MenuEditor locale={locale} dictionary={dictionary} initial={menu} skills={skills} />
    </PageShell>
  );
}
