/**
 * Collection names, stored document shapes, and typed accessors.
 *
 * Documents use application-generated string `_id`s rather than ObjectIds, so an identifier that
 * appears in a URL is the same string that is stored — nothing to convert, nothing to leak.
 *
 * With no schema enforcement in the storage layer (ADR-0003), the guarantee that these shapes hold
 * comes from every write passing through a service that validated against `domain/schemas.ts`.
 */

import type { Collection, Db } from 'mongodb';
import type {
  Attempt,
  Block,
  BlockReview,
  Correction,
  DrillItem,
  Enrollment,
  ErrorLogEntry,
  Learner,
  Lesson,
  PackManifest,
  QuizSession,
  Submission,
} from '../domain/types.js';
import type { DrillProgress } from '../domain/drill-progress.js';

export const COLLECTIONS = {
  packs: 'packs',
  blocks: 'blocks',
  lessons: 'lessons',
  drillItems: 'drillItems',
  learners: 'learners',
  enrollments: 'enrollments',
  drillState: 'drillState',
  attempts: 'attempts',
  submissions: 'submissions',
  corrections: 'corrections',
  errorLog: 'errorLog',
  blockReviews: 'blockReviews',
  quizSessions: 'quizSessions',
  auditEvents: 'auditEvents',
} as const;

export type PackDoc = PackManifest & { _id: string; createdAt: Date; updatedAt: Date };
export type BlockDoc = Omit<Block, 'blockId'> & { _id: string };
export type LessonDoc = Omit<Lesson, 'lessonId'> & { _id: string };
export type DrillItemDoc = Omit<DrillItem, 'drillItemId'> & { _id: string };
export type LearnerDoc = Omit<Learner, 'learnerId'> & { _id: string };
export type EnrollmentDoc = Enrollment & { _id: string };
export type AttemptDoc = Attempt & { _id: string };
export type SubmissionDoc = Omit<Submission, 'submissionId'> & { _id: string };
export type CorrectionDoc = Omit<Correction, 'correctionId'> & { _id: string };
export type ErrorLogDoc = ErrorLogEntry & { _id: string };
export type BlockReviewDoc = BlockReview & { _id: string };
/** A sitting is an event, so its id is random. What it *scored* is derived, never stored. */
export type QuizSessionDoc = Omit<QuizSession, 'sessionId'> & { _id: string };

/** Per learner, per drill item: the spaced-repetition state. */
export type DrillStateDoc = DrillProgress & {
  _id: string;
  learnerId: string;
  drillItemId: string;
  packId: string;
  blockId: string;
  updatedAt: Date;
};

/** Append-only. Bounded by a TTL index rather than by pruning logic (ADR-0003). */
export interface AuditEventDoc {
  _id: string;
  at: Date;
  actor: { subject: string; kind: 'user' | 'client'; roles: string[] };
  action: string;
  resource: string;
  meta?: Record<string, unknown>;
}

export interface Collections {
  packs: Collection<PackDoc>;
  blocks: Collection<BlockDoc>;
  lessons: Collection<LessonDoc>;
  drillItems: Collection<DrillItemDoc>;
  learners: Collection<LearnerDoc>;
  enrollments: Collection<EnrollmentDoc>;
  drillState: Collection<DrillStateDoc>;
  attempts: Collection<AttemptDoc>;
  submissions: Collection<SubmissionDoc>;
  corrections: Collection<CorrectionDoc>;
  errorLog: Collection<ErrorLogDoc>;
  blockReviews: Collection<BlockReviewDoc>;
  quizSessions: Collection<QuizSessionDoc>;
  auditEvents: Collection<AuditEventDoc>;
}

/**
 * Strip `_id` from a document about to be used as a replacement.
 *
 * `replaceOne` refuses a replacement that restates `_id` — the filter already fixes it, and on an
 * upsert MongoDB takes the `_id` from the filter. Doing this through one helper keeps every call
 * site honest about which value is authoritative.
 */
export function withoutId<T extends { _id: string }>(doc: T): Omit<T, '_id'> {
  const { _id: _ignored, ...rest } = doc;
  return rest;
}

export function collections(db: Db): Collections {
  return {
    packs: db.collection<PackDoc>(COLLECTIONS.packs),
    blocks: db.collection<BlockDoc>(COLLECTIONS.blocks),
    lessons: db.collection<LessonDoc>(COLLECTIONS.lessons),
    drillItems: db.collection<DrillItemDoc>(COLLECTIONS.drillItems),
    learners: db.collection<LearnerDoc>(COLLECTIONS.learners),
    enrollments: db.collection<EnrollmentDoc>(COLLECTIONS.enrollments),
    drillState: db.collection<DrillStateDoc>(COLLECTIONS.drillState),
    attempts: db.collection<AttemptDoc>(COLLECTIONS.attempts),
    submissions: db.collection<SubmissionDoc>(COLLECTIONS.submissions),
    corrections: db.collection<CorrectionDoc>(COLLECTIONS.corrections),
    errorLog: db.collection<ErrorLogDoc>(COLLECTIONS.errorLog),
    blockReviews: db.collection<BlockReviewDoc>(COLLECTIONS.blockReviews),
    quizSessions: db.collection<QuizSessionDoc>(COLLECTIONS.quizSessions),
    auditEvents: db.collection<AuditEventDoc>(COLLECTIONS.auditEvents),
  };
}
