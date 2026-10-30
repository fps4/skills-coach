/**
 * Moving a deck's cards from free section labels onto the topic ids its skill now declares (ADR-0032).
 *
 * A one-off, for decks published before their skill declared topics: the cards say
 * "3 · Data Vault mechanics", the manifest now says `{ id: data-vault, title: Data Vault mechanics }`,
 * and the filter, the tiles and a bookmark all want the id. Reachable only through
 * `retopic:cards` (an operator task on the deployment), never through an API — it is a migration of how
 * the field is written, not authoring.
 *
 * It changes `payload.group` and nothing else. A card's id is keyed on its front, never its group, so
 * every streak and attempt stays attached to the card it was earned on. A label that matches no
 * declared topic is reported and left alone — moving it would be a guess.
 */

import { declaredTopicFor } from '../domain/topics.js';
import type { ServiceContext } from './context.js';
import { getPack } from './content.js';

export interface RetopicReport {
  /** Each label moved, the id it moved to, and how many cards carried it. */
  moved: { from: string; to: string; cards: number }[];
  /** Labels no declared topic matches: left as they are. */
  unmatched: { label: string; cards: number }[];
}

export async function retopicCards(
  ctx: ServiceContext,
  packId: string,
  options: { dryRun: boolean },
): Promise<RetopicReport> {
  const pack = await getPack(ctx, packId);
  const declared = pack.flashcards?.topics ?? [];
  if (declared.length === 0) throw new Error(`${packId} declares no topics — there is nothing to move cards onto`);

  const labels = await ctx.store.collections.drillItems
    .aggregate<{ _id: string; cards: number }>([
      { $match: { packId, 'payload.kind': 'term', 'payload.group': { $exists: true } } },
      { $group: { _id: '$payload.group', cards: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  const report: RetopicReport = { moved: [], unmatched: [] };
  for (const { _id: label, cards } of labels) {
    const id = declaredTopicFor(label, declared);
    if (id === null) report.unmatched.push({ label, cards });
    else if (id !== label) report.moved.push({ from: label, to: id, cards });
  }

  if (!options.dryRun) {
    for (const { from, to } of report.moved) {
      await ctx.store.collections.drillItems.updateMany(
        { packId, 'payload.kind': 'term', 'payload.group': from },
        { $set: { 'payload.group': to } },
      );
    }
  }
  return report;
}
