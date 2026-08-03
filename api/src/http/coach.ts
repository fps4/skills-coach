/**
 * The coach API (`/coach/v1`) — the only way content and corrections enter the system (ADR-0001).
 *
 * Called today by a person driving an LLM CLI with a client-credentials token; designed so that a
 * service calling a model API can replace that caller without the contract changing.
 *
 * The service layer underneath is transport-agnostic on purpose: the planned MCP server becomes a
 * second caller of these same functions rather than a parallel implementation.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireCapability } from '../auth/plugin.js';
import {
  packManifestSchema,
  postBlockReviewSchema,
  postCorrectionSchema,
  publishBlockSchema,
} from '../domain/schemas.js';
import * as audit from '../services/audit.js';
import * as brief from '../services/brief.js';
import * as content from '../services/content.js';
import * as corrections from '../services/corrections.js';
import * as learners from '../services/learners.js';
import * as submissions from '../services/submissions.js';
import type { ServiceContext } from '../services/context.js';

const learnerQuerySchema = z.object({ learnerId: z.string().optional() });

/** Which door a write came through. Recorded so the audit trail does not fork by transport. */
const HTTP = { transport: 'http' } as const;

export function registerCoachRoutes(app: FastifyInstance, ctx: ServiceContext): void {
  // --- publishing -----------------------------------------------------------

  app.get('/coach/v1/packs', async (request) => {
    requireCapability(request, 'lesson:read');
    return { packs: await content.listPacks(ctx) };
  });

  app.post('/coach/v1/packs', async (request) => {
    const auth = requireCapability(request, 'pack:publish');
    const pack = await content.upsertPack(ctx, packManifestSchema.parse(request.body));
    await audit.record(ctx, {
      principal: auth.principal,
      action: 'pack.upsert',
      resource: `pack/${pack.packId}`,
      meta: { ...HTTP },
    });
    return { pack };
  });

  /**
   * Publish a block with its lessons and drill deck. Idempotent: publishing the same block again
   * updates it in place, and drill items whose text is unchanged keep their learner progress.
   */
  app.post('/coach/v1/packs/:packId/blocks', async (request, reply) => {
    const auth = requireCapability(request, 'pack:publish');
    const { packId } = request.params as { packId: string };
    const result = await content.publishBlock(ctx, packId, publishBlockSchema.parse(request.body));

    await audit.record(ctx, {
      principal: auth.principal,
      action: 'block.publish',
      resource: `block/${result.block.blockId}`,
      meta: {
        ...HTTP,
        lessons: result.lessonsPublished,
        drillItems: result.drillItemsPublished,
        removed: result.drillItemsRemoved,
        ignoredAlternatives: result.ignoredAlternatives,
      },
    });

    return reply.status(201).send(result);
  });

  app.post('/coach/v1/blocks/:blockId/archive', async (request) => {
    const auth = requireCapability(request, 'pack:publish');
    const { blockId } = request.params as { blockId: string };
    const block = await content.archiveBlock(ctx, blockId);
    await audit.record(ctx, {
      principal: auth.principal,
      action: 'block.archive',
      resource: `block/${blockId}`,
      meta: { ...HTTP },
    });
    return { block };
  });

  app.get('/coach/v1/blocks/:blockId', async (request) => {
    requireCapability(request, 'lesson:read');
    const { blockId } = request.params as { blockId: string };
    return { block: await content.getBlock(ctx, blockId), lessons: await content.listLessons(ctx, blockId) };
  });

  // --- the work queue -------------------------------------------------------

  /** Pending submissions, oldest first — the queue a coach works through. */
  app.get('/coach/v1/submissions', async (request) => {
    requireCapability(request, 'submission:read-all');
    const query = z
      .object({
        status: z.enum(['pending', 'corrected']).optional(),
        packId: z.string().optional(),
        blockId: z.string().optional(),
        learnerId: z.string().optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
      })
      .parse(request.query);
    return { submissions: await submissions.listSubmissions(ctx, query) };
  });

  /** One submission with its lesson, so a coach has the prompts alongside the answers. */
  app.get('/coach/v1/submissions/:submissionId', async (request) => {
    requireCapability(request, 'submission:read-all');
    const { submissionId } = request.params as { submissionId: string };
    const log = await submissions.sessionLog(ctx, submissionId);
    return { ...log, lesson: await content.getLesson(ctx, log.submission.lessonId) };
  });

  /**
   * Post a correction. The runtime derives the error-log changes from the categories supplied —
   * the caller reports occurrences, it never writes counters (ADR-0001).
   */
  app.post('/coach/v1/submissions/:submissionId/correction', async (request, reply) => {
    const auth = requireCapability(request, 'correction:write');
    const { submissionId } = request.params as { submissionId: string };
    const result = await corrections.postCorrection(ctx, submissionId, postCorrectionSchema.parse(request.body));

    await audit.record(ctx, {
      principal: auth.principal,
      action: 'correction.post',
      resource: `submission/${submissionId}`,
      meta: {
        ...HTTP,
        items: result.correction.items.length,
        categories: Object.keys(result.correction.categoryTally),
      },
    });

    return reply.status(201).send(result);
  });

  // --- review and brief -----------------------------------------------------

  /** Posting a review also closes the block on the error log, which is what retires a category. */
  app.post('/coach/v1/blocks/:blockId/review', async (request, reply) => {
    const auth = requireCapability(request, 'review:write');
    const { blockId } = request.params as { blockId: string };
    const body = z
      .object({ learnerId: z.string().min(1) })
      .and(postBlockReviewSchema)
      .parse(request.body);

    const { learnerId, ...review } = body;
    const result = await brief.postBlockReview(ctx, blockId, learnerId, review);

    await audit.record(ctx, {
      principal: auth.principal,
      action: 'block.review',
      resource: `block/${blockId}`,
      meta: { ...HTTP, learnerId, transitioned: result.transitioned },
    });

    return reply.status(201).send(result);
  });

  /**
   * The assembled brief for authoring the next block: how the learner did, the next rung on the
   * ramp, and the program goal. Aggregation, not generation.
   */
  app.get('/coach/v1/blocks/:blockId/brief', async (request) => {
    requireCapability(request, 'lesson:read');
    const { blockId } = request.params as { blockId: string };
    const { learnerId } = learnerQuerySchema.parse(request.query);
    return brief.buildBrief(ctx, blockId, await brief.resolveLearnerId(ctx, blockId, learnerId));
  });

  app.get('/coach/v1/blocks/:blockId/review', async (request) => {
    requireCapability(request, 'lesson:read');
    const { blockId } = request.params as { blockId: string };
    const { learnerId } = learnerQuerySchema.parse(request.query);
    return { review: await brief.getBlockReview(ctx, blockId, await brief.resolveLearnerId(ctx, blockId, learnerId)) };
  });

  /**
   * Learner identifiers and display names — the minimum a coach needs to address a brief or a
   * review to someone. No email, and nothing identity-service owns.
   */
  app.get('/coach/v1/learners', async (request) => {
    requireCapability(request, 'submission:read-all');
    return { learners: await learners.listLearnerSummaries(ctx) };
  });
}
