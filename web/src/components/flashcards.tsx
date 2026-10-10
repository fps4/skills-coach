'use client';

/**
 * Flashcards (ADR-0027) — one surface for a word deck and a deck of concepts.
 *
 * The rules are the word trainer's, unchanged: two right in a row clears a direction, direction 2
 * opens only once direction 1 is cleared, a miss sends the streak back to zero, and a mastered card
 * stays mastered. What a skill chooses is how a card is answered:
 *
 * - **typed** — type the back; the server matches it tolerantly, and a rejection can be accepted
 *   anyway. A word has a spelling, so this is the test that fits.
 * - **self** — turn the card over, then say whether you had it. A concept's back is a sentence
 *   nobody would reproduce verbatim, so matching it would only ever be wrong.
 *
 * Either way the back of a card reaches the page only after the learner commits — an answer, or an
 * explicit "show answer". **Learn** mode is the one deliberate exception: the learner asked to see
 * each card with its answer, so it comes with the deck, and nothing done in learn mode is recorded.
 *
 * Every action has a key, shown on its button. The listener lives on the document only while this
 * surface is mounted — it is this page's keyboard, not the app's.
 */

import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { OwnWords } from './own-words';
import { TermCard } from './term-card';
import { PageShell } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { clientApi, isSessionExpired, query } from '@/lib/api-client';
import { applyProgress } from '@/lib/deck-summary';
import {
  ariaShortcut,
  gradeStatus,
  keyAction,
  SHORTCUTS,
  type FlashcardAction,
  type FlashcardPhase,
  type KeyContext,
} from '@/lib/flashcards';
import { cn } from '@/lib/utils';
import type { Dictionary } from '@/i18n/dictionaries';
import type {
  AttemptResult,
  CardFace,
  CardGrading,
  DeckMode,
  DeckPage,
  DeckSummary,
  DueItem,
  RevealResult,
  Stage,
} from '@/lib/types';

interface Props {
  blockId: string;
  contentLanguage: string;
  translationLanguage: string;
  grading: CardGrading;
  dictionary: Dictionary;
  /** Where "Add cards" goes, for the empty deck. */
  addHref: string;
}

/** A key badge on a button. Coloured by the button it sits on, so it never needs a colour of its own. */
function Kbd({ action }: { action: FlashcardAction }) {
  return (
    <kbd className="ml-1 rounded border border-current px-1 font-mono text-[10px] leading-4 opacity-60">
      {SHORTCUTS[action].badge}
    </kbd>
  );
}

/** A two-way switch, styled like the page's other segmented controls. */
function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; action: FlashcardAction }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1 rounded-lg bg-muted p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            aria-keyshortcuts={ariaShortcut(option.action)}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center rounded-md px-3 py-1.5 text-sm transition-colors',
              active ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
            {active ? null : <Kbd action={option.action} />}
          </button>
        );
      })}
    </div>
  );
}

function SummaryRow({ summary, dictionary }: { summary: DeckSummary; dictionary: Dictionary }) {
  const t = dictionary.flashcards;
  const cells: [string, number][] = [
    [t.total, summary.total],
    [t.cleared, summary.stage1Cleared],
    [t.inDirection2, summary.stage2Unlocked],
    [t.mastered, summary.mastered],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Two dots: how far along the current direction this card is. */
function StreakDots({ streak, label }: { streak: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`${label} ${Math.min(streak, 2)}/2`}>
      {[0, 1].map((dot) => (
        <span
          key={dot}
          aria-hidden
          className={cn('h-2 w-2 rounded-full', dot < streak ? 'bg-primary' : 'border border-border bg-muted')}
        />
      ))}
    </span>
  );
}

/**
 * The back of a card: the answer, and everything that explains it. Shared by a reveal, a typed
 * verdict and learn mode, so a card reads the same whichever way it was turned over.
 */
function CardBack({
  face,
  answerLabel,
  answerLanguage,
  contentLanguage,
  translationLanguage,
  dictionary,
  showAnswer = true,
}: {
  face: CardFace;
  answerLabel: string;
  answerLanguage: string;
  contentLanguage: string;
  translationLanguage: string;
  dictionary: Dictionary;
  /** A typed verdict shows the answer itself, above. */
  showAnswer?: boolean;
}) {
  const t = dictionary.flashcards;
  const details = face.details;
  return (
    <div className="mt-5 space-y-4 border-t border-dashed border-border pt-4">
      {showAnswer ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{answerLabel}</p>
          <p className="mt-1 text-lg" lang={answerLanguage}>
            {face.expected}
          </p>
        </div>
      ) : null}

      {details?.code ? (
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2.5 font-mono text-sm leading-relaxed">
          <code>{details.code}</code>
        </pre>
      ) : null}

      {details?.analogy ? (
        <div className="border-l-2 border-primary pl-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.analogy}</p>
          <p className="mt-1 text-sm" lang={translationLanguage}>
            {details.analogy}
          </p>
        </div>
      ) : null}

      {/* Forms, example, synonyms, a note — a word's card, as it always was (ADR-0023). */}
      <TermCard
        example={face.example}
        details={details}
        contentLanguage={contentLanguage}
        translationLanguage={translationLanguage}
        dictionary={dictionary}
      />

      {details?.source ? (
        <p className="text-xs text-muted-foreground">
          {t.fromTheGuide} · <span lang={translationLanguage}>{details.source}</span>
        </p>
      ) : null}
    </div>
  );
}

export function Flashcards({ blockId, contentLanguage, translationLanguage, grading, dictionary, addHref }: Props) {
  const t = dictionary.flashcards;

  const [mode, setMode] = useState<DeckMode>('practice');
  /** The direction asked for. Undefined serves each card at whatever stage it sits on. */
  const [stage, setStage] = useState<Stage | undefined>(undefined);
  const [deck, setDeck] = useState<DeckPage | null>(null);
  // Beside the deck rather than inside it: the meters move on every answer, the deck does not.
  const [summary, setSummary] = useState<DeckSummary | null>(null);
  const [index, setIndex] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [revealed, setRevealed] = useState<RevealResult | null>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<AttemptResult | null>(null);
  /** What the progress was before the first verdict on this card — an override re-grades from it. */
  const [before, setBefore] = useState<DueItem['progress'] | null>(null);
  const [tally, setTally] = useState({ got: 0, missed: 0 });
  const [batchDone, setBatchDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionExpired(cause)) setExpired(true);
      else setError(dictionary.common.error);
    },
    [dictionary.common.error],
  );

  const resetCard = (): void => {
    setShowHint(false);
    setRevealed(null);
    setAnswer('');
    setResult(null);
    setBefore(null);
  };

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setExpired(false);
    try {
      // The API's maximum, so a batch is the whole rotation wherever the deck fits in one.
      const page = await clientApi<DeckPage>(
        `/v1/drills${query({ blockId, kind: 'term', stage, limit: 100, mode: mode === 'learn' ? 'learn' : undefined })}`,
      );
      setDeck(page);
      setSummary(page.summary);
      setIndex(0);
      setTally({ got: 0, missed: 0 });
      setBatchDone(false);
      resetCard();
    } catch (cause) {
      fail(cause);
    } finally {
      setLoading(false);
    }
  }, [blockId, stage, mode, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = deck?.items ?? [];
  const current: DueItem | undefined = batchDone ? undefined : items[index];
  const prompt = current?.prompt.kind === 'term' ? current.prompt : null;
  const cardStage: Stage = current?.stage ?? stage ?? 1;
  const shownDirection: Stage = stage ?? current?.stage ?? 1;
  // Direction 1 asks the term and wants the meaning; direction 2 the other way round.
  const promptLanguage = cardStage === 1 ? contentLanguage : translationLanguage;
  const answerLanguage = cardStage === 1 ? translationLanguage : contentLanguage;
  const promptLabel = cardStage === 1 ? t.term : t.meaning;
  const answerLabel = cardStage === 1 ? t.meaning : t.term;

  useEffect(() => {
    if (mode === 'practice' && grading === 'typed' && current && !result) inputRef.current?.focus();
  }, [current, result, mode, grading]);

  // --- actions --------------------------------------------------------------

  const reveal = async (): Promise<void> => {
    if (!current || revealed) return;
    try {
      setRevealed(
        await clientApi<RevealResult>(`/v1/drills/${current.drillItemId}/reveal`, {
          method: 'POST',
          body: { stage: current.stage },
        }),
      );
    } catch (cause) {
      fail(cause);
    }
  };

  const submit = async (body: Record<string, unknown>): Promise<void> => {
    if (!current) return;
    // An override grades a second time, so what it moves from is the first verdict, not the deck.
    const from = result?.progress ?? current.progress;
    try {
      const outcome = await clientApi<AttemptResult>(`/v1/drills/${current.drillItemId}/attempts`, {
        method: 'POST',
        body: { stage: current.stage, ...body },
      });
      if (!before) setBefore(current.progress);
      setResult(outcome);
      setSummary((previous) => (previous ? applyProgress(previous, from, outcome.progress) : previous));
    } catch (cause) {
      fail(cause);
    }
  };

  // An empty answer goes to the server like any other: "I don't know" is graded there, not here.
  const check = (override = false) => submit({ given: answer, override });
  const selfGrade = (verdict: 'got' | 'missed') => submit({ self: verdict });

  const next = (): void => {
    if (batchDone) {
      void load();
      return;
    }
    if (result)
      setTally((counts) => (result.correct ? { ...counts, got: counts.got + 1 } : { ...counts, missed: counts.missed + 1 }));
    resetCard();
    if (index + 1 >= items.length) setBatchDone(true);
    else setIndex((value) => value + 1);
  };

  const learnStep = (delta: 1 | -1): void => {
    setIndex((value) => Math.max(0, Math.min(items.length - 1, value + delta)));
  };

  const switchMode = (value: DeckMode): void => {
    if (value !== mode) setMode(value);
  };
  const switchDirection = (value: Stage): void => setStage(value);
  const toggleDirection = (): void => setStage(shownDirection === 2 ? 1 : 2);

  // --- the keyboard ---------------------------------------------------------

  const phase: FlashcardPhase = loading
    ? 'idle'
    : batchDone
      ? 'batch-done'
      : !current
        ? 'idle'
        : result
          ? 'graded'
          : revealed
            ? 'revealed'
            : 'question';

  const context: KeyContext = {
    mode,
    grading,
    phase,
    canAccept: grading === 'typed' && result !== null && !result.correct,
    canGoBack: index > 0,
    canGoForward: index + 1 < items.length,
  };

  const perform = (action: FlashcardAction): void => {
    switch (action) {
      case 'learn':
        return switchMode('learn');
      case 'practise':
        return switchMode('practice');
      case 'direction':
        return toggleDirection();
      case 'hint':
        if (prompt?.hint) setShowHint(true);
        return;
      case 'reveal':
        return void reveal();
      case 'got':
        return void selfGrade('got');
      case 'missed':
        return void selfGrade('missed');
      case 'accept':
        return void check(true);
      case 'back':
        return learnStep(-1);
      case 'next':
        return mode === 'learn' ? learnStep(1) : next();
    }
  };

  // Read through a ref, so the listener is bound once per mount and still sees this render's state.
  const latest = useRef({ context, perform });
  latest.current = { context, perform };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = keyAction(event, latest.current.context);
      if (!action) return;
      event.preventDefault();
      latest.current.perform(action);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      // Leave the box, so the letter keys become commands — the way to reach the hint by keyboard.
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key !== 'Enter') return;
    // Handled here, so the document listener sees it as handled and does not advance twice.
    event.preventDefault();
    if (result) next();
    else void check();
  };

  const button = (
    action: FlashcardAction,
    label: ReactNode,
    onClick: () => void,
    props: Partial<React.ComponentProps<typeof Button>> = {},
  ) => (
    <Button aria-keyshortcuts={ariaShortcut(action)} onClick={onClick} {...props}>
      {label}
      <Kbd action={action} />
    </Button>
  );

  // --- render ---------------------------------------------------------------

  const status = result && before ? gradeStatus(before, result.progress, result.correct) : null;
  const statusText = status
    ? { mastered: t.statusMastered, cleared: t.statusCleared, reset: t.statusReset, 'one-more': t.statusOneMore }[status]
    : null;
  const learnFace: CardFace | undefined = mode === 'learn' ? current?.card : undefined;
  const typedFace: CardFace | null =
    result && grading === 'typed' ? { expected: result.expected, example: result.example, details: result.details } : null;

  const emptyState = (): ReactNode => {
    if (!summary || summary.total === 0) {
      return (
        <>
          <p className="text-sm font-medium">{t.empty}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.emptyHint}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={addHref}>{t.addCards}</Link>
          </Button>
        </>
      );
    }
    if (summary.mastered === summary.total) {
      return (
        <>
          <p className="text-sm font-medium">{t.allMastered}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.allMasteredHint}</p>
        </>
      );
    }
    // An empty direction 2 usually means it has not opened yet — a different fact from "nothing left".
    if (shownDirection === 2 && summary.stage2Unlocked === 0) {
      return (
        <>
          <p className="text-sm font-medium">{t.locked}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.lockedHint}</p>
        </>
      );
    }
    return <p className="text-sm">{t.nothingDue}</p>;
  };

  return (
    <PageShell title={t.title} subtitle={mode === 'learn' ? t.learnIntro : grading === 'self' ? t.introSelf : t.introTyped}>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={t.mode}
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'practice', label: t.practise, action: 'practise' },
            { value: 'learn', label: t.learn, action: 'learn' },
          ]}
        />
        <Segmented
          label={t.direction}
          value={shownDirection}
          onChange={switchDirection}
          options={[
            { value: 1 as Stage, label: t.direction1, action: 'direction' },
            { value: 2 as Stage, label: t.direction2, action: 'direction' },
          ]}
        />
      </div>

      {summary ? <SummaryRow summary={summary} dictionary={dictionary} /> : null}

      {expired ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-destructive">{dictionary.common.sessionExpired}</p>
          <Button
            size="sm"
            onClick={() => {
              const here = window.location.pathname + window.location.search;
              window.location.assign(`/login?next=${encodeURIComponent(here)}`);
            }}
          >
            {dictionary.common.signInAgain}
          </Button>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{dictionary.common.loading}</p>
      ) : (
        <Card className="border-t-4 border-t-primary">
          <CardContent className="pt-5">
            {batchDone ? (
              <div>
                <p className="text-lg font-semibold">{t.batchDone}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="tabular-nums text-success">
                    {tally.got} {t.got}
                  </span>
                  {' · '}
                  <span className="tabular-nums text-destructive">
                    {tally.missed} {t.missed}
                  </span>
                </p>
                <div className="mt-4">{button('next', t.nextBatch, next)}</div>
              </div>
            ) : !current || !prompt ? (
              emptyState()
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {t.card} {index + 1} {dictionary.common.of} {items.length} {t.inBatch}
                  </span>
                  {mode === 'practice' ? (
                    <StreakDots streak={(result?.progress ?? current.progress).streak} label={t.streak} />
                  ) : null}
                </div>

                <div className="mt-4">
                  {prompt.group ? (
                    <p className="text-xs font-medium uppercase tracking-wide text-primary">{prompt.group}</p>
                  ) : null}
                  <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{promptLabel}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight" lang={promptLanguage}>
                    {prompt.prompt}
                  </p>
                </div>

                {/* The hint: the cue, masked by the server where it would give the answer away. */}
                {mode === 'practice' && showHint && prompt.hint ? (
                  <p className="mt-3 text-sm italic text-muted-foreground" lang={contentLanguage}>
                    {prompt.hint}
                  </p>
                ) : null}
                {learnFace?.hint ? (
                  <p className="mt-3 text-sm italic text-muted-foreground" lang={contentLanguage}>
                    {learnFace.hint}
                  </p>
                ) : null}

                {mode === 'learn' && learnFace ? (
                  <>
                    <CardBack
                      face={learnFace}
                      answerLabel={answerLabel}
                      answerLanguage={answerLanguage}
                      contentLanguage={contentLanguage}
                      translationLanguage={translationLanguage}
                      dictionary={dictionary}
                    />
                    <div className="mt-5 flex flex-wrap gap-2">
                      {button(
                        'back',
                        <>
                          <ArrowLeft className="h-4 w-4" /> {t.back}
                        </>,
                        () => learnStep(-1),
                        {
                          variant: 'outline',
                          disabled: index === 0,
                        },
                      )}
                      {button(
                        'next',
                        <>
                          {t.next} <ArrowRight className="h-4 w-4" />
                        </>,
                        () => learnStep(1),
                        {
                          disabled: index + 1 >= items.length,
                        },
                      )}
                    </div>
                  </>
                ) : grading === 'self' ? (
                  <>
                    {!revealed ? (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {prompt.hint
                          ? button('hint', t.hint, () => setShowHint(true), { variant: 'outline', disabled: showHint })
                          : null}
                        {button('reveal', t.showAnswer, () => void reveal())}
                      </div>
                    ) : (
                      <>
                        <CardBack
                          face={revealed}
                          answerLabel={answerLabel}
                          answerLanguage={answerLanguage}
                          contentLanguage={contentLanguage}
                          translationLanguage={translationLanguage}
                          dictionary={dictionary}
                        />
                        {!result ? (
                          <div className="mt-5">
                            <p className="text-sm font-medium">{t.didYouHaveIt}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {button(
                                'missed',
                                <>
                                  <X className="h-4 w-4" /> {t.missedIt}
                                </>,
                                () => void selfGrade('missed'),
                                {
                                  variant: 'outline',
                                  className: 'border-destructive text-destructive hover:bg-destructive/10',
                                },
                              )}
                              {button(
                                'got',
                                <>
                                  <Check className="h-4 w-4" /> {t.gotIt}
                                </>,
                                () => void selfGrade('got'),
                                {
                                  className: 'bg-success text-success-foreground hover:bg-success/90',
                                },
                              )}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Input
                      ref={inputRef}
                      className="mt-5 text-base"
                      lang={answerLanguage}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder={t.answerPlaceholder}
                      value={answer}
                      // Read-only rather than disabled once a verdict is in: it keeps focus, so
                      // Enter, N and A all work without reaching for the mouse.
                      readOnly={result !== null}
                      onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={onInputKeyDown}
                      aria-label={prompt.prompt}
                      title={t.escapeHint}
                    />
                    {!result ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button onClick={() => void check()} aria-keyshortcuts="Enter">
                          {t.check}
                          <kbd className="ml-1 rounded border border-current px-1 font-mono text-[10px] leading-4 opacity-60">
                            ↵
                          </kbd>
                        </Button>
                        {prompt.hint
                          ? button('hint', t.hint, () => setShowHint(true), { variant: 'outline', disabled: showHint })
                          : null}
                      </div>
                    ) : (
                      <div className="mt-5 space-y-2">
                        {result.correct ? (
                          <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                            <Check className="h-4 w-4" />
                            {t.correct}
                            {result.overridden ? ` (${t.accepted})` : ''}
                          </p>
                        ) : (
                          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                            <X className="h-4 w-4" />
                            {t.incorrect}
                          </p>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground">{t.rightAnswer}</p>
                          <p className="text-base" lang={answerLanguage}>
                            {result.expected}
                          </p>
                        </div>
                        {!result.correct && result.acceptedAlso?.length ? (
                          <p className="text-sm text-muted-foreground">
                            {t.alsoAccepted}: {result.acceptedAlso.join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    )}
                    {typedFace ? (
                      <CardBack
                        face={typedFace}
                        showAnswer={false}
                        answerLabel={answerLabel}
                        answerLanguage={answerLanguage}
                        contentLanguage={contentLanguage}
                        translationLanguage={translationLanguage}
                        dictionary={dictionary}
                      />
                    ) : null}
                  </>
                )}

                {mode === 'practice' && result ? (
                  <div className="mt-5 space-y-3 border-t border-border pt-4">
                    {statusText ? (
                      <p className="text-sm text-muted-foreground" role="status">
                        {statusText}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {button(
                        'next',
                        <>
                          {t.next} <ArrowRight className="h-4 w-4" />
                        </>,
                        next,
                      )}
                      {context.canAccept
                        ? button('accept', t.acceptAnyway, () => void check(true), {
                            variant: 'ghost',
                            title: t.acceptAnywayHint,
                          })
                        : null}
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {/* A typed deck keeps its own-words form under the card, whether or not a card is showing. */}
            {grading === 'typed' && mode === 'practice' ? (
              <OwnWords
                blockId={blockId}
                contentLanguage={contentLanguage}
                translationLanguage={translationLanguage}
                dictionary={dictionary}
                onChanged={() => void load()}
                onSessionExpired={() => setExpired(true)}
              />
            ) : null}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
