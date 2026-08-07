/**
 * The learner API (`/api/v1`).
 *
 * Routes are thin: resolve the caller, check a capability, call a service, return. Every route is
 * scoped to the calling learner — there is no route here that takes a learner id, so one learner
 * cannot reach another's work by guessing one.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireCapability } from '../auth/plugin.js';
import { forbidden, invalid } from './errors.js';
import {
  answerQuizSchema,
  createLearnerTermSchema,
  createSubmissionSchema,
  patchMeSchema,
  postAttemptSchema,
  startQuizSchema,
} from '../domain/schemas.js';
import type { Learner } from '../domain/types.js';
import * as content from '../services/content.js';
import * as drills from '../services/drills.js';
import * as learnerTerms from '../services/learner-terms.js';
import * as learners from '../services/learners.js';
import * as progress from '../services/progress.js';
import * as quiz from '../services/quiz.js';
import * as submissions from '../services/submissions.js';
import * as audit from '../services/audit.js';
import type { ServiceContext } from '../services/context.js';

const stageSchema = z.coerce
  .number()
  .int()
  .refine((value): value is 1 | 2 => value === 1 || value === 2, 'stage must be 1 or 2');

const drillQuerySchema = z.object({
  blockId: z.string().optional(),
  packId: z.string().optional(),
  lessonOrder: z.coerce.number().int().positive().optional(),
  kind: z.enum(['term', 'word-order', 'mcq']).optional(),
  stage: stageSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export function registerLearnerRoutes(app: FastifyInstance, ctx: ServiceContext): void {
  /** Every learner route starts here, which is also what lazily creates the profile. */
  const caller = async (
    request: FastifyRequest,
    capability: Parameters<typeof requireCapability>[1],
  ): Promise<Learner> => {
    const auth = requireCapability(request, capability);
    return learners.resolveLearner(ctx, auth.principal);
  };

  // --- identity and position ------------------------------------------------

  app.get('/api/v1/me', async (request) => {
    const learner = await caller(request, 'progress:read');
    return { learner, enrollments: await learners.listEnrollments(ctx, learner.learnerId) };
  });

  app.patch('/api/v1/me', async (request) => {
    const learner = await caller(request, 'progress:read');
    const updated = await learners.updateLearner(ctx, learner.learnerId, patchMeSchema.parse(request.body));
    return { learner: updated };
  });

  // --- content --------------------------------------------------------------

  app.get('/api/v1/packs', async (request) => {
    await caller(request, 'lesson:read');
    return { packs: await content.listPacks(ctx) };
  });

  app.get('/api/v1/packs/:packId', async (request) => {
    const learner = await caller(request, 'lesson:read');
    const { packId } = request.params as { packId: string };
    const pack = await content.getPack(ctx, packId);
    const blocks = await content.listBlocks(ctx, packId);

    // Opening a pack is what enrols a learner in it — there is nothing to sign up for.
    await learners.enroll(ctx, learner.learnerId, packId, blocks[0]?.blockId);
    return { pack, blocks };
  });

  app.get('/api/v1/packs/:packId/blocks', async (request) => {
    await caller(request, 'lesson:read');
    const { packId } = request.params as { packId: string };
    return { blocks: await content.listBlocks(ctx, packId) };
  });

  app.get('/api/v1/blocks/:blockId', async (request) => {
    const learner = await caller(request, 'lesson:read');
    const { blockId } = request.params as { blockId: string };
    const lessons = await content.listLessons(ctx, blockId);
    const state = await progress.progressForBlock(ctx, learner.learnerId, blockId);
    return {
      ...state,
      // The index only — a lesson's sections come from the lesson route.
      lessons: lessons.map(({ sections: _sections, ...rest }) => rest),
    };
  });

  app.get('/api/v1/lessons/:lessonId', async (request) => {
    const learner = await caller(request, 'lesson:read');
    const { lessonId } = request.params as { lessonId: string };
    const lesson = await content.getLesson(ctx, lessonId);
    const mine = await submissions.listSubmissions(ctx, { learnerId: learner.learnerId, lessonId });
    return { lesson, submissions: mine };
  });

  // --- submissions ----------------------------------------------------------

  app.post('/api/v1/lessons/:lessonId/submissions', async (request, reply) => {
    const learner = await caller(request, 'submission:write');
    const { lessonId } = request.params as { lessonId: string };
    const result = await submissions.createSubmission(
      ctx,
      learner.learnerId,
      lessonId,
      createSubmissionSchema.parse(request.body),
    );

    const auth = requireCapability(request, 'submission:write');
    await audit.record(ctx, {
      principal: auth.principal,
      action: 'submission.create',
      resource: `submission/${result.submission.submissionId}`,
      meta: { lessonId },
    });

    return reply.status(201).send(result);
  });

  app.get('/api/v1/submissions', async (request) => {
    const learner = await caller(request, 'submission:write');
    const query = z
      .object({
        lessonId: z.string().optional(),
        blockId: z.string().optional(),
        status: z.enum(['pending', 'corrected']).optional(),
      })
      .parse(request.query);
    return { submissions: await submissions.listSubmissions(ctx, { ...query, learnerId: learner.learnerId }) };
  });

  /** The session log: what the learner wrote, and what came back. */
  app.get('/api/v1/submissions/:submissionId', async (request) => {
    const learner = await caller(request, 'submission:write');
    const { submissionId } = request.params as { submissionId: string };
    const log = await submissions.sessionLog(ctx, submissionId);
    if (log.submission.learnerId !== learner.learnerId) {
      // Deliberately a 403 rather than a 404: the caller is authenticated and the resource exists.
      throw forbidden('this submission belongs to another learner');
    }
    return log;
  });

  // --- drills ---------------------------------------------------------------

  app.get('/api/v1/drills', async (request) => {
    const learner = await caller(request, 'drill:practice');
    const query = drillQuerySchema.parse(request.query);
    if (!query.blockId && !query.packId) throw invalid('a drill query needs blockId or packId');
    return drills.nextItems(ctx, { ...query, learnerId: learner.learnerId });
  });

  app.post('/api/v1/drills/:drillItemId/attempts', async (request) => {
    const learner = await caller(request, 'drill:practice');
    const { drillItemId } = request.params as { drillItemId: string };
    return drills.recordAttempt(ctx, learner.learnerId, drillItemId, postAttemptSchema.parse(request.body));
  });

  // --- quiz sittings --------------------------------------------------------
  //
  // A sitting is a way of grouping drill practice, so it sits behind `drill:practice` and every
  // route resolves the session through the calling learner — one learner cannot read another's
  // sitting by guessing an id.

  app.post('/api/v1/quiz/sessions', async (request, reply) => {
    const learner = await caller(request, 'drill:practice');
    const result = await quiz.startSession(ctx, learner.learnerId, startQuizSchema.parse(request.body));
    return reply.status(201).send(result);
  });

  app.get('/api/v1/quiz/sessions', async (request) => {
    const learner = await caller(request, 'drill:practice');
    const scope = z
      .object({
        packId: z.string().optional(),
        blockId: z.string().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
      })
      .parse(request.query);
    return { sessions: await quiz.listSessions(ctx, learner.learnerId, scope) };
  });

  app.get('/api/v1/quiz/sessions/:sessionId', async (request) => {
    const learner = await caller(request, 'drill:practice');
    const { sessionId } = request.params as { sessionId: string };
    return quiz.results(ctx, await quiz.getSession(ctx, learner.learnerId, sessionId));
  });

  app.post('/api/v1/quiz/sessions/:sessionId/answers', async (request) => {
    const learner = await caller(request, 'drill:practice');
    const { sessionId } = request.params as { sessionId: string };
    return quiz.answer(ctx, learner.learnerId, sessionId, answerQuizSchema.parse(request.body));
  });

  app.post('/api/v1/quiz/sessions/:sessionId/finish', async (request) => {
    const learner = await caller(request, 'drill:practice');
    const { sessionId } = request.params as { sessionId: string };
    return quiz.finish(ctx, learner.learnerId, sessionId);
  });

  // --- the learner's own words ----------------------------------------------

  app.post('/api/v1/blocks/:blockId/terms', async (request, reply) => {
    const learner = await caller(request, 'drill:curate');
    const { blockId } = request.params as { blockId: string };
    const item = await learnerTerms.addTerm(
      ctx,
      learner.learnerId,
      blockId,
      createLearnerTermSchema.parse(request.body),
    );
    return reply.status(201).send({ term: item });
  });

  app.get('/api/v1/blocks/:blockId/terms', async (request) => {
    const learner = await caller(request, 'drill:curate');
    const { blockId } = request.params as { blockId: string };
    return { terms: await learnerTerms.listTerms(ctx, learner.learnerId, blockId) };
  });

  app.delete('/api/v1/terms/:drillItemId', async (request, reply) => {
    const learner = await caller(request, 'drill:curate');
    const { drillItemId } = request.params as { drillItemId: string };
    await learnerTerms.removeTerm(ctx, learner.learnerId, drillItemId);
    return reply.status(204).send();
  });

  app.post('/api/v1/drills/reset', async (request) => {
    const learner = await caller(request, 'drill:practice');
    const scope = z.object({ blockId: z.string().optional(), packId: z.string().optional() }).parse(request.body ?? {});
    if (!scope.blockId && !scope.packId)
      throw invalid('a reset needs blockId or packId — refusing to clear everything');
    return { reset: await drills.resetProgress(ctx, learner.learnerId, scope) };
  });

  // --- progress -------------------------------------------------------------

  app.get('/api/v1/progress', async (request) => {
    const learner = await caller(request, 'progress:read');
    const { packId } = z.object({ packId: z.string().optional() }).parse(request.query);
    if (packId) return progress.packProgress(ctx, learner.learnerId, packId);
    return progress.overview(ctx, learner.learnerId);
  });
}
