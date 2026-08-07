/**
 * What every service needs, and how identifiers are made.
 *
 * Content identifiers are **deterministic**, derived from position and content rather than randomly
 * generated. That is what makes republishing a block safe: a lesson keeps its id, and a drill item
 * whose text has not changed keeps its id — so a learner's streak on that item survives an edit
 * elsewhere in the block. Random ids would silently reset progress on every republish.
 *
 * Events (submissions, corrections) do get random ids: each one is a new thing that happened.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { Store } from '../db/client.js';
import type { DrillPayload } from '../domain/types.js';

export interface ServiceContext {
  store: Store;
  config: Config;
  /** Injected so tests can pin time and so nothing in a service reads the clock directly. */
  now(): Date;
}

export function createContext(store: Store, config: Config, now: () => Date = () => new Date()): ServiceContext {
  return { store, config, now };
}

/** Eight hex characters of the owner, so an id can be scoped to a person without naming one. */
const ownerTag = (learnerId: string): string => createHash('sha256').update(learnerId).digest('hex').slice(0, 8);

/**
 * A block belongs to a pack and, once blocks are written per person (ADR-0015), to a learner. Two
 * learners each having a block 1 in the same pack must not collide on one document, so the owner is
 * namespaced into the id — the same device `drillIdFor` already uses, and hashed for the same
 * reason: the id travels in URLs and does not need to name anybody.
 *
 * Blocks published before ownership existed keep the unnamespaced form. Nothing rewrites them:
 * lesson, drill-item, submission and review identifiers all derive from a block id, so changing one
 * would orphan the learner progress hanging off it. `publishBlock` reuses whatever `_id` a block
 * already has rather than recomputing it.
 */
export const blockIdFor = (packId: string, order: number, learnerId?: string): string =>
  learnerId ? `${packId}.u${ownerTag(learnerId)}.b${order}` : `${packId}.b${order}`;

export const lessonIdFor = (blockId: string, order: number): string => `${blockId}.l${order}`;

/**
 * A drill item's identity is its content, so re-importing a pack does not orphan learner progress.
 * The key is the side a learner is asked to produce first — the term, or the sentence.
 *
 * A learner's own word (ADR-0012) is namespaced by who added it: two people adding the same word to
 * the same block must not collide on one document, and the *same* person adding it twice must land
 * on the one they already have rather than a duplicate. The owner is hashed rather than embedded —
 * the id travels in URLs, and it does not need to name anybody.
 */
export function drillIdFor(blockId: string, payload: DrillPayload, learnerId?: string): string {
  // The side a learner is asked to produce first. For a question that is the stem — editing an
  // option's wording keeps the item, and with it the learner's progress on it, which is what an
  // author fixing a typo in a distractor should get.
  const key = payload.kind === 'term' ? payload.term : payload.kind === 'mcq' ? payload.stem : payload.sentence;
  const digest = createHash('sha256').update(`${payload.kind}|${key}`).digest('hex').slice(0, 12);
  if (!learnerId) return `${blockId}.d.${digest}`;
  return `${blockId}.u${ownerTag(learnerId)}.${digest}`;
}

export const enrollmentIdFor = (learnerId: string, packId: string): string => `${learnerId}:${packId}`;
export const drillStateIdFor = (learnerId: string, drillItemId: string): string => `${learnerId}:${drillItemId}`;
export const errorLogIdFor = (learnerId: string, packId: string, category: string): string =>
  `${learnerId}:${packId}:${category}`;
export const blockReviewIdFor = (blockId: string, learnerId: string): string => `${blockId}:${learnerId}`;

export const newEventId = (): string => randomUUID();
