'use client';

/**
 * The word trainer.
 *
 * Same rules as the browser trainer it replaces — two correct in a row clears a direction, the
 * reverse direction is gated behind the forward one, a wrong answer resets the streak, and there is
 * an "I was right" override for the cases tolerant matching gets wrong.
 *
 * The change is where those rules live. The old trainer had the answer in the page in order to
 * check it; here the answer arrives only *after* the learner commits, and progress follows the
 * learner rather than the browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { DeckProgress, DrillShell, Feedback } from './drill-chrome';
import { Pill } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientApi, query } from '@/lib/api-client';
import type { Dictionary } from '@/i18n/dictionaries';
import type { AttemptResult, DeckPage, DueItem, Stage } from '@/lib/types';

interface Props {
  blockId: string;
  contentLanguage: string;
  translationLanguage: string;
  dictionary: Dictionary;
}

export function WordDrill({ blockId, contentLanguage, translationLanguage, dictionary }: Props) {
  const t = dictionary.drills;

  const [deck, setDeck] = useState<DeckPage | null>(null);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage | undefined>(undefined);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await clientApi<DeckPage>(`/v1/drills${query({ blockId, kind: 'term', stage, limit: 40 })}`);
      setDeck(page);
      setIndex(0);
      setResult(null);
      setAnswer('');
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

  useEffect(() => {
    if (!result) inputRef.current?.focus();
  }, [current, result]);

  const check = async (override = false): Promise<void> => {
    if (!current) return;
    if (!override && answer.trim().length === 0) return;
    try {
      const outcome = await clientApi<AttemptResult>(`/v1/drills/${current.drillItemId}/attempts`, {
        method: 'POST',
        body: { stage: current.stage, given: answer, override },
      });
      setResult(outcome);
    } catch {
      setError(dictionary.common.error);
    }
  };

  const advance = (): void => {
    setResult(null);
    setAnswer('');
    setShowHint(false);
    // Past the end of the batch, ask for a fresh one — items not cleared come back.
    if (deck && index + 1 >= deck.items.length) void load();
    else setIndex((value) => value + 1);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (result) advance();
    else void check();
  };

  const prompt = current?.prompt.kind === 'term' ? current.prompt : null;
  // Stage 1 asks for the translation; stage 2 asks for the term, which is the spelling drill.
  const answerLanguage = current?.stage === 1 ? translationLanguage : contentLanguage;

  return (
    <DrillShell
      title={t.words}
      intro={t.wordsIntro}
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t.streak} {current.progress.streak}/2
            </p>
            <Pill>{current.stage === 1 ? t.stage1 : t.stage2}</Pill>
          </div>

          <p
            className="mt-4 text-2xl font-semibold tracking-tight"
            lang={current.stage === 1 ? contentLanguage : translationLanguage}
          >
            {prompt.prompt}
          </p>

          {showHint && prompt.hint ? (
            <p className="mt-2 text-sm text-muted-foreground" lang={contentLanguage}>
              {prompt.hint}
            </p>
          ) : null}

          <Input
            ref={inputRef}
            className="mt-5 text-base"
            lang={answerLanguage}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t.answerPlaceholder}
            value={answer}
            disabled={result !== null}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label={prompt.prompt}
          />

          {result ? (
            <Feedback
              result={result}
              dictionary={dictionary}
              contentLanguage={contentLanguage}
              onNext={advance}
              onOverride={() => void check(true)}
            />
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void check()} disabled={answer.trim().length === 0}>
                {dictionary.common.check}
              </Button>
              {prompt.hint ? (
                <Button variant="outline" onClick={() => setShowHint(true)}>
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
