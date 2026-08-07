'use client';

/**
 * What a sitting came to.
 *
 * Three things, in the order they are useful: the score, where the marks went, and every question
 * back with its key and its explanation. The last one is the point — a practice test whose review
 * you skip has taught you a number.
 *
 * **Everything here is advisory** (AGENTS.md). There is a percentage because a learner wants one,
 * and there is a line under it saying what it is not. No pass/fail, no predicted result, and nothing
 * about it is stored: it is recomputed from the answers every time this page is opened.
 */

import { Check, RotateCcw, X } from 'lucide-react';

import { Meter, PageShell, Pill, Stat } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Dictionary } from '@/i18n/dictionaries';
import type { QuizResults } from '@/lib/types';

export function QuizResultsView({
  results,
  contentLanguage,
  dictionary,
  onRestart,
}: {
  results: QuizResults;
  contentLanguage: string;
  dictionary: Dictionary;
  onRestart: () => void;
}) {
  const t = dictionary.quiz;
  const { score, byCategory, review } = results;
  const percent = score.accuracy === null ? 0 : Math.round(score.accuracy * 100);

  return (
    <PageShell title={t.results} subtitle={t.scoreHint}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat value={`${percent}%`} label={t.score.toLowerCase()} />
        <Stat value={`${score.correct}/${score.answered}`} label={t.correct.toLowerCase()} />
        <Stat value={score.asked} label={t.question.toLowerCase()} />
      </div>

      {byCategory.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t.byDomain}</CardTitle>
            <p className="text-sm text-muted-foreground">{t.weakest}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {byCategory.map((row) => (
              <div key={row.category} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                  {/* A category id is pack-authored content — rendered as written (ADR-0005). */}
                  <span className="min-w-0 break-words font-medium">{row.category}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {row.correct}/{row.asked}
                  </span>
                </div>
                <Meter
                  value={row.correct}
                  total={row.asked}
                  tone={row.accuracy >= 0.7 ? 'success' : row.accuracy >= 0.4 ? 'primary' : 'muted'}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.reviewTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {review.map((item, index) => {
            const chosen = new Set(item.chosen);
            const key = new Set(item.correctRefs);

            return (
              <div key={item.drillItemId} className="border-b border-border/60 pb-6 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t.question} {index + 1}
                  </span>
                  {item.correct ? (
                    <Pill tone="success">
                      <Check className="mr-1 h-3 w-3" /> {t.correct}
                    </Pill>
                  ) : (
                    <Pill tone="destructive">
                      <X className="mr-1 h-3 w-3" /> {t.incorrect}
                    </Pill>
                  )}
                  {item.categories.map((category) => (
                    <Pill key={category}>{category}</Pill>
                  ))}
                </div>

                <p className="mt-2 max-w-prose whitespace-pre-wrap leading-relaxed" lang={contentLanguage}>
                  {item.stem}
                </p>

                <ul className="mt-3 space-y-1 text-sm">
                  {item.options.map((option) => {
                    const isKey = key.has(option.ref);
                    const picked = chosen.has(option.ref);
                    return (
                      <li
                        key={option.ref}
                        className={
                          isKey
                            ? 'text-success'
                            : picked
                              ? 'text-destructive line-through decoration-destructive/50'
                              : 'text-muted-foreground'
                        }
                        lang={contentLanguage}
                      >
                        {isKey ? '✓ ' : picked ? '✗ ' : '· '}
                        {option.text}
                      </li>
                    );
                  })}
                </ul>

                <p className="mt-3 max-w-prose text-sm leading-relaxed" lang={contentLanguage}>
                  <span className="text-muted-foreground">{t.whyRight}: </span>
                  {item.explanation}
                </p>

                {item.distractors?.length ? (
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground" lang={contentLanguage}>
                    {item.distractors.map((entry) => (
                      <li key={entry.ref}>{entry.why}</li>
                    ))}
                  </ul>
                ) : null}

                {item.sourceRefs?.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t.sources}:{' '}
                    {item.sourceRefs.map((href, position) => (
                      <span key={href}>
                        {position > 0 ? ' · ' : ''}
                        <a href={href} target="_blank" rel="noreferrer noopener" className="underline hover:text-foreground">
                          {href.replace(/^https?:\/\//, '').slice(0, 60)}
                        </a>
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={onRestart}>
        <RotateCcw className="h-4 w-4" /> {t.startAgain}
      </Button>
    </PageShell>
  );
}
