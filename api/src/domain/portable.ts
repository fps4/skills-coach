/**
 * The portable archive: what a learner's own progress looks like outside this database.
 *
 * A learner must be able to take their work with them — to a new deployment, to a backup they keep
 * themselves, or across a break where they put one pack down and come back to it. That is only
 * possible if the archive survives the one thing that certainly changes on the way: **who they are**.
 *
 * `learnerId` is a `randomUUID()` minted the first time a token's `sub` is seen, so the same person
 * on a new system is a different learner id. Several identifiers are built from it — a block written
 * for one person, a word they added, an article loaded for them all carry a hash of their id
 * (`context.ts`). Every one of those would miss on the way back in.
 *
 * So the archive **never stores an identifier that embeds an owner**. It stores what the identifier
 * is made of — the pack, the block's order, the item's content digest — and the import re-derives
 * the id under whoever is importing. Identifiers that embed no owner (a pack's own block, a pack's
 * own drill item) survive as they are, which is exactly the guarantee deterministic content ids were
 * introduced for.
 *
 * Pure, like everything else here: no database, no clock, no HTTP. What a reference *is* belongs
 * with the rules; turning one back into a document belongs to `services/archive.ts`.
 */

import { createHash } from 'node:crypto';
import type { DrillProgress } from './drill-progress.js';
import type { DrillKind, DrillPayload } from './types.js';

/** What the file says it is. An import refuses anything else rather than guessing at the shape. */
export const ARCHIVE_KIND = 'skills-coach.learner-archive';

/**
 * The archive format's version, bumped when a file written today would be misread by a reader
 * written tomorrow. Adding an optional section does not need a bump; changing what an existing
 * field means does.
 */
export const ARCHIVE_VERSION = 1;

/** Versions this build can read. A file from the future is refused, not partially applied. */
export const READABLE_VERSIONS: readonly number[] = [1];

// ---------------------------------------------------------------------------
// Content digests
// ---------------------------------------------------------------------------

/**
 * The side of a drill item a learner is asked to produce first, which is what its identity is made
 * of. For a question that is the stem, so editing an option's wording keeps the item and the
 * progress on it.
 *
 * Lives here rather than in the service that builds ids because the archive needs the same answer
 * and the two must not drift: a digest computed differently on the way out than on the way in would
 * silently detach every streak in the file.
 */
export function contentKey(payload: DrillPayload): string {
  return payload.kind === 'term' ? payload.term : payload.kind === 'mcq' ? payload.stem : payload.sentence;
}

/** Twelve hex characters of the content. Owner-independent, which is why it travels. */
export function contentDigest(payload: DrillPayload): string {
  return createHash('sha256')
    .update(`${payload.kind}|${contentKey(payload)}`)
    .digest('hex')
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * A block, named by what it is rather than by its id.
 *
 * `owned` says the block was written for one learner (ADR-0015), which is the fact that decides
 * whether its id carries an owner tag. Recording it is not optional: two different blocks — the
 * pack's block 1 and a learner's own block 1 — are both "pack, order 1", and only this tells them
 * apart.
 */
export interface BlockRef {
  pack: string;
  block: number;
  owned: boolean;
}

/** A lesson is a block plus its order. */
export interface LessonRef extends BlockRef {
  lesson: number;
}

/**
 * A drill item, named by its block and its content.
 *
 * `own` marks a word the learner added themselves (ADR-0012). Like `owned` on a block it decides
 * whether the id carries an owner tag, and like `owned` it cannot be inferred from the digest.
 */
export interface ItemRef extends BlockRef {
  kind: DrillKind;
  digest: string;
  own: boolean;
}

/** A stable string for a reference, so a list of them can be de-duplicated and looked up. */
export const blockRefKey = (ref: BlockRef): string => `${ref.pack}/${ref.owned ? 'u' : 'p'}${ref.block}`;
export const itemRefKey = (ref: ItemRef): string => `${blockRefKey(ref)}/${ref.own ? 'u' : 'p'}${ref.digest}`;

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/**
 * How far along a piece of drill progress is, as a tuple compared left to right.
 *
 * Mastery outranks a cleared stage, a cleared stage outranks the stage sitting open, and a streak
 * only breaks a tie between two items at the same stage. This is the same order the streak machine
 * moves through, read as a ladder.
 */
const rank = (progress: DrillProgress): number[] => [
  progress.mastered ? 1 : 0,
  progress.stage2Cleared ? 1 : 0,
  progress.stage1Cleared ? 1 : 0,
  progress.stage,
  progress.streak,
];

const outranks = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
};

/**
 * Fold an archived item's progress into what is already here, **never demoting**.
 *
 * The trainer already holds that mastery is a floor — a mastered item is inert and revisiting an old
 * word cannot take it back (`drill-progress.ts`). An import obeys the same rule, which is what makes
 * importing a stale backup by accident cost nothing: the further-along side wins, and a tie changes
 * nothing at all.
 *
 * The winning side is taken **whole** rather than field by field. A merge that took `mastered` from
 * one and `stage` from the other could produce a state the streak machine can never reach — mastered
 * at stage 1, say — and every reader downstream would then be looking at something that cannot
 * happen.
 *
 * The two counters are the exception, and they are maxed rather than summed: the same practice
 * counted from both sides of a backup would inflate a number a learner reads as their own history.
 * Maxing independently stays coherent, because `correct <= attempts` holds on each side and so holds
 * for the larger of each.
 */
export function mergeProgress(live: DrillProgress, incoming: DrillProgress): DrillProgress {
  const winner = outranks(rank(incoming), rank(live)) ? incoming : live;
  return {
    ...winner,
    attempts: Math.max(live.attempts, incoming.attempts),
    correct: Math.max(live.correct, incoming.correct),
  };
}

/** Where a learner had got to in a pack: a block's order, then a lesson's within it. */
export interface Position {
  blockOrder: number;
  lessonOrder: number;
}

/**
 * The further of two positions through a pack. Ties, and a pair that cannot be compared because
 * neither side knows its block's order, leave the live position alone.
 */
export function furtherPosition(live: Position, incoming: Position): Position {
  if (incoming.blockOrder !== live.blockOrder) return incoming.blockOrder > live.blockOrder ? incoming : live;
  return incoming.lessonOrder > live.lessonOrder ? incoming : live;
}
