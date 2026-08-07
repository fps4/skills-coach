/**
 * Voortgang — the live error log, plus deck standings.
 *
 * The source program kept this by hand across three markdown files. Here it is derived from what
 * actually happened, so it cannot be out of date — which is the point, because this is the evidence
 * the next block gets written from.
 *
 * Everything here is advisory: a sequencing signal, never a grade.
 */

import { BarChart3, ListChecks, Puzzle, Sparkles } from 'lucide-react';

import { Meter, PageShell, Pill, Stat } from '@/components/atoms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDate, pickTitle, statusLabel, statusTone } from '@/lib/text';
import { getDictionary, type Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { DeckSummary, PackProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

function DeckRow({ label, summary, dictionary }: { label: string; summary: DeckSummary; dictionary: Dictionary }) {
  if (summary.total === 0) return null;

  return (
    <div className="space-y-2 border-b border-border/60 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="w-24 font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">
          {dictionary.progress.total}: <span className="tabular-nums text-foreground">{summary.total}</span>
        </span>
        <span className="text-sm text-muted-foreground">
          {dictionary.progress.unlocked}: <span className="tabular-nums text-foreground">{summary.stage1Cleared}</span>
        </span>
        <span className="text-sm text-muted-foreground">
          {dictionary.block.mastered}: <span className="tabular-nums text-success">{summary.mastered}</span>
        </span>
      </div>
      <Meter value={summary.mastered} total={summary.total} tone="success" />
    </div>
  );
}

export default async function ProgressPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  const t = dictionary.progress;

  const { packs } = await api<{ packs: PackProgress[] }>('/api/v1/progress');

  return (
    <PageShell title={t.title}>
      {packs.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm">{dictionary.home.noPacks}</p>
          </CardContent>
        </Card>
      ) : null}

      {packs.map((entry) => {
        const recurring = entry.errorLog.entries.filter((row) => row.status === 'recurring').length;

        return (
          <section key={entry.pack.packId} className="space-y-4">
            <h2 className="text-base font-semibold tracking-tight">{pickTitle(entry.pack.title, locale)}</h2>

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                icon={<Sparkles className="h-4 w-4 text-primary" />}
                value={`${entry.decks.terms.mastered}/${entry.decks.terms.total}`}
                label={t.words.toLowerCase()}
              />
              <Stat
                icon={<Puzzle className="h-4 w-4 text-primary" />}
                value={`${entry.decks.wordOrder.mastered}/${entry.decks.wordOrder.total}`}
                label={t.sentences.toLowerCase()}
              />
              <Stat
                icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
                value={recurring}
                label={t.redrill.toLowerCase()}
              />
            </div>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">{t.decks}</CardTitle>
              </CardHeader>
              <CardContent>
                <DeckRow label={t.words} summary={entry.decks.terms} dictionary={dictionary} />
                <DeckRow label={t.sentences} summary={entry.decks.wordOrder} dictionary={dictionary} />
                <DeckRow label={dictionary.nav.quiz} summary={entry.decks.quiz} dictionary={dictionary} />
              </CardContent>
            </Card>

            {/* Only for packs that actually quiz. Advisory throughout — see ADR-0014. */}
            {entry.quiz.sessions > 0 ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ListChecks className="h-4 w-4 text-primary" />
                    {dictionary.quiz.byDomain}
                  </CardTitle>
                  <p className="max-w-prose text-sm text-muted-foreground">{dictionary.quiz.scoreHint}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {entry.quiz.byCategory.map((row) => (
                    <div key={row.category} className="space-y-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                        {/* Pack-authored, so rendered as written (ADR-0005). */}
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
                <CardTitle className="text-base">{t.errorLog}</CardTitle>
                <p className="max-w-prose text-sm text-muted-foreground">{t.errorLogIntro}</p>
              </CardHeader>

              <CardContent>
                {entry.errorLog.entries.length === 0 ? (
                  <>
                    <p className="text-sm">{t.noErrors}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t.noErrorsHint}</p>
                  </>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-4 font-medium">{t.category}</th>
                            <th className="py-2 pr-4 font-medium">{t.example}</th>
                            <th className="py-2 pr-4 text-right font-medium">{t.count}</th>
                            <th className="py-2 pr-4 font-medium">{t.lastSeen}</th>
                            <th className="py-2 font-medium">{t.status}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.errorLog.entries.map((row) => {
                            const example = row.examples.at(-1);
                            return (
                              <tr key={row.category} className="border-b border-border/60 align-top last:border-0">
                                {/* The category id is pack-authored content — rendered as written. */}
                                <td className="py-2 pr-4 font-medium">{row.category}</td>
                                <td className="py-2 pr-4 text-muted-foreground" lang={entry.pack.contentLanguage}>
                                  {example ? (
                                    <>
                                      <span className="line-through decoration-destructive/60">{example.wrong}</span>
                                      {' → '}
                                      <span className="text-success">{example.right}</span>
                                    </>
                                  ) : null}
                                </td>
                                <td className="py-2 pr-4 text-right tabular-nums">{row.count}</td>
                                <td className="py-2 pr-4 text-muted-foreground">{formatDate(row.lastSeen, locale)}</td>
                                <td className="py-2">
                                  <Pill tone={statusTone(row.status)}>{statusLabel(row.status, dictionary)}</Pill>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {entry.errorLog.redrill.length > 0 ? (
                      <p className="mt-4 text-sm">
                        <span className="font-medium">{t.redrill}: </span>
                        <span className="text-muted-foreground">{entry.errorLog.redrill.join(' · ')}</span>
                      </p>
                    ) : null}
                    {entry.errorLog.retire.length > 0 ? (
                      <p className="mt-1 text-sm">
                        <span className="font-medium">{t.retired}: </span>
                        <span className="text-muted-foreground">{entry.errorLog.retire.join(' · ')}</span>
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          </section>
        );
      })}
    </PageShell>
  );
}
