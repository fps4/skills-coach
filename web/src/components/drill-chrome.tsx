'use client';

/**
 * Shared chrome for both drills: the page frame, the deck meters, and the feedback panel.
 *
 * The feedback panel is where the pedagogy lives. Two cases matter more than "right/wrong":
 *
 * - **The other valid order.** Telling someone their correct Dutch is wrong teaches them the wrong
 *   thing, so it is called out as good Dutch in the wrong round and both orders are shown together.
 * - **The override.** Tolerant matching can never be complete, so a learner can insist they were
 *   right. It is recorded as an override rather than hidden.
 */

import { ArrowRight, Check, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Meter, PageShell } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  children: ReactNode;
}) {
  const t = dictionary.drills;

  return (
    <PageShell title={title} subtitle={intro}>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onSwitchStage}>
          ⇄ {stage === 2 ? t.stage1 : t.stage2}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            if (window.confirm(t.resetConfirm)) void onReset();
          }}
        >
          <RotateCcw className="h-4 w-4" /> {dictionary.common.reset}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{dictionary.common.loading}</p>
      ) : empty ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm">{t.deckEmpty}</p>
            {/* An empty stage 2 usually means it is not unlocked yet, not that there is nothing. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {stage === 2 && summary && summary.stage2Unlocked === 0 ? t.locked : t.deckEmptyHint}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5">{children}</CardContent>
        </Card>
      )}
    </PageShell>
  );
}

export function DeckProgress({ summary, dictionary }: { summary: DeckSummary; dictionary: Dictionary }) {
  const t = dictionary.progress;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t.unlocked}: <span className="tabular-nums">{summary.stage1Cleared}</span>
        </span>
        <span>
          {dictionary.block.mastered}:{' '}
          <span className="tabular-nums">
            {summary.mastered}/{summary.total}
          </span>
        </span>
      </div>
      {/* Two meters, as the trainers had: what cleared direction one, and what is fully done. */}
      <div className="mt-2 space-y-1">
        <Meter value={summary.stage1Cleared} total={summary.total} />
        <Meter value={summary.mastered} total={summary.total} tone="success" />
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
    <div className="mt-5 space-y-3 border-t border-border pt-4">
      {result.correct ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Check className="h-4 w-4" />
          {t.correct}
          {result.overridden ? ` (${t.override})` : ''}
        </p>
      ) : result.otherValidOrder ? (
        // Good Dutch, wrong round — deliberately not phrased as an error.
        <p className="text-sm font-medium text-primary">↔ {t.otherValidOrder}</p>
      ) : (
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <X className="h-4 w-4" />
          {t.incorrect}
        </p>
      )}

      <div>
        <p className="text-xs text-muted-foreground">{t.expected}</p>
        <p className="text-base" lang={contentLanguage}>
          {result.expected}
        </p>
      </div>

      {result.alternative && result.alternative !== result.expected ? (
        <div>
          <p className="text-xs text-muted-foreground">{t.bothOrders}</p>
          <p lang={contentLanguage}>{result.alternative}</p>
        </div>
      ) : null}

      {result.tip ? <p className="text-sm text-muted-foreground">{result.tip}</p> : null}

      {!result.correct && result.acceptedAlso?.length ? (
        <p className="text-sm text-muted-foreground">
          {t.alsoAccepted}: {result.acceptedAlso.join(' · ')}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onNext} autoFocus>
          {dictionary.common.next} <ArrowRight className="h-4 w-4" />
        </Button>
        {!result.correct ? (
          <Button variant="ghost" onClick={onOverride} title={t.overrideHint}>
            {t.override}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
