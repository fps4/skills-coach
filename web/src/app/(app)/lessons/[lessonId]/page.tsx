/**
 * A lesson: every section rendered by kind, plus the form that produces a submission.
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PageShell } from '@/components/atoms';
import { LessonForm } from '@/components/lesson-form';
import { api } from '@/lib/api';
import { getDictionary } from '@/i18n/dictionaries';
import type { Lesson, Pack, Submission } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const dictionary = getDictionary();

  const { lesson, submissions } = await api<{ lesson: Lesson; submissions: Submission[] }>(`/api/v1/lessons/${lessonId}`);
  const { pack } = await api<{ pack: Pack }>(`/api/v1/packs/${lesson.packId}`);

  return (
    <PageShell
      title={<span lang={pack.contentLanguage}>{lesson.title}</span>}
      subtitle={
        <>
          {dictionary.common.lesson} {lesson.order}
          {lesson.level ? ` · ${lesson.level}` : ''}
          {lesson.estimatedMinutes ? ` · ${lesson.estimatedMinutes} ${dictionary.common.minutes}` : ''}
        </>
      }
      back={
        <Link
          href={`/blocks/${lesson.blockId}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {dictionary.common.back}
        </Link>
      }
    >
      <LessonForm
        lesson={lesson}
        contentLanguage={pack.contentLanguage}
        dictionary={dictionary}

        existingSubmission={submissions[0] ?? null}
      />
    </PageShell>
  );
}
