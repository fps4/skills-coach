/**
 * The learner's own words (ADR-0012).
 *
 * A pack is the curriculum, but not everything worth learning arrives with one — a word off a form,
 * out of a meeting, or from a book belongs in the same trainer as the rest. These are stored as
 * ordinary `term` drill items carrying a `learnerId`, so the whole practice path downstream —
 * prompting, tolerant matching, the streak machine, the deck meters — is the same code. The only
 * thing that differs is who can see them and what a republish is allowed to do to them.
 *
 * They attach to the **block being practised**, because that is the deck the learner is adding to
 * and the surface they will come back to. Nothing here is pack-wide.
 */

import { notFound } from '../http/errors.js';
import { createLearnerTermSchema, type CreateLearnerTermInput } from '../domain/schemas.js';
import type { DrillItem } from '../domain/types.js';
import { getBlock } from './content.js';
import { drillIdFor, drillStateIdFor, type ServiceContext } from './context.js';

/**
 * Add a word, or return the one already there.
 *
 * Idempotent by content, exactly as publishing is: adding the same word twice is the learner
 * repeating themselves, not asking for a duplicate that would come round twice in the rotation. An
 * edited translation for a term they already have overwrites it — and keeps the streak, because the
 * id is derived from the term alone.
 */
export async function addTerm(
  ctx: ServiceContext,
  learnerId: string,
  blockId: string,
  input: CreateLearnerTermInput,
): Promise<DrillItem> {
  const parsed = createLearnerTermSchema.parse(input);
  // Resolves the pack, and refuses a block that does not exist rather than orphaning the item.
  const block = await getBlock(ctx, blockId);

  const payload = {
    kind: 'term' as const,
    term: parsed.term,
    translation: parsed.translation,
    ...(parsed.example ? { example: parsed.example } : {}),
  };

  const drillItemId = drillIdFor(blockId, payload, learnerId);
  const doc = { packId: block.packId, blockId, payload, learnerId };

  await ctx.store.collections.drillItems.replaceOne({ _id: drillItemId }, doc, { upsert: true });
  return { ...doc, drillItemId };
}

/** Everything this learner added to this block, oldest id first — stable, so the list does not jump. */
export async function listTerms(ctx: ServiceContext, learnerId: string, blockId: string): Promise<DrillItem[]> {
  const docs = await ctx.store.collections.drillItems
    .find({ blockId, learnerId, 'payload.kind': 'term' })
    .sort({ _id: 1 })
    .toArray();
  return docs.map(({ _id, ...rest }) => ({ ...rest, drillItemId: _id }));
}

/**
 * Remove a word, and the progress attached to it.
 *
 * Scoped to the caller's own items by the filter itself, so there is no path here to another
 * learner's word — or to a pack's. A word that is not theirs is simply not found.
 */
export async function removeTerm(ctx: ServiceContext, learnerId: string, drillItemId: string): Promise<void> {
  const removed = await ctx.store.collections.drillItems.deleteOne({ _id: drillItemId, learnerId });
  if (removed.deletedCount === 0) throw notFound(`word ${drillItemId}`);
  await ctx.store.collections.drillState.deleteOne({ _id: drillStateIdFor(learnerId, drillItemId) });
}
