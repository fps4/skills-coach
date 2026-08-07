'use client';

/**
 * A list of answer options — the app's first selection control.
 *
 * One component covers both shapes because the *question* decides which it is, not the caller: a
 * key with one correct ref is a radio group, one with more is a set of checkboxes. Splitting them
 * would put that decision in the surface, where it would eventually disagree with the grader.
 *
 * Native inputs, deliberately. A hand-rolled listbox would have to re-earn arrow-key navigation
 * within a radio group, the announced name/checked state, and the browser's own focus ring; a
 * `<fieldset>` with a `<legend>` gets all of it and reads correctly the first time.
 *
 * `state` colours an option after grading and is absent before it, which is what keeps the answer
 * out of the page until the learner has committed (ADR-0014).
 */

import { Check, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { McqOption } from '@/lib/types';

/** What an option turned out to be, once there is a verdict. */
export type OptionState = 'correct' | 'missed' | 'wrong' | undefined;

export function OptionList({
  options,
  chosen,
  multiple,
  disabled,
  legend,
  lang,
  stateFor,
  onToggle,
}: {
  options: McqOption[];
  chosen: string[];
  multiple: boolean;
  disabled?: boolean;
  /** Names the group for assistive tech — the instruction, e.g. "Choose two". */
  legend: string;
  lang?: string;
  stateFor?: (ref: string) => OptionState;
  onToggle: (ref: string) => void;
}) {
  return (
    <fieldset disabled={disabled} className="mt-5 min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="space-y-2">
        {options.map((option) => {
          const isChosen = chosen.includes(option.ref);
          const state = stateFor?.(option.ref);

          return (
            <label
              key={option.ref}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                disabled ? 'cursor-default' : 'hover:border-primary/50',
                // A verdict outranks selection: an option the learner picked *and* got right should
                // read as right, not merely as picked.
                state === 'correct'
                  ? 'border-success/60 bg-success/10'
                  : state === 'wrong'
                    ? 'border-destructive/60 bg-destructive/10'
                    : state === 'missed'
                      ? 'border-success/40 border-dashed'
                      : isChosen
                        ? 'border-primary bg-primary/5'
                        : 'border-border',
              )}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name="quiz-option"
                value={option.ref}
                checked={isChosen}
                onChange={() => onToggle(option.ref)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0 flex-1 leading-relaxed" lang={lang}>
                {option.text}
              </span>
              {state === 'correct' || state === 'missed' ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : state === 'wrong' ? (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * What one segment of the strip knows about its question. `done` is the exam-mode case: answered,
 * but the verdict is deliberately being withheld until the sitting ends.
 */
export type QuestionMark = 'correct' | 'wrong' | 'done' | 'flagged' | undefined;

/**
 * The per-question strip: one segment per question in the sitting.
 *
 * A `Meter` is one bar and cannot say *which* questions are done — which is the thing a learner
 * wants at question 14 of 20.
 */
export function QuestionStrip({ marks, current, label }: { marks: QuestionMark[]; current: number; label: string }) {
  const fill: Record<Exclude<QuestionMark, undefined>, string> = {
    correct: 'bg-success',
    wrong: 'bg-destructive',
    done: 'bg-primary/60',
    flagged: 'bg-primary/30',
  };

  return (
    <div className="flex gap-1" role="img" aria-label={label}>
      {marks.map((mark, index) => (
        <span
          key={index}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            index === current ? 'bg-primary' : mark ? fill[mark] : 'bg-muted',
          )}
        />
      ))}
    </div>
  );
}
