/**
 * Content: publishing packs and blocks, and reading them back.
 *
 * Publishing is **idempotent by construction** — deterministic ids (see `context.ts`) mean
 * republishing a block updates it in place rather than creating a second copy, and a drill item
 * whose text is unchanged keeps the learner progress attached to it.
 *
 * MongoDB without a replica set has no multi-document transaction (ADR-0003), so publish is written
 * to be *re-runnable* instead: it upserts everything, then removes what the new version no longer
 * contains. A publish interrupted halfway is fixed by publishing again.
 */

import { conflict, notFound } from '../http/errors.js';
import { packManifestSchema, publishBlockSchema } from '../domain/schemas.js';
import type { PackManifestInput, PublishBlockInput } from '../domain/schemas.js';
import type { Block, DrillItem, Lesson, PackManifest } from '../domain/types.js';
import { withoutId, type BlockDoc, type DrillItemDoc, type LessonDoc, type PackDoc } from '../db/collections.js';
import { usableAlternative } from '../domain/word-order.js';
import { blockIdFor, drillIdFor, lessonIdFor, type ServiceContext } from './context.js';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const toPack = (doc: PackDoc): PackManifest => {
  const { _id, createdAt: _c, updatedAt: _u, ...rest } = doc;
  return { ...rest, packId: _id };
};
const toBlock = (doc: BlockDoc): Block => {
  const { _id, ...rest } = doc;
  return { ...rest, blockId: _id };
};
const toLesson = (doc: LessonDoc): Lesson => {
  const { _id, ...rest } = doc;
  return { ...rest, lessonId: _id };
};
const toDrillItem = (doc: DrillItemDoc): DrillItem => {
  const { _id, ...rest } = doc;
  return { ...rest, drillItemId: _id };
};

export async function listPacks(ctx: ServiceContext): Promise<PackManifest[]> {
  const docs = await ctx.store.collections.packs.find({}).sort({ _id: 1 }).toArray();
  return docs.map(toPack);
}

export async function getPack(ctx: ServiceContext, packId: string): Promise<PackManifest> {
  const doc = await ctx.store.collections.packs.findOne({ _id: packId });
  if (!doc) throw notFound(`pack ${packId}`);
  return toPack(doc);
}

export async function listBlocks(ctx: ServiceContext, packId: string, includeDrafts = false): Promise<Block[]> {
  const filter = includeDrafts ? { packId } : { packId, status: 'published' as const };
  const docs = await ctx.store.collections.blocks.find(filter).sort({ order: 1 }).toArray();
  return docs.map(toBlock);
}

export async function getBlock(ctx: ServiceContext, blockId: string): Promise<Block> {
  const doc = await ctx.store.collections.blocks.findOne({ _id: blockId });
  if (!doc) throw notFound(`block ${blockId}`);
  return toBlock(doc);
}

export async function listLessons(ctx: ServiceContext, blockId: string): Promise<Lesson[]> {
  const docs = await ctx.store.collections.lessons.find({ blockId }).sort({ order: 1 }).toArray();
  return docs.map(toLesson);
}

export async function getLesson(ctx: ServiceContext, lessonId: string): Promise<Lesson> {
  const doc = await ctx.store.collections.lessons.findOne({ _id: lessonId });
  if (!doc) throw notFound(`lesson ${lessonId}`);
  return toLesson(doc);
}

export interface DrillQuery {
  blockId?: string;
  packId?: string;
  lessonOrder?: number;
  kind?: 'term' | 'word-order';
  /**
   * Whose deck this is. The pack's own items are always included; this adds the words *this* learner
   * added themselves. Omitting it yields pack content only — which is what every coach-side caller
   * wants, and means a learner's own words cannot leak into one by forgetting a filter (ADR-0012).
   */
  learnerId?: string;
}

export async function listDrillItems(ctx: ServiceContext, query: DrillQuery): Promise<DrillItem[]> {
  const filter: Record<string, unknown> = {};
  if (query.blockId) filter.blockId = query.blockId;
  if (query.packId) filter.packId = query.packId;
  if (query.lessonOrder !== undefined) filter.lessonOrder = query.lessonOrder;
  if (query.kind) filter['payload.kind'] = query.kind;
  filter.$or = query.learnerId
    ? [{ learnerId: { $exists: false } }, { learnerId: query.learnerId }]
    : [{ learnerId: { $exists: false } }];

  const docs = await ctx.store.collections.drillItems.find(filter).sort({ lessonOrder: 1, _id: 1 }).toArray();
  return docs.map(toDrillItem);
}

export async function getDrillItem(ctx: ServiceContext, drillItemId: string): Promise<DrillItem> {
  const doc = await ctx.store.collections.drillItems.findOne({ _id: drillItemId });
  if (!doc) throw notFound(`drill item ${drillItemId}`);
  return toDrillItem(doc);
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export async function upsertPack(ctx: ServiceContext, input: PackManifestInput): Promise<PackManifest> {
  const manifest = packManifestSchema.parse(input);
  const now = ctx.now();
  const existing = await ctx.store.collections.packs.findOne({ _id: manifest.packId });

  const { packId, ...rest } = manifest;
  const doc: PackDoc = {
    ...rest,
    packId,
    _id: packId,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await ctx.store.collections.packs.replaceOne({ _id: packId }, withoutId(doc), { upsert: true });
  return toPack(doc);
}

export interface PublishResult {
  block: Block;
  lessonsPublished: number;
  drillItemsPublished: number;
  /** Drill items the new version dropped. Their learner progress is removed with them. */
  drillItemsRemoved: number;
  lessonsRemoved: number;
  /** Alternative word orders ignored because they were not permutations of the same chunks. */
  ignoredAlternatives: number;
}

/**
 * Publish a block with its lessons and drill deck.
 *
 * Categories referenced by a block's `focus` are checked against the pack's declared vocabulary:
 * error categories are the join key for the whole adaptation loop, so a typo there would quietly
 * break re-drilling rather than fail loudly.
 */
export async function publishBlock(
  ctx: ServiceContext,
  packId: string,
  input: PublishBlockInput,
): Promise<PublishResult> {
  const parsed = publishBlockSchema.parse(input);
  const pack = await getPack(ctx, packId);
  const now = ctx.now();

  const known = new Set(pack.errorCategories.map((category) => category.id));
  const unknownFocus = (parsed.focus ?? []).filter(
    (entry) => entry.startsWith('category:') && !known.has(entry.slice(9)),
  );
  if (unknownFocus.length > 0) {
    throw conflict(`block focus references categories the pack does not declare: ${unknownFocus.join(', ')}`);
  }

  const blockId = blockIdFor(packId, parsed.order);
  const existing = await ctx.store.collections.blocks.findOne({ _id: blockId });

  // A slug change on an existing block would break inbound links for no benefit.
  if (existing && existing.slug !== parsed.slug) {
    throw conflict(
      `block ${parsed.order} already exists as "${existing.slug}"; publish it under that slug or archive it first`,
    );
  }

  const blockDoc: BlockDoc = {
    _id: blockId,
    packId,
    order: parsed.order,
    slug: parsed.slug,
    title: parsed.title,
    level: parsed.level,
    theme: parsed.theme,
    focus: parsed.focus,
    milestone: parsed.milestone,
    status: parsed.status,
    version: (existing?.version ?? 0) + 1,
    lessonCount: parsed.lessons.length,
    publishedAt: parsed.status === 'published' ? now : existing?.publishedAt,
  };
  await ctx.store.collections.blocks.replaceOne({ _id: blockId }, withoutId(blockDoc), { upsert: true });

  // Lessons — upsert by deterministic id, then drop any the new version no longer defines.
  const lessonIds: string[] = [];
  for (const lesson of parsed.lessons) {
    const lessonId = lessonIdFor(blockId, lesson.order);
    lessonIds.push(lessonId);
    await ctx.store.collections.lessons.replaceOne({ _id: lessonId }, { ...lesson, blockId, packId }, { upsert: true });
  }
  const lessonsRemoved = await ctx.store.collections.lessons.deleteMany({ blockId, _id: { $nin: lessonIds } });

  // Drill items — same shape. Vocabulary sections also contribute term items, so a pack author
  // never has to write a word twice.
  const drillIds: string[] = [];
  let ignoredAlternatives = 0;

  for (const item of collectDrillItems(parsed)) {
    const drillItemId = drillIdFor(blockId, item.payload);
    if (drillIds.includes(drillItemId)) continue; // the same term listed twice in one block
    drillIds.push(drillItemId);
    // A malformed alternative order degrades the item to single-order rather than failing the
    // publish — but it is counted and reported, so an authoring typo is visible.
    if (item.payload.kind === 'word-order' && item.payload.partsAlt && !usableAlternative(item.payload)) {
      ignoredAlternatives += 1;
    }
    await ctx.store.collections.drillItems.replaceOne(
      { _id: drillItemId },
      { packId, blockId, lessonOrder: item.lessonOrder, payload: item.payload },
      { upsert: true },
    );
  }

  // `learnerId` guards the sweep: a republish removes what the *pack* no longer defines, and a
  // learner's own words were never in the payload to begin with. Without it, every publish would
  // quietly delete them and the progress attached to them (ADR-0012).
  const staleDrills = await ctx.store.collections.drillItems
    .find({ blockId, learnerId: { $exists: false }, _id: { $nin: drillIds } })
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  if (staleDrills.length > 0) {
    const staleIds = staleDrills.map((doc) => doc._id);
    await ctx.store.collections.drillItems.deleteMany({ _id: { $in: staleIds } });
    // Progress on an item that no longer exists is meaningless; leaving it would inflate counts.
    await ctx.store.collections.drillState.deleteMany({ drillItemId: { $in: staleIds } });
  }

  return {
    block: toBlock(blockDoc),
    lessonsPublished: lessonIds.length,
    drillItemsPublished: drillIds.length,
    drillItemsRemoved: staleDrills.length,
    lessonsRemoved: lessonsRemoved.deletedCount ?? 0,
    ignoredAlternatives,
  };
}

/** Explicit drill items, plus a term item for every vocabulary entry a lesson introduces. */
function collectDrillItems(parsed: PublishBlockInput): { lessonOrder?: number; payload: DrillItem['payload'] }[] {
  const items: { lessonOrder?: number; payload: DrillItem['payload'] }[] = [];

  for (const lesson of parsed.lessons) {
    for (const section of lesson.sections) {
      if (section.kind !== 'vocabulary') continue;
      for (const entry of section.items) {
        items.push({
          lessonOrder: lesson.order,
          payload: { kind: 'term', term: entry.term, translation: entry.translation, example: entry.example },
        });
      }
    }
  }

  for (const item of parsed.drillItems) {
    items.push({ lessonOrder: item.lessonOrder, payload: item.payload });
  }

  return items;
}

export async function archiveBlock(ctx: ServiceContext, blockId: string): Promise<Block> {
  const result = await ctx.store.collections.blocks.findOneAndUpdate(
    { _id: blockId },
    { $set: { status: 'archived' as const } },
    { returnDocument: 'after' },
  );
  if (!result) throw notFound(`block ${blockId}`);
  return toBlock(result);
}
