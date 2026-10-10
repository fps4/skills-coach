/**
 * Jouw gegevens — the learner's own data, in and out.
 *
 * Not under a pack, and deliberately so. Everything else behind the rail is scoped to one pack
 * (ADR-0018); an archive is scoped to a *person* and spans every pack they have touched, so it sits
 * beside the skills as the one thing here that no manifest declares.
 */

import { PageShell } from '@/components/atoms';
import { ArchivePanel } from '@/components/archive-panel';
import { getDictionary } from '@/i18n/dictionaries';

export const dynamic = 'force-dynamic';

export default async function ArchivePage() {
  const dictionary = getDictionary();

  return (
    <PageShell title={dictionary.archive.title} subtitle={dictionary.archive.intro}>
      <ArchivePanel dictionary={dictionary} />
    </PageShell>
  );
}
