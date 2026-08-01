'use client';

/**
 * The lesson, with its writing tasks wired to a submission.
 *
 * Answers are held in one map keyed by `${sectionId}.${itemRef}`, matching the reference scheme the
 * API expects, so what the learner types maps onto what the coach corrects without translation in
 * between.
 *
 * Draft answers are kept in `localStorage` per lesson. Losing a page of carefully written Dutch to
 * a stray reload is the kind of thing that stops someone coming back tomorrow.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { clientApi, ApiError } from '@/lib/api-client';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Lesson, Submission } from '@/lib/types';
import { SectionView } from './section-view';

interface Props {
  lesson: Lesson;
  contentLanguage: string;
  dictionary: Dictionary;
  locale: Locale;
  existingSubmission: Submission | null;
}

export function LessonForm({ lesson, contentLanguage, dictionary, locale, existingSubmission }: Props) {
  const t = dictionary.lesson;
  const router = useRouter();
  const draftKey = useMemo(() => `sc.draft.${lesson.lessonId}`, [lesson.lessonId]);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [speakingNote, setSpeakingNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore a draft on mount only — after that the component owns the state.
  useEffect(() => {
    if (existingSubmission) return;
    try {
      const stored = window.localStorage.getItem(draftKey);
      if (!stored) return;
      const draft = JSON.parse(stored) as { answers?: Record<string, string>; speakingNote?: string };
      setAnswers(draft.answers ?? {});
      setSpeakingNote(draft.speakingNote ?? '');
    } catch {
      // A corrupt draft is not worth surfacing; the learner simply starts fresh.
    }
  }, [draftKey, existingSubmission]);

  useEffect(() => {
    if (existingSubmission) return;
    const handle = window.setTimeout(() => {
      window.localStorage.setItem(draftKey, JSON.stringify({ answers, speakingNote }));
    }, 400);
    return () => window.clearTimeout(handle);
  }, [answers, speakingNote, draftKey, existingSubmission]);

  const submitted = existingSubmission !== null;

  const submit = async (): Promise<void> => {
    const filled = Object.entries(answers)
      .map(([ref, text]) => ({ ref, text: text.trim() }))
      .filter((answer) => answer.text.length > 0);

    if (filled.length === 0) {
      setError(t.emptySubmission);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await clientApi<{ submission: Submission }>(`/v1/lessons/${lesson.lessonId}/submissions`, {
        method: 'POST',
        body: { answers: filled, speakingNote: speakingNote.trim() || undefined },
      });
      window.localStorage.removeItem(draftKey);
      router.push(`/${locale}/sessions/${result.submission.submissionId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : dictionary.common.error);
      setSubmitting(false);
    }
  };

  /** Rendered under every prompt a submission can answer. */
  const answerSlot = (ref: string, label: string) => {
    if (submitted) {
      const previous = existingSubmission?.answers.find((answer) => answer.ref === ref);
      return previous ? (
        <p className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-canvas px-3 py-2 text-sm" lang={contentLanguage}>
          {previous.text}
        </p>
      ) : null;
    }

    return (
      <textarea
        className="field mt-2 min-h-[4.5rem] resize-y"
        lang={contentLanguage}
        aria-label={`${t.yourAnswer}: ${label}`}
        placeholder={t.yourAnswer}
        value={answers[ref] ?? ''}
        onChange={(event) => setAnswers((current) => ({ ...current, [ref]: event.target.value }))}
      />
    );
  };

  return (
    <div className="space-y-6">
      {lesson.sections.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          contentLanguage={contentLanguage}
          dictionary={dictionary}
          answerSlot={answerSlot}
        />
      ))}

      {submitted ? (
        <div className="card">
          <p>{t.alreadySubmitted}</p>
          <Link href={`/${locale}/sessions/${existingSubmission.submissionId}`} className="btn-primary mt-4">
            {t.viewSessionLog}
          </Link>
        </div>
      ) : (
        <div className="card">
          <label htmlFor="speaking-note" className="block text-sm font-medium">
            {t.speakingNote}
          </label>
          <input
            id="speaking-note"
            className="field mt-2"
            placeholder={t.speakingNotePlaceholder}
            value={speakingNote}
            onChange={(event) => setSpeakingNote(event.target.value)}
          />

          {error ? (
            <p className="mt-4 text-sm text-bad" role="alert">
              {error}
            </p>
          ) : null}

          <button type="button" className="btn-primary mt-4" onClick={() => void submit()} disabled={submitting}>
            {submitting ? t.submitting : t.submit}
          </button>
        </div>
      )}
    </div>
  );
}
