/**
 * The session log: what the learner wrote, and what came back.
 *
 * This is the artifact the source program wrote by hand into a markdown file after every lesson.
 * Here it is simply a view over the submission and its correction, so it cannot drift.
 */

import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';

import { PageShell, Pill, Stat } from '@/components/atoms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <PageShell
      title={t.title}
      subtitle={
        <>
          {dictionary.common.lesson} {lesson.order} · {formatDate(log.submission.createdAt, locale)}
        </>
      }
      back={
        <Link
          href={`/${locale}/blocks/${log.submission.blockId}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {dictionary.common.back}
        </Link>
      }
    >
      {!log.correction ? (
        <Card className="border-primary/40">
          <CardContent className="pt-5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Clock className="h-4 w-4" /> {t.pending}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t.pendingHint}</p>
          </CardContent>
        </Card>
      ) : null}

      {ratings ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat value={ratings.fluency !== undefined ? `${ratings.fluency}/5` : '—'} label={t.fluency} />
          <Stat value={ratings.accuracy !== undefined ? `${ratings.accuracy}/5` : '—'} label={t.accuracy} />
          <Stat value={ratings.courage !== undefined ? `${ratings.courage}/5` : '—'} label={t.courage} />
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.yourAnswers}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4">
            {log.submission.answers.map((answer) => (
              <div key={answer.ref}>
                <dt className="text-sm text-muted-foreground" lang={pack.contentLanguage}>
                  {promptFor(answer.ref)}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap" lang={pack.contentLanguage}>
                  {answer.text}
                </dd>
              </div>
            ))}
          </dl>
          {log.submission.speakingNote ? (
            <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{dictionary.lesson.speak}: </span>
              {log.submission.speakingNote}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {log.correction ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t.corrections}</CardTitle>
          </CardHeader>
          <CardContent>
            {log.correction.items.length === 0 ? (
              <p className="text-sm text-success">{t.noCorrections}</p>
            ) : (
              <ul className="space-y-5">
                {log.correction.items.map((item, index) => (
                  <li key={index} className="border-b border-border/60 pb-4 last:border-0 last:pb-0">
                    <p className="text-xs text-muted-foreground">{t.original}</p>
                    <p className="line-through decoration-destructive/60" lang={pack.contentLanguage}>
                      {item.original}
                    </p>

                    <p className="mt-2 text-xs text-muted-foreground">{t.corrected}</p>
                    <p className="font-medium text-success" lang={pack.contentLanguage}>
                      {item.corrected}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.categories.map((category) => (
                        // A pack-declared label, rendered as authored — it is content, not chrome.
                        <Pill key={category}>{category}</Pill>
                      ))}
                    </div>

                    {item.explanation ? <p className="mt-2 text-sm text-muted-foreground">{item.explanation}</p> : null}
                  </li>
                ))}
              </ul>
            )}

            {log.correction.note ? (
              <p className="mt-4 border-t border-border pt-4 text-sm">
                <span className="font-medium">{t.note}: </span>
                {log.correction.note}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}
