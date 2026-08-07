'use client';

/**
 * The practice-test surface.
 *
 * Same server-side grading as the two drills — the browser sends what was picked and receives a
 * verdict, so the answer key is never in the page before the learner has committed to one. What is
 * new is the *sitting*: a fixed set of questions answered through in one go, in one of two modes.
 *
 * - **Practice** grades each answer as it is given, with the explanation. This is how you learn.
 * - **Exam** withholds every verdict until the end. This is how you rehearse committing to an
 *   answer you cannot check — the skill the real thing actually tests.
 *
 * The clock is advisory: it counts down and it says so when it runs out, and then nothing happens.
 * Voiding a sitting would destroy the evidence the next block gets written from, which is a strange
 * thing to do to someone for being slow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Clock, Flag, X } from 'lucide-react';

import { QuizResultsView } from './quiz-results';
import { Pill, PageShell } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { OptionList, QuestionStrip, type OptionState, type QuestionMark } from '@/components/ui/option-list';
import { clientApi, isSessionExpired } from '@/lib/api-client';
import type { Dictionary } from '@/i18n/dictionaries';
import type { QuizAnswerOutcome, QuizAnswerResult, QuizMode, QuizResults, QuizSessionView } from '@/lib/types';

/** Roughly the real exam's pace — 180 minutes over 75 questions. */
const SECONDS_PER_QUESTION = 144;

interface Props {
  blockId: string;
  contentLanguage: string;
  dictionary: Dictionary;
}

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

export function QuizRunner({ blockId, contentLanguage, dictionary }: Props) {
  const t = dictionary.quiz;

  const [view, setView] = useState<QuizSessionView | null>(null);
  const [results, setResults] = useState<QuizResults | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<QuizAnswerResult | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, boolean>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<QuizMode>('practice');
  const [timed, setTimed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [empty, setEmpty] = useState<string | null>(null);

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionExpired(cause)) setExpired(true);
      else setError(dictionary.common.error);
    },
    [dictionary.common.error],
  );

  // --- the clock ------------------------------------------------------------
  // Ticks only while a sitting is open. It stops at zero rather than going negative, and stopping
  // is all it does.
  const deadline = useRef<number | null>(null);
  useEffect(() => {
    if (deadline.current === null) return;
    const tick = (): void => {
      const left = Math.max(0, Math.round((deadline.current as number) - Date.now() / 1000));
      setRemaining(left);
    };
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [view?.session.sessionId]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setEmpty(null);
    try {
      const started = await clientApi<QuizSessionView>('/v1/quiz/sessions', {
        method: 'POST',
        body: {
          blockId,
          mode,
          ...(timed ? { limitSeconds: SECONDS_PER_QUESTION * 20 } : {}),
        },
      });
      deadline.current = started.session.limitSeconds ? Date.now() / 1000 + started.session.limitSeconds : null;
      setRemaining(started.session.limitSeconds ?? null);
      setView(started);
      setResults(null);
      setVerdicts({});
      setFlagged(new Set());
      setChosen([]);
      setFeedback(null);
    } catch (cause) {
      // A block with no questions, or one entirely mastered, is a state to explain — not an error.
      const message = cause instanceof Error ? cause.message : '';
      if (/mastered/i.test(message)) setEmpty(t.allMastered);
      else if (/questions in block/i.test(message)) setEmpty(t.noQuestions);
      else fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const current = view?.current ?? null;
  const prompt = current?.prompt.kind === 'mcq' ? current.prompt : null;

  const submit = async (): Promise<void> => {
    if (!view || !current || chosen.length === 0) return;
    setBusy(true);
    try {
      const outcome = await clientApi<QuizAnswerOutcome>(`/v1/quiz/sessions/${view.session.sessionId}/answers`, {
        method: 'POST',
        body: { drillItemId: current.drillItemId, chosen },
      });
      if (outcome.result) {
        setFeedback(outcome.result);
        setVerdicts((previous) => ({ ...previous, [current.drillItemId]: outcome.result?.correct ?? false }));
        setView(outcome.session);
      } else {
        // Exam mode: straight on, no verdict, nothing to read.
        setView(outcome.session);
        setChosen([]);
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const advance = (): void => {
    setFeedback(null);
    setChosen([]);
  };

  const finish = async (): Promise<void> => {
    if (!view) return;
    setBusy(true);
    try {
      setResults(await clientApi<QuizResults>(`/v1/quiz/sessions/${view.session.sessionId}/finish`, { method: 'POST' }));
      deadline.current = null;
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (ref: string): void => {
    if (!prompt) return;
    setChosen((previous) =>
      prompt.multiple ? (previous.includes(ref) ? previous.filter((entry) => entry !== ref) : [...previous, ref]) : [ref],
    );
  };

  const marks: QuestionMark[] = useMemo(() => {
    if (!view) return [];
    const answered = new Set(view.session.answers.map((entry) => entry.drillItemId));
    return view.session.itemIds.map((id) => {
      if (!answered.has(id)) return flagged.has(id) ? 'flagged' : undefined;
      const verdict = verdicts[id];
      // Exam mode has answers but no verdicts — 'done' is the honest mark for that.
      return verdict === undefined ? 'done' : verdict ? 'correct' : 'wrong';
    });
  }, [view, verdicts, flagged]);

  const stateFor = (ref: string): OptionState => {
    if (!feedback) return undefined;
    const isKey = feedback.correctRefs.includes(ref);
    const picked = chosen.includes(ref);
    if (isKey && picked) return 'correct';
    if (isKey) return 'missed';
    if (picked) return 'wrong';
    return undefined;
  };

  // --- results --------------------------------------------------------------

  if (results) {
    return (
      <QuizResultsView
        results={results}
        contentLanguage={contentLanguage}
        dictionary={dictionary}
        onRestart={() => {
          setResults(null);
          setView(null);
        }}
      />
    );
  }

  // --- the start screen -----------------------------------------------------

  if (!view) {
    return (
      <PageShell title={t.title} subtitle={t.intro}>
        {expired ? <SessionExpired dictionary={dictionary} /> : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Card>
          <CardContent className="space-y-5 pt-5">
            {empty ? (
              <>
                <p className="text-sm">{empty}</p>
                <p className="text-sm text-muted-foreground">{t.noQuestionsHint}</p>
              </>
            ) : (
              <>
                <fieldset>
                  <legend className="text-sm font-medium">{t.mode}</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <ModeCard
                      label={t.modePractice}
                      hint={t.modePracticeHint}
                      selected={mode === 'practice'}
                      onSelect={() => setMode('practice')}
                    />
                    <ModeCard
                      label={t.modeExam}
                      hint={t.modeExamHint}
                      selected={mode === 'exam'}
                      onSelect={() => setMode('exam')}
                    />
                  </div>
                </fieldset>

                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={timed}
                    onChange={(event) => setTimed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span>
                    <span className="font-medium">{t.timed}</span>
                    <span className="block text-muted-foreground">{t.timedHint}</span>
                  </span>
                </label>

                <Button onClick={() => void start()} disabled={busy}>
                  {t.start} <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  // --- the sitting ----------------------------------------------------------

  const answeredCount = view.session.answers.length;
  const total = view.session.itemIds.length;
  const isFlagged = current ? flagged.has(current.drillItemId) : false;

  return (
    <PageShell
      title={t.title}
      subtitle={
        <>
          {mode === 'exam' ? t.modeExam : t.modePractice} · {answeredCount}/{total}
        </>
      }
    >
      {expired ? <SessionExpired dictionary={dictionary} /> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <QuestionStrip marks={marks} current={current?.index ?? total} label={`${answeredCount}/${total}`} />
        {remaining !== null ? (
          <p
            className={`flex items-center gap-1.5 text-xs ${remaining === 0 ? 'text-destructive' : 'text-muted-foreground'}`}
            role={remaining === 0 ? 'alert' : undefined}
          >
            <Clock className="h-3.5 w-3.5" />
            {remaining === 0 ? t.timeUp : `${t.timeLeft} ${formatClock(remaining)}`}
          </p>
        ) : null}
      </div>

      <Card>
        <CardContent className="pt-5">
          {current && prompt ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {t.question} {current.index + 1} {dictionary.common.of} {total}
                </p>
                <Pill tone={prompt.multiple ? 'primary' : 'muted'}>
                  {prompt.multiple ? fill(t.chooseN, { n: prompt.choose }) : t.chooseOne}
                </Pill>
              </div>

              {/* These stems run to a paragraph, so this is prose — not a headline like the drills. */}
              <p className="mt-4 max-w-prose whitespace-pre-wrap leading-relaxed" lang={contentLanguage}>
                {prompt.prompt}
              </p>

              <OptionList
                options={prompt.options}
                chosen={chosen}
                multiple={prompt.multiple}
                disabled={feedback !== null || busy}
                legend={prompt.multiple ? fill(t.chooseN, { n: prompt.choose }) : t.chooseOne}
                lang={contentLanguage}
                stateFor={stateFor}
                onToggle={toggle}
              />

              {feedback ? (
                <Feedback
                  result={feedback}
                  dictionary={dictionary}
                  contentLanguage={contentLanguage}
                  last={answeredCount >= total}
                  onNext={advance}
                  onFinish={() => void finish()}
                />
              ) : (
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button onClick={() => void submit()} disabled={chosen.length === 0 || busy}>
                    {t.submitAnswer}
                  </Button>
                  {prompt.multiple ? (
                    <span className="text-xs text-muted-foreground">
                      {fill(t.chosenN, { n: chosen.length, total: prompt.choose })}
                    </span>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground"
                    onClick={() =>
                      setFlagged((previous) => {
                        const next = new Set(previous);
                        if (next.has(current.drillItemId)) next.delete(current.drillItemId);
                        else next.add(current.drillItemId);
                        return next;
                      })
                    }
                  >
                    <Flag className={`h-4 w-4 ${isFlagged ? 'fill-current' : ''}`} />
                    {isFlagged ? t.flagged : t.flag}
                  </Button>
                </div>
              )}
            </>
          ) : (
            // Answered through: in exam mode this is the first moment anything is revealed.
            <div className="space-y-4">
              <p className="text-sm">
                {t.answered}: {answeredCount}/{total}
              </p>
              <Button onClick={() => void finish()} disabled={busy}>
                {t.finish} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

function ModeCard({ label, hint, selected, onSelect }: { label: string; hint: string; selected: boolean; onSelect: () => void }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
      }`}
    >
      <input
        type="radio"
        name="quiz-mode"
        checked={selected}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/** The verdict, then the teaching. Practice mode only — exam mode never reaches this. */
function Feedback({
  result,
  dictionary,
  contentLanguage,
  last,
  onNext,
  onFinish,
}: {
  result: QuizAnswerResult;
  dictionary: Dictionary;
  contentLanguage: string;
  last: boolean;
  onNext: () => void;
  onFinish: () => void;
}) {
  const t = dictionary.quiz;

  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4">
      {result.correct ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Check className="h-4 w-4" />
          {t.correct}
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <X className="h-4 w-4" />
          {t.incorrect}
        </p>
      )}

      <div>
        <p className="text-xs text-muted-foreground">{t.whyRight}</p>
        <p className="max-w-prose leading-relaxed" lang={contentLanguage}>
          {result.explanation}
        </p>
      </div>

      {/* Most of the teaching is here: knowing why the plausible option fails is the actual skill. */}
      {result.distractors?.length ? (
        <div>
          <p className="text-xs text-muted-foreground">{t.whyWrong}</p>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground" lang={contentLanguage}>
            {result.distractors.map((entry) => (
              <li key={entry.ref}>{entry.why}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.sourceRefs?.length ? (
        <p className="text-xs text-muted-foreground">
          {t.sources}:{' '}
          {result.sourceRefs.map((href, index) => (
            <span key={href}>
              {index > 0 ? ' · ' : ''}
              <a href={href} target="_blank" rel="noreferrer noopener" className="underline hover:text-foreground">
                {href.replace(/^https?:\/\//, '').slice(0, 60)}
              </a>
            </span>
          ))}
        </p>
      ) : null}

      <Button onClick={last ? onFinish : onNext} autoFocus>
        {last ? t.finish : dictionary.common.next} <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function SessionExpired({ dictionary }: { dictionary: Dictionary }) {
  return (
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
  );
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
