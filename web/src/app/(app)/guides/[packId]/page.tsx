/**
 * A skill's guides (ADR-0029): the reference material its flashcards were written from.
 *
 * Read from `skills/<id>/guides/` on the server — the guides are committed beside the manifest, the
 * same for every learner, so there is nothing to ask the api.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';

import { PageShell } from '@/components/atoms';
import { Card, CardContent } from '@/components/ui/card';
import { guideList } from '@/lib/guides';
import { getDictionary } from '@/i18n/dictionaries';

export default async function GuidesPage({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const guides = guideList(packId);
  if (guides.length === 0) notFound();

  const t = getDictionary().guides;

  return (
    <PageShell tab title={t.title} subtitle={t.subtitle}>
      <ul className="space-y-3">
        {guides.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/guides/${packId}/${guide.slug}`} className="block">
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="flex items-start gap-3 p-4">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="space-y-1">
                    <h2 className="font-medium leading-snug" lang="en">
                      {guide.title}
                    </h2>
                    <p className="text-sm text-muted-foreground" lang="en">
                      {guide.summary}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
