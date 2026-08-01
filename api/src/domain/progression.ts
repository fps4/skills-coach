/**
 * Progression: lessons, never dates.
 *
 * From the program this replaces: "Lessons, not weekdays. One lesson ≈ one sitting. Skip a day and
 * you simply pick up at the next lesson — nothing falls out of sync." Every function here is a
 * function of *position*, never of elapsed time, which is what makes that promise hold.
 *
 * Pure: no I/O, no clock.
 */

import type { Lesson, Section, SubmissionAnswer } from './types.js';

/** The next lesson in a block, or null when the block is exhausted. */
export function nextLessonOrder(currentOrder: number, lessonCount: number): number | null {
  const next = currentOrder + 1;
  return next <= lessonCount ? next : null;
}

export interface BlockProgress {
  lessonCount: number;
  completed: number;
  /** Lessons with a submission that has been corrected. */
  correctedOrders: number[];
  /** Lessons submitted but still waiting on the coach. */
  pendingOrders: number[];
  nextLessonOrder: number | null;
  complete: boolean;
}

/**
 * A block is complete when every lesson has been corrected. Pending submissions do not count:
 * the work is not done until the feedback exists, because the feedback is what feeds the next block.
 */
export function blockProgress(lessonCount: number, correctedOrders: number[], pendingOrders: number[]): BlockProgress {
  const corrected = [...new Set(correctedOrders)].sort((a, b) => a - b);
  const pending = [...new Set(pendingOrders)].filter((order) => !corrected.includes(order)).sort((a, b) => a - b);
  const touched = new Set([...corrected, ...pending]);

  let next: number | null = null;
  for (let order = 1; order <= lessonCount; order += 1) {
    if (!touched.has(order)) {
      next = order;
      break;
    }
  }

  return {
    lessonCount,
    completed: corrected.length,
    correctedOrders: corrected,
    pendingOrders: pending,
    nextLessonOrder: next,
    complete: lessonCount > 0 && corrected.length >= lessonCount,
  };
}

/** Sections that ask the learner for writing — these are what a submission answers. */
export function writableSections(lesson: Lesson): Section[] {
  return lesson.sections.filter(
    (section) =>
      section.kind === 'write' ||
      section.kind === 'questions' ||
      section.kind === 'exercise' ||
      section.kind === 'dictation',
  );
}

/** Every answer reference a submission for this lesson may legitimately carry. */
export function expectedAnswerRefs(lesson: Lesson): string[] {
  const refs: string[] = [];
  for (const section of lesson.sections) {
    switch (section.kind) {
      case 'write':
      case 'dictation':
        refs.push(section.id);
        break;
      case 'questions':
      case 'exercise':
        for (const item of section.items) refs.push(`${section.id}.${item.ref}`);
        break;
      default:
        break;
    }
  }
  return refs;
}

/**
 * References a submission carries that the lesson does not define. Reported rather than rejected —
 * a lesson can be re-published with a section renamed, and losing a learner's answers to that would
 * be worse than carrying an orphan reference.
 */
export function unknownAnswerRefs(lesson: Lesson, answers: SubmissionAnswer[]): string[] {
  const expected = new Set(expectedAnswerRefs(lesson));
  return answers.map((answer) => answer.ref).filter((ref) => !expected.has(ref));
}

/** Whether a submission has anything in it worth correcting. */
export function hasContent(answers: SubmissionAnswer[]): boolean {
  return answers.some((answer) => answer.text.trim().length > 0);
}
