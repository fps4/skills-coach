/**
 * Progress: the live error log, plus deck standings.
 *
 * The source program kept this by hand across three markdown files. Here it is derived from what
 * actually happened, so it cannot be out of date — which is the point, because this is the evidence
 * the next block gets written from.
 */

import { api } from '@/lib/api';
import { formatDate, pickTitle, statusLabel, statusTone } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { DeckSummary, PackProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

function DeckRow({
  label,
  summary,
  dictionary,
}: {
  label: string;
  summary: DeckSummary;
  dictionary: ReturnType<typeof getDictionary>;
}) {
  if (summary.total === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-line/60 py-3 last:border-0">
      <span className="w-28 font-medium">{label}</span>
      <span className="text-sm text-muted">
        {dictionary.progress.total}: <span className="tabular-nums text-ink">{summary.total}</span>
      </span>
      <span className="text-sm text-muted">
        {dictionary.progress.unlocked}: <span className="tabular-nums text-ink">{summary.stage1Cleared}</span>
      </span>
      <span className="text-sm text-muted">
        {dictionary.block.mastered}: <span className="tabular-nums text-good">{summary.mastered}</span>
      </span>
    </div>
  );
}

export default async function ProgressPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  const t = dictionary.progress;

  const { packs } = await api<{ packs: PackProgress[] }>('/api/v1/progress');

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      </header>

      {packs.length === 0 ? (
        <div className="card">
          <p>{dictionary.home.noPacks}</p>
        </div>
      ) : null}

      {packs.map((entry) => (
        <section key={entry.pack.packId} className="space-y-6">
          <h2 className="text-lg font-semibold tracking-tight">{pickTitle(entry.pack.title, locale)}</h2>

          <div className="card">
            <h3 className="mb-1 font-semibold tracking-tight">{t.decks}</h3>
            <DeckRow label={t.words} summary={entry.decks.terms} dictionary={dictionary} />
            <DeckRow label={t.sentences} summary={entry.decks.wordOrder} dictionary={dictionary} />
          </div>

          <div className="card">
            <h3 className="font-semibold tracking-tight">{t.errorLog}</h3>
            <p className="mt-1 max-w-prose text-sm text-muted">{t.errorLogIntro}</p>

            {entry.errorLog.entries.length === 0 ? (
              <div className="mt-4">
                <p>{t.noErrors}</p>
                <p className="mt-1 text-sm text-muted">{t.noErrorsHint}</p>
              </div>
            ) : (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-muted">
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
                          <tr key={row.category} className="border-b border-line/60 align-top last:border-0">
                            {/* The category id is pack-authored content — rendered as written. */}
                            <td className="py-2 pr-4 font-medium">{row.category}</td>
                            <td className="py-2 pr-4 text-muted" lang={entry.pack.contentLanguage}>
                              {example ? (
                                <>
                                  <span className="line-through decoration-bad/50">{example.wrong}</span>
                                  {' → '}
                                  <span className="text-good">{example.right}</span>
                                </>
                              ) : null}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">{row.count}</td>
                            <td className="py-2 pr-4 text-muted">{formatDate(row.lastSeen, locale)}</td>
                            <td className="py-2">
                              <span className={`chip ${statusTone(row.status)}`}>{statusLabel(row.status, dictionary)}</span>
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
                    <span className="text-muted">{entry.errorLog.redrill.join(' · ')}</span>
                  </p>
                ) : null}
                {entry.errorLog.retire.length > 0 ? (
                  <p className="mt-1 text-sm">
                    <span className="font-medium">{t.retired}: </span>
                    <span className="text-muted">{entry.errorLog.retire.join(' · ')}</span>
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
