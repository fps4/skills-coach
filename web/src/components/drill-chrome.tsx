'use client';

/**
 * Shared chrome for both drills: the shell, the deck bars, and the feedback panel.
 *
 * The feedback panel is where the pedagogy lives. Two cases matter more than "right/wrong":
 *
 * - **The other valid order.** Telling someone their correct Dutch is wrong teaches them the wrong
 *   thing, so it is called out as good Dutch in the wrong round and both orders are shown together.
 * - **The override.** Tolerant matching can never be complete, so a learner can insist they were
 *   right. It is recorded as an override rather than hidden.
 */

import type { ReactNode } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { AttemptResult, DeckSummary, Stage } from '@/lib/types';

export function DrillShell({
  title,
  intro,
  dictionary,
  summary,
  loading,
  error,
  empty,
  stage,
  onSwitchStage,
  onReset,
  children,
}: {
  title: string;
  intro: string;
  dictionary: Dictionary;
  summary?: DeckSummary;
  loading: boolean;
  error: string | null;
  empty: boolean;
  stage?: Stage;
  onSwitchStage: () => void;
  onReset: () => Promise<void>;
  blockId: string;
  children: ReactNode;
}) {
  const t = dictionary.drills;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted">{intro}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onSwitchStage}>
            ⇄ {stage === 2 ? t.stage1 : t.stage2}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              if (window.confirm(t.resetConfirm)) void onReset();
            }}
          >
            {dictionary.common.reset}
          </button>
        </div>
      </header>

      {error ? (
        <div className="card border-bad/40" role="alert">
          <p className="text-bad">{error}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="card text-muted">{dictionary.common.loading}</div>
      ) : empty ? (
        <div className="card">
          <p>{t.deckEmpty}</p>
          {/* Stage 2 being empty usually means it is not unlocked yet, not that there is nothing. */}
          <p className="mt-1 text-sm text-muted">
            {stage === 2 && summary && summary.stage2Unlocked === 0 ? t.locked : t.deckEmptyHint}
          </p>
        </div>
      ) : (
        <div className="card">{children}</div>
      )}
    </div>
  );
}

export function DeckProgress({ summary, dictionary }: { summary: DeckSummary; dictionary: Dictionary }) {
  const t = dictionary.progress;
  const width = (part: number): string => `${summary.total > 0 ? Math.round((part / summary.total) * 100) : 0}%`;

  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          {t.unlocked}: {summary.stage1Cleared}
        </span>
        <span>
          {dictionary.block.mastered}: {summary.mastered}/{summary.total}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {/* Two bars, as the trainers had: what has cleared direction one, and what is fully done. */}
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-warn transition-all" style={{ width: width(summary.stage1Cleared) }} />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-good transition-all" style={{ width: width(summary.mastered) }} />
        </div>
      </div>
    </div>
  );
}

export function Feedback({
  result,
  dictionary,
  contentLanguage,
  onNext,
  onOverride,
}: {
  result: AttemptResult;
  dictionary: Dictionary;
  contentLanguage: string;
  onNext: () => void;
  onOverride: () => void;
}) {
  const t = dictionary.drills;

  return (
    <div className="mt-5 border-t border-line pt-4">
      {result.correct ? (
        <p className="font-medium text-good">
          ✓ {t.correct}
          {result.overridden ? ` (${t.override})` : ''}
        </p>
      ) : result.otherValidOrder ? (
        // Good Dutch, wrong round — deliberately not phrased as an error.
        <p className="font-medium text-warn">↔ {t.otherValidOrder}</p>
      ) : (
        <p className="font-medium text-bad">✗ {t.incorrect}</p>
      )}

      <p className="mt-3 text-sm text-muted">{t.expected}</p>
      <p className="text-lg" lang={contentLanguage}>
        {result.expected}
      </p>

      {result.alternative && result.alternative !== result.expected ? (
        <>
          <p className="mt-3 text-sm text-muted">{t.bothOrders}</p>
          <p lang={contentLanguage}>{result.alternative}</p>
        </>
      ) : null}

      {result.tip ? <p className="mt-3 text-sm text-muted">{result.tip}</p> : null}

      {!result.correct && result.acceptedAlso?.length ? (
        <p className="mt-3 text-sm text-muted">
          {t.alsoAccepted}: {result.acceptedAlso.join(' · ')}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onNext} autoFocus>
          {dictionary.common.next}
        </button>
        {!result.correct ? (
          <button type="button" className="btn-secondary" onClick={onOverride} title={t.overrideHint}>
            {t.override} ✓
          </button>
        ) : null}
      </div>
    </div>
  );
}
