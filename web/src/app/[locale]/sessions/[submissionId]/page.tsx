/**
 * The session log: what the learner wrote, and what came back.
 *
 * This is the artifact the source program wrote by hand into a markdown file after every lesson.
 * Here it is simply a view over the submission and its correction.
 */

import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { Correction, Lesson, Pack, Submission } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SessionPage({ params }: { params: Promise<{ locale: Locale; submissionId: string }> }) {
  const { locale, submissionId } = await params;
  const dictionary = getDictionary(locale);
  const t = dictionary.session;

  const log = await api<{ submission: Submission; correction: Correction | null }>(`/api/v1/submissions/${submissionId}`);
  const { lesson } = await api<{ lesson: Lesson }>(`/api/v1/lessons/${log.submission.lessonId}`);
  const { pack } = await api<{ pack: Pack }>(`/api/v1/packs/${log.submission.packId}`);

  const promptFor = (ref: string): string => {
    const [sectionId, itemRef] = ref.split('.');
    const section = lesson.sections.find((entry) => entry.id === sectionId);
    if (!section) return ref;
    if (section.kind === 'write') return section.prompt;
    if ((section.kind === 'questions' || section.kind === 'exercise') && itemRef) {
      return section.items.find((item) => item.ref === itemRef)?.prompt ?? ref;
    }
    return section.title ?? ref;
  };

  const ratings = log.correction?.ratings;

  return (
    <div className="space-y-6">
      <header>
        <Link href={`/${locale}/blocks/${log.submission.blockId}`} className="text-sm text-muted hover:text-ink">
          ← {dictionary.common.back}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {dictionary.common.lesson} {lesson.order} · {formatDate(log.submission.createdAt, locale)}
        </p>
      </header>

      {!log.correction ? (
        <div className="card border-warn/40">
          <p className="font-medium text-warn">{t.pending}</p>
          <p className="mt-1 text-sm text-muted">{t.pendingHint}</p>
        </div>
      ) : null}

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">{t.yourAnswers}</h2>
        <dl className="space-y-4">
          {log.submission.answers.map((answer) => (
            <div key={answer.ref}>
              <dt className="text-sm text-muted" lang={pack.contentLanguage}>
                {promptFor(answer.ref)}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap" lang={pack.contentLanguage}>
                {answer.text}
              </dd>
            </div>
          ))}
        </dl>
        {log.submission.speakingNote ? (
          <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
            <span className="font-medium text-ink">{dictionary.lesson.speak}: </span>
            {log.submission.speakingNote}
          </p>
        ) : null}
      </section>

      {log.correction ? (
        <section className="card">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">{t.corrections}</h2>

          {log.correction.items.length === 0 ? (
            <p className="text-good">{t.noCorrections}</p>
          ) : (
            <ul className="space-y-5">
              {log.correction.items.map((item, index) => (
                <li key={index} className="border-b border-line/60 pb-4 last:border-0 last:pb-0">
                  <p className="text-sm text-muted">{t.original}</p>
                  <p className="line-through decoration-bad/60" lang={pack.contentLanguage}>
                    {item.original}
                  </p>

                  <p className="mt-2 text-sm text-muted">{t.corrected}</p>
                  <p className="font-medium text-good" lang={pack.contentLanguage}>
                    {item.corrected}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.categories.map((category) => (
                      // A pack-declared label, rendered as authored — it is content, not chrome.
                      <span key={category} className="chip text-muted">
                        {category}
                      </span>
                    ))}
                  </div>

                  {item.explanation ? <p className="mt-2 text-sm text-muted">{item.explanation}</p> : null}
                </li>
              ))}
            </ul>
          )}

          {ratings ? (
            <div className="mt-6 border-t border-line pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t.ratings}</h3>
              <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                {ratings.fluency !== undefined ? (
                  <div>
                    <dt className="text-muted">{t.fluency}</dt>
                    <dd className="tabular-nums">{ratings.fluency}/5</dd>
                  </div>
                ) : null}
                {ratings.accuracy !== undefined ? (
                  <div>
                    <dt className="text-muted">{t.accuracy}</dt>
                    <dd className="tabular-nums">{ratings.accuracy}/5</dd>
                  </div>
                ) : null}
                {ratings.courage !== undefined ? (
                  <div>
                    <dt className="text-muted">{t.courage}</dt>
                    <dd className="tabular-nums">{ratings.courage}/5</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}

          {log.correction.note ? (
            <p className="mt-4 border-t border-line pt-4 text-sm">
              <span className="font-medium">{t.note}: </span>
              {log.correction.note}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
