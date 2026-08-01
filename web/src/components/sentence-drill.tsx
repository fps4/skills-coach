'use client';

/**
 * The sentence trainer.
 *
 * Tap a chunk to move it into your sentence, tap it again to send it back — the same interaction
 * the browser trainer used, because it works one-handed on a phone.
 *
 * The rules it preserves: two correct in a row solves an order, the second order is gated behind
 * the first, per-chunk feedback shows *where* the order went wrong, and building the other valid
 * order is reported as good Dutch in the wrong round rather than as a mistake.
 */

import { useCallback, useEffect, useState } from 'react';
import { clientApi, query } from '@/lib/api-client';
import type { Dictionary } from '@/i18n/dictionaries';
import type { AttemptResult, DeckPage, DueItem, Stage } from '@/lib/types';
import { DeckProgress, DrillShell, Feedback } from './drill-chrome';

interface Props {
  blockId: string;
  contentLanguage: string;
  dictionary: Dictionary;
}

/** A chunk in the bank, tracked by position so duplicate chunks stay distinguishable. */
interface Chunk {
  key: number;
  text: string;
}

export function SentenceDrill({ blockId, contentLanguage, dictionary }: Props) {
  const t = dictionary.drills;

  const [deck, setDeck] = useState<DeckPage | null>(null);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage | undefined>(undefined);
  const [bank, setBank] = useState<Chunk[]>([]);
  const [built, setBuilt] = useState<Chunk[]>([]);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await clientApi<DeckPage>(`/v1/drills${query({ blockId, kind: 'word-order', stage, limit: 40 })}`);
      setDeck(page);
      setIndex(0);
      setResult(null);
    } catch {
      setError(dictionary.common.error);
    } finally {
      setLoading(false);
    }
  }, [blockId, stage, dictionary.common.error]);

  useEffect(() => {
    void load();
  }, [load]);

  const current: DueItem | undefined = deck?.items[index];

  // Refill the bank whenever the item changes.
  useEffect(() => {
    if (current?.prompt.kind !== 'word-order') return;
    setBank(current.prompt.bank.map((text, key) => ({ key, text })));
    setBuilt([]);
    setShowTip(false);
  }, [current]);

  const take = (chunk: Chunk): void => {
    if (result) return;
    setBank((current) => current.filter((entry) => entry.key !== chunk.key));
    setBuilt((current) => [...current, chunk]);
  };

  const putBack = (chunk: Chunk): void => {
    if (result) return;
    setBuilt((current) => current.filter((entry) => entry.key !== chunk.key));
    setBank((current) => [...current, chunk].sort((a, b) => a.key - b.key));
  };

  const clear = (): void => {
    if (result || !current || current.prompt.kind !== 'word-order') return;
    setBank(current.prompt.bank.map((text, key) => ({ key, text })));
    setBuilt([]);
  };

  const shuffle = (): void => {
    setBank((chunks) => {
      const shuffled = [...chunks];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j] as Chunk, shuffled[i] as Chunk];
      }
      return shuffled;
    });
  };

  const check = async (override = false): Promise<void> => {
    if (!current) return;
    if (!override && built.length === 0) return;
    try {
      const outcome = await clientApi<AttemptResult>(`/v1/drills/${current.drillItemId}/attempts`, {
        method: 'POST',
        body: { stage: current.stage, given: built.map((chunk) => chunk.text), override },
      });
      setResult(outcome);
    } catch {
      setError(dictionary.common.error);
    }
  };

  const advance = (): void => {
    setResult(null);
    if (deck && index + 1 >= deck.items.length) void load();
    else setIndex((value) => value + 1);
  };

  const prompt = current?.prompt.kind === 'word-order' ? current.prompt : null;

  return (
    <DrillShell
      title={t.sentences}
      intro={t.sentencesIntro}
      dictionary={dictionary}
      summary={deck?.summary}
      loading={loading}
      error={error}
      empty={!loading && deck !== null && deck.items.length === 0}
      stage={current?.stage}
      onSwitchStage={() => {
        setStage((value) => (value === 2 ? 1 : 2));
      }}
      onReset={async () => {
        await clientApi('/v1/drills/reset', { method: 'POST', body: { blockId } });
        await load();
      }}
      blockId={blockId}
    >
      {current && prompt ? (
        <>
          <p className="text-sm text-muted">
            {current.stage === 1 ? t.order1 : t.order2}
            {prompt.leadCue ? ` · ${t.startWith} «${prompt.leadCue}»` : ''} · {t.streak} {current.progress.streak}/2
          </p>

          {/* The prompt is the meaning, in the learner's language — the sentence is the answer. */}
          <p className="mt-3 text-xl font-medium">{prompt.prompt}</p>

          <div className="mt-5">
            <p className="text-sm text-muted">{t.yourSentence}</p>
            <div className="mt-2 flex min-h-[3.25rem] flex-wrap items-start gap-2 rounded-lg border border-dashed border-line p-2">
              {built.map((chunk, position) => {
                const mark = result?.marks?.[position];
                const tone =
                  mark === undefined
                    ? 'border-line bg-canvas'
                    : mark
                      ? 'border-good/50 bg-good/10 text-good'
                      : 'border-bad/50 bg-bad/10 text-bad';
                return (
                  <button
                    key={chunk.key}
                    type="button"
                    lang={contentLanguage}
                    onClick={() => putBack(chunk)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${tone}`}
                  >
                    {chunk.text}
                  </button>
                );
              })}
            </div>
          </div>

          {bank.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {bank.map((chunk) => (
                <button
                  key={chunk.key}
                  type="button"
                  lang={contentLanguage}
                  onClick={() => take(chunk)}
                  disabled={result !== null}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-50"
                >
                  {chunk.text}
                </button>
              ))}
            </div>
          ) : null}

          {showTip && prompt.tip ? <p className="mt-4 text-sm text-muted">{prompt.tip}</p> : null}

          {result ? (
            <Feedback
              result={result}
              dictionary={dictionary}
              contentLanguage={contentLanguage}
              onNext={advance}
              onOverride={() => void check(true)}
            />
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => void check()} disabled={built.length === 0}>
                {dictionary.common.check}
              </button>
              <button type="button" className="btn-secondary" onClick={shuffle}>
                🔀 {t.shuffle}
              </button>
              <button type="button" className="btn-ghost" onClick={clear}>
                {t.clear}
              </button>
              {prompt.tip ? (
                <button type="button" className="btn-ghost" onClick={() => setShowTip(true)}>
                  {dictionary.common.hint}
                </button>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {deck ? <DeckProgress summary={deck.summary} dictionary={dictionary} /> : null}
    </DrillShell>
  );
}
