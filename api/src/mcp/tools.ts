/**
 * The coach surface as MCP tools.
 *
 * One entry per `/coach/v1` route, calling the **same service function** behind the same capability
 * (ADR-0010). This table is a second door onto the runtime, never a second implementation: if a rule
 * lives here and not in a service, the two transports have already diverged.
 *
 * There are deliberately **no learner tools**. A coach token carries neither `drill:practice` nor
 * `submission:write`, and the MCP must not become the way around that.
 *
 * Input schemas are the ones the HTTP routes validate with, reused verbatim and converted to JSON
 * Schema for the tool listing — so what a model is told to send and what the runtime accepts cannot
 * drift apart.
 */

import { z } from 'zod';

import type { RequestAuth } from '../auth/plugin.js';
import type { Capability } from '../auth/capabilities.js';
import {
  packManifestSchema,
  postBlockReviewSchema,
  postCorrectionSchema,
  publishBlockSchema,
} from '../domain/schemas.js';
import * as brief from '../services/brief.js';
import * as content from '../services/content.js';
import * as corrections from '../services/corrections.js';
import * as learners from '../services/learners.js';
import * as submissions from '../services/submissions.js';
import type { ServiceContext } from '../services/context.js';

export interface AuditEntry {
  action: string;
  resource: string;
  meta?: Record<string, unknown>;
}

export interface ToolDef<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  capability: Capability;
  input: Schema;
  /** Advertised to clients as a hint; the capability is what actually decides. */
  readOnly: boolean;
  run: (
    ctx: ServiceContext,
    args: z.infer<Schema>,
    auth: RequestAuth,
  ) => Promise<{ result: unknown; audit?: AuditEntry }>;
}

const empty = z.object({});
const blockRef = z.object({ blockId: z.string().min(1) });
/** A brief or review is *about* a learner; omitting the id is allowed when only one has evidence. */
const learnerScope = z.object({ blockId: z.string().min(1), learnerId: z.string().min(1).optional() });

function tool<Schema extends z.ZodTypeAny>(definition: ToolDef<Schema>): ToolDef {
  return definition as unknown as ToolDef;
}

export const TOOLS: ToolDef[] = [
  // --- reading --------------------------------------------------------------

  tool({
    name: 'list_packs',
    description: 'Every published pack with its manifest: framework, ramp dials and error categories.',
    capability: 'lesson:read',
    input: empty,
    readOnly: true,
    run: async (ctx) => ({ result: { packs: await content.listPacks(ctx) } }),
  }),

  tool({
    name: 'get_block',
    description:
      'One block with its lessons and its drill deck, as published. The deck is included because authoring the ' +
      'next block without seeing the questions already written is how a bank fills up with duplicates.',
    capability: 'lesson:read',
    input: blockRef,
    readOnly: true,
    // No `learnerId` on the drill query, so this returns pack content only — a learner's own words
    // are never on the coach surface (ADR-0012).
    run: async (ctx, { blockId }) => ({
      result: {
        block: await content.getBlock(ctx, blockId),
        lessons: await content.listLessons(ctx, blockId),
        drillItems: await content.listDrillItems(ctx, { blockId }),
      },
    }),
  }),

  tool({
    name: 'get_brief',
    description:
      'The brief for authoring the next block: the learner’s error log and lesson record, the next rung on ' +
      'the ramp with its dials, the program goal, and what the last review asked for. Aggregation, not generation.',
    // About a person, not about content — so the capability that means "may see work that is not
    // yours", never the one every learner holds.
    capability: 'submission:read-all',
    input: learnerScope,
    readOnly: true,
    run: async (ctx, { blockId, learnerId }) => ({
      result: await brief.buildBrief(ctx, blockId, await brief.resolveLearnerId(ctx, blockId, learnerId)),
    }),
  }),

  tool({
    name: 'get_block_review',
    description: 'The review posted when a block was closed.',
    capability: 'submission:read-all',
    input: learnerScope,
    readOnly: true,
    run: async (ctx, { blockId, learnerId }) => ({
      result: {
        review: await brief.getBlockReview(ctx, blockId, await brief.resolveLearnerId(ctx, blockId, learnerId)),
      },
    }),
  }),

  tool({
    name: 'list_learners',
    description: 'Learner ids and display names — the minimum needed to address a brief or a review to someone.',
    capability: 'submission:read-all',
    input: empty,
    readOnly: true,
    run: async (ctx) => ({ result: { learners: await learners.listLearnerSummaries(ctx) } }),
  }),

  tool({
    name: 'list_submissions',
    description: 'The work queue. Oldest first, so nothing starves.',
    capability: 'submission:read-all',
    input: z.object({
      status: z.enum(['pending', 'corrected']).optional(),
      packId: z.string().optional(),
      blockId: z.string().optional(),
      learnerId: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
    }),
    readOnly: true,
    run: async (ctx, query) => ({ result: { submissions: await submissions.listSubmissions(ctx, query) } }),
  }),

  tool({
    name: 'get_submission',
    description: 'One submission with the lesson it answers, so the prompts sit alongside the answers.',
    capability: 'submission:read-all',
    input: z.object({ submissionId: z.string().min(1) }),
    readOnly: true,
    run: async (ctx, { submissionId }) => {
      const log = await submissions.sessionLog(ctx, submissionId);
      return { result: { ...log, lesson: await content.getLesson(ctx, log.submission.lessonId) } };
    },
  }),

  // --- writing --------------------------------------------------------------

  tool({
    name: 'upsert_pack',
    description:
      'Publish or update a pack manifest. Error category ids are the join key for the whole adaptation loop — ' +
      'adding one is safe, renaming one orphans every entry filed under the old id.',
    capability: 'pack:publish',
    input: z.object({ manifest: packManifestSchema }),
    readOnly: false,
    run: async (ctx, { manifest }) => {
      const pack = await content.upsertPack(ctx, manifest);
      return { result: { pack }, audit: { action: 'pack.upsert', resource: `pack/${pack.packId}` } };
    },
  }),

  tool({
    name: 'publish_block',
    description:
      'Publish a block with its lessons and drill deck. Idempotent: republishing updates in place, and a drill ' +
      'item whose text is unchanged keeps the learner progress attached to it.',
    capability: 'pack:publish',
    input: z.object({ packId: z.string().min(1), block: publishBlockSchema }),
    readOnly: false,
    run: async (ctx, { packId, block }) => {
      const result = await content.publishBlock(ctx, packId, block);
      return {
        result,
        audit: {
          action: 'block.publish',
          resource: `block/${result.block.blockId}`,
          meta: {
            lessons: result.lessonsPublished,
            drillItems: result.drillItemsPublished,
            removed: result.drillItemsRemoved,
            ignoredAlternatives: result.ignoredAlternatives,
          },
        },
      };
    },
  }),

  tool({
    name: 'archive_block',
    description: 'Take a block out of circulation without deleting what learners did in it.',
    capability: 'pack:publish',
    input: blockRef,
    readOnly: false,
    run: async (ctx, { blockId }) => ({
      result: { block: await content.archiveBlock(ctx, blockId) },
      audit: { action: 'block.archive', resource: `block/${blockId}` },
    }),
  }),

  tool({
    name: 'post_correction',
    description:
      'Correct a submission. Supply judgement, not counters: name the categories each mistake belongs to and the ' +
      'runtime moves the counts and applies the status transitions. One item per mistake, not per sentence.',
    capability: 'correction:write',
    input: z.object({ submissionId: z.string().min(1), correction: postCorrectionSchema }),
    readOnly: false,
    run: async (ctx, { submissionId, correction }) => {
      const result = await corrections.postCorrection(ctx, submissionId, correction);
      return {
        result,
        audit: {
          action: 'correction.post',
          resource: `submission/${submissionId}`,
          meta: { items: result.correction.items.length, categories: Object.keys(result.correction.categoryTally) },
        },
      };
    },
  }),

  tool({
    name: 'post_block_review',
    description:
      'Close a block. This is what makes a mistake retire: every category that did not appear earns a clean block, ' +
      'and two clean blocks means mastered. Skipping it means nothing ever retires.',
    capability: 'review:write',
    input: z.object({ blockId: z.string().min(1), learnerId: z.string().min(1), review: postBlockReviewSchema }),
    readOnly: false,
    run: async (ctx, { blockId, learnerId, review }) => {
      const result = await brief.postBlockReview(ctx, blockId, learnerId, review);
      return {
        result,
        audit: {
          action: 'block.review',
          resource: `block/${blockId}`,
          meta: { learnerId, transitioned: result.transitioned },
        },
      };
    },
  }),
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((entry) => [entry.name, entry]));
