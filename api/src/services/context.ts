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

export const blockIdFor = (packId: string, order: number): string => `${packId}.b${order}`;
export const lessonIdFor = (blockId: string, order: number): string => `${blockId}.l${order}`;

/**
 * A drill item's identity is its content, so re-importing a pack does not orphan learner progress.
 * The key is the side a learner is asked to produce first — the term, or the sentence.
 */
export function drillIdFor(blockId: string, payload: DrillPayload): string {
  const key = payload.kind === 'term' ? payload.term : payload.sentence;
  const digest = createHash('sha256').update(`${payload.kind}|${key}`).digest('hex').slice(0, 12);
  return `${blockId}.d.${digest}`;
}

export const enrollmentIdFor = (learnerId: string, packId: string): string => `${learnerId}:${packId}`;
export const drillStateIdFor = (learnerId: string, drillItemId: string): string => `${learnerId}:${drillItemId}`;
export const errorLogIdFor = (learnerId: string, packId: string, category: string): string =>
  `${learnerId}:${packId}:${category}`;
export const blockReviewIdFor = (blockId: string, learnerId: string): string => `${blockId}:${learnerId}`;

export const newEventId = (): string => randomUUID();
