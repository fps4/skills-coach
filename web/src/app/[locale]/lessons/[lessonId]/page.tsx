/**
 * A lesson: every section rendered by kind, plus the form that produces a submission.
 */

import Link from 'next/link';
import { api } from '@/lib/api';
import { pickTitle } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Lesson, Pack, Submission } from '@/lib/types';
import { LessonForm } from '@/components/lesson-form';

export const dynamic = 'force-dynamic';

export default async function LessonPage({ params }: { params: Promise<{ locale: Locale; lessonId: string }> }) {
  const { locale, lessonId } = await params;
  const dictionary = getDictionary(locale);

  const { lesson, submissions } = await api<{ lesson: Lesson; submissions: Submission[] }>(`/api/v1/lessons/${lessonId}`);
  const { pack } = await api<{ pack: Pack }>(`/api/v1/packs/${lesson.packId}`);

  const existing = submissions[0] ?? null;

  return (
    <div className="space-y-6">
      <header>
        <Link href={`/${locale}/blocks/${lesson.blockId}`} className="text-sm text-muted hover:text-ink">
          ← {dictionary.common.back}
        </Link>
        <p className="mt-2 text-sm text-muted">
          {dictionary.common.lesson} {lesson.order}
          {lesson.level ? ` · ${lesson.level}` : ''}
          {lesson.estimatedMinutes ? ` · ${lesson.estimatedMinutes} ${dictionary.common.minutes}` : ''}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight" lang={pack.contentLanguage}>
          {pickTitle(lesson.title, locale)}
        </h1>
      </header>

      <LessonForm
        lesson={lesson}
        contentLanguage={pack.contentLanguage}
        dictionary={dictionary}
        locale={locale}
        existingSubmission={existing}
      />
    </div>
  );
}
