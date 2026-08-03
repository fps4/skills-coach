/**
 * Learner profiles and enrollment.
 *
 * The profile is deliberately thin (ADR-0002): a display name and a UI language preference, keyed
 * on the token's `sub`. Everything else about who a person is stays in identity-service.
 *
 * A learner record is created on first sight of a subject rather than by a registration flow —
 * there is nothing to register, because identity-service already decided this person may be here.
 */

import { randomUUID } from 'node:crypto';
import { notFound } from '../http/errors.js';
import type { Principal } from '../auth/verifier.js';
import type { PatchMeInput } from '../domain/schemas.js';
import { DEFAULT_LOCALE, type Enrollment, type Learner } from '../domain/types.js';
import type { LearnerDoc } from '../db/collections.js';
import { enrollmentIdFor, type ServiceContext } from './context.js';

const toLearner = (doc: LearnerDoc): Learner => {
  const { _id, ...rest } = doc;
  return { ...rest, learnerId: _id };
};

/**
 * Find or create the learner behind a token. Concurrent first requests race here, so a duplicate-key
 * collision is resolved by reading the winner rather than failing — the unique index on `subject` is
 * what makes that safe.
 */
export async function resolveLearner(ctx: ServiceContext, principal: Principal): Promise<Learner> {
  const { learners } = ctx.store.collections;

  const existing = await learners.findOne({ subject: principal.subject });
  if (existing) {
    // Keep the email fresh if identity-service's copy changed, but never treat it as identity.
    if (principal.email && existing.email !== principal.email) {
      await learners.updateOne({ _id: existing._id }, { $set: { email: principal.email } });
      return toLearner({ ...existing, email: principal.email });
    }
    return toLearner(existing);
  }

  const doc: LearnerDoc = {
    _id: randomUUID(),
    subject: principal.subject,
    email: principal.email,
    displayName: principal.email?.split('@')[0],
    uiLanguage: DEFAULT_LOCALE,
    createdAt: ctx.now(),
  };

  try {
    await learners.insertOne(doc);
    return toLearner(doc);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const winner = await learners.findOne({ subject: principal.subject });
      if (winner) return toLearner(winner);
    }
    throw error;
  }
}

/**
 * Learner identifiers and display names — the minimum a coach needs to address a brief or a review
 * to someone.
 *
 * Deliberately narrower than `Learner`: no email, no subject, nothing identity-service owns. The
 * projection is the privacy boundary, so it lives here rather than in whichever transport asks.
 */
export interface LearnerSummary {
  learnerId: string;
  displayName?: string;
  uiLanguage: string;
}

export async function listLearnerSummaries(ctx: ServiceContext): Promise<LearnerSummary[]> {
  const docs = await ctx.store.collections.learners
    .find({})
    .project<{ _id: string; displayName?: string; uiLanguage: string }>({ displayName: 1, uiLanguage: 1 })
    .toArray();
  return docs.map(({ _id, ...rest }) => ({ learnerId: _id, ...rest }));
}

export async function getLearner(ctx: ServiceContext, learnerId: string): Promise<Learner> {
  const doc = await ctx.store.collections.learners.findOne({ _id: learnerId });
  if (!doc) throw notFound(`learner ${learnerId}`);
  return toLearner(doc);
}

export async function updateLearner(ctx: ServiceContext, learnerId: string, input: PatchMeInput): Promise<Learner> {
  const update: Partial<LearnerDoc> = {};
  if (input.uiLanguage) update.uiLanguage = input.uiLanguage;
  if (input.displayName !== undefined) update.displayName = input.displayName;

  if (Object.keys(update).length === 0) return getLearner(ctx, learnerId);

  const result = await ctx.store.collections.learners.findOneAndUpdate(
    { _id: learnerId },
    { $set: update },
    { returnDocument: 'after' },
  );
  if (!result) throw notFound(`learner ${learnerId}`);
  return toLearner(result);
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export async function listEnrollments(ctx: ServiceContext, learnerId: string): Promise<Enrollment[]> {
  const docs = await ctx.store.collections.enrollments.find({ learnerId }).toArray();
  return docs.map(({ _id: _ignored, ...rest }) => rest);
}

export async function getEnrollment(
  ctx: ServiceContext,
  learnerId: string,
  packId: string,
): Promise<Enrollment | null> {
  const doc = await ctx.store.collections.enrollments.findOne({ _id: enrollmentIdFor(learnerId, packId) });
  if (!doc) return null;
  const { _id: _ignored, ...rest } = doc;
  return rest;
}

/**
 * Enrol a learner, or return the existing enrollment untouched. Idempotent because the learner
 * surface enrols on first visit to a pack rather than through an explicit action.
 */
export async function enroll(
  ctx: ServiceContext,
  learnerId: string,
  packId: string,
  startingBlockId?: string,
): Promise<Enrollment> {
  const existing = await getEnrollment(ctx, learnerId, packId);
  if (existing) return existing;

  const enrollment: Enrollment = {
    learnerId,
    packId,
    currentBlockId: startingBlockId,
    currentLessonOrder: 1,
    startedAt: ctx.now(),
  };
  await ctx.store.collections.enrollments.replaceOne({ _id: enrollmentIdFor(learnerId, packId) }, enrollment, {
    upsert: true,
  });
  return enrollment;
}

/** Move a learner's position. Called after a submission, and when they open a different block. */
export async function setPosition(
  ctx: ServiceContext,
  learnerId: string,
  packId: string,
  position: { blockId?: string; lessonOrder?: number },
): Promise<Enrollment> {
  const update: Record<string, unknown> = {};
  if (position.blockId) update.currentBlockId = position.blockId;
  if (position.lessonOrder !== undefined) update.currentLessonOrder = position.lessonOrder;

  await ctx.store.collections.enrollments.updateOne(
    { _id: enrollmentIdFor(learnerId, packId) },
    { $set: update },
    { upsert: false },
  );
  const enrollment = await getEnrollment(ctx, learnerId, packId);
  if (!enrollment) throw notFound(`enrollment for pack ${packId}`);
  return enrollment;
}
