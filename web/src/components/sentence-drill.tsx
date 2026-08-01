'use client';

/**
 * The sentence puzzle.
 *
 * Tap a chunk to move it into your sentence, tap it again to send it back — the same interaction
 * the browser trainer used, because it works one-handed on a phone.
 *
 * The rules it preserves: two correct in a row solves an order, the second order is gated behind
 * the first, per-chunk feedback shows *where* the order went wrong, and building the other valid
 * order is reported as good Dutch in the wrong round rather than as a mistake.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eraser, Shuffle } from 'lucide-react';

import { DeckProgress, DrillShell, Feedback } from './drill-chrome';
import { Pill } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { clientApi, query } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { Dictionary } from '@/i18n/dictionaries';
import type { AttemptResult, DeckPage, DueItem, Stage } from '@/lib/types';

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
    setBank((chunks) => chunks.filter((entry) => entry.key !== chunk.key));
    setBuilt((chunks) => [...chunks, chunk]);
  };

  const putBack = (chunk: Chunk): void => {
    if (result) return;
    setBuilt((chunks) => chunks.filter((entry) => entry.key !== chunk.key));
    setBank((chunks) => [...chunks, chunk].sort((a, b) => a.key - b.key));
  };

  const clear = (): void => {
    if (result || current?.prompt.kind !== 'word-order') return;
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
      onSwitchStage={() => setStage((value) => (value === 2 ? 1 : 2))}
      onReset={async () => {
        await clientApi('/v1/drills/reset', { method: 'POST', body: { blockId } });
        await load();
      }}
    >
      {current && prompt ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t.streak} {current.progress.streak}/2
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {prompt.leadCue ? (
                <span className="text-xs text-muted-foreground">
                  {t.startWith} «<span lang={contentLanguage}>{prompt.leadCue}</span>»
                </span>
              ) : null}
              <Pill>{current.stage === 1 ? t.order1 : t.order2}</Pill>
            </div>
          </div>

          {/* The prompt is the meaning, in the learner's language — the sentence is the answer. */}
          <p className="mt-4 text-lg font-medium">{prompt.prompt}</p>

          <p className="mt-5 text-xs text-muted-foreground">{t.yourSentence}</p>
          <div className="mt-2 flex min-h-14 flex-wrap items-start gap-2 rounded-md border border-dashed border-border p-2">
            {built.length === 0 ? (
              <span className="px-1 py-1 text-sm text-muted-foreground">{t.tapParts}</span>
            ) : (
              built.map((chunk, position) => {
                const mark = result?.marks?.[position];
                return (
                  <button
                    key={chunk.key}
                    type="button"
                    lang={contentLanguage}
                    onClick={() => putBack(chunk)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm transition-colors',
                      mark === undefined
                        ? 'border-border bg-background hover:bg-muted'
                        : mark
                          ? 'border-success/50 bg-success/10 text-success'
                          : 'border-destructive/50 bg-destructive/10 text-destructive',
                    )}
                  >
                    {chunk.text}
                  </button>
                );
              })
            )}
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
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors enabled:hover:bg-muted disabled:opacity-30"
                >
                  {chunk.text}
                </button>
              ))}
            </div>
          ) : null}

          {showTip && prompt.tip ? <p className="mt-4 text-sm text-muted-foreground">{prompt.tip}</p> : null}

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
              <Button onClick={() => void check()} disabled={built.length === 0}>
                {dictionary.common.check}
              </Button>
              <Button variant="outline" onClick={shuffle}>
                <Shuffle className="h-4 w-4" /> {t.shuffle}
              </Button>
              <Button variant="ghost" onClick={clear} disabled={built.length === 0}>
                <Eraser className="h-4 w-4" /> {t.clear}
              </Button>
              {prompt.tip ? (
                <Button variant="ghost" onClick={() => setShowTip(true)}>
                  {dictionary.common.hint}
                </Button>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {deck ? <DeckProgress summary={deck.summary} dictionary={dictionary} /> : null}
    </DrillShell>
  );
}
