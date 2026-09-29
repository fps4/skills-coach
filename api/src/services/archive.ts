/**
 * Taking a learner's work out, and putting it back.
 *
 * The product's promise here is narrow and worth stating exactly: **everything that is yours leaves
 * with you, and nothing that is the pack's does.** A learner's archive holds their position, their
 * practice state, their own words, their reading library, their written work and the coaching that
 * came back on it. It does not hold a single lesson, vocabulary row or question — that material is
 * the coach's, it is republished from `packs/`, and copying it into a personal file would put
 * content somewhere it does not belong (ADR-0006).
 *
 * Two consequences shape everything below.
 *
 * **References, not identifiers.** Several ids embed a hash of the learner id (`context.ts`), and
 * the same person on a new deployment is a different learner id. So nothing owner-scoped is written
 * to the file; the parts are, and `resolve` rebuilds the id under whoever is importing. See
 * `domain/portable.ts`.
 *
 * **An import re-attaches, it does not create content.** A reference to a pack's drill item resolves
 * against material that must already be published on the target system. When it is not there, the
 * row is reported as unresolved and skipped — never invented, because a fabricated drill item would
 * be a word the learner never chose to study, sitting in a deck they trust.
 */

import { invalid } from '../http/errors.js';
import {
  ARCHIVE_KIND,
  ARCHIVE_VERSION,
  READABLE_VERSIONS,
  contentDigest,
  furtherPosition,
  itemRefKey,
  mergeProgress,
  type BlockRef,
  type ItemRef,
} from '../domain/portable.js';
import { archiveSchema, type Archive } from '../domain/schemas.js';
import { initialProgress, type DrillProgress } from '../domain/drill-progress.js';
import { drillOrigin, type Locale } from '../domain/types.js';
import type { DrillItemDoc } from '../db/collections.js';
import { FROM_LEARNER } from './content.js';
import {
  articleIdFor,
  blockIdFor,
  blockReviewIdFor,
  drillIdWithDigest,
  drillStateIdFor,
  enrollmentIdFor,
  errorLogIdFor,
  lessonIdFor,
  newEventId,
  readingStateIdFor,
  type ServiceContext,
} from './context.js';

/** Sections in a fixed order, so the file diffs cleanly and a report reads the same way twice. */
const SECTIONS = [
  'enrollments',
  'drillState',
  'ownTerms',
  'attempts',
  'submissions',
  'corrections',
  'errorLog',
  'blockReviews',
  'quizSessions',
  'articles',
] as const;

export type Section = (typeof SECTIONS)[number];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Everything about one learner, as a file.
 *
 * Read whole rather than paged. An archive is a snapshot and a half-written one is a trap: a learner
 * who restores it would find a deck that stops mid-alphabet with nothing saying so.
 */
export async function exportArchive(ctx: ServiceContext, learnerId: string, generator?: string): Promise<Archive> {
  const c = ctx.store.collections;

  const learner = await c.learners.findOne({ _id: learnerId });

  const [
    enrollments,
    drillState,
    attempts,
    submissions,
    errorLog,
    blockReviews,
    quizSessions,
    articles,
    readingState,
    ownItems,
  ] = await Promise.all([
    c.enrollments.find({ learnerId }).toArray(),
    c.drillState.find({ learnerId }).toArray(),
    c.attempts.find({ learnerId }).sort({ at: 1 }).toArray(),
    c.submissions.find({ learnerId }).sort({ createdAt: 1 }).toArray(),
    c.errorLog.find({ learnerId }).toArray(),
    c.blockReviews.find({ learnerId }).toArray(),
    c.quizSessions.find({ learnerId }).sort({ startedAt: 1 }).toArray(),
    c.articles.find({ learnerId }).sort({ addedAt: 1 }).toArray(),
    c.readingState.find({ learnerId }).toArray(),
    c.drillItems.find({ learnerId, ...FROM_LEARNER }).toArray(),
  ]);

  const corrections = await c.corrections.find({ submissionId: { $in: submissions.map((doc) => doc._id) } }).toArray();

  // The drill items this learner has actually touched, plus the ones they added themselves. Reading
  // the whole collection would also work, and would scale with the size of the *curriculum* rather
  // than with the size of one person's history — the wrong axis for a route every learner can call.
  const own = new Set(ownItems.map((item) => item._id));
  const referenced = [
    ...new Set([
      ...drillState.map((doc) => doc.drillItemId),
      ...attempts.map((doc) => doc.drillItemId),
      ...quizSessions.flatMap((doc) => [...doc.itemIds, ...doc.answers.map((answer) => answer.drillItemId)]),
    ]),
  ].filter((id) => !own.has(id));
  const items = [...ownItems, ...(await c.drillItems.find({ _id: { $in: referenced } }).toArray())];

  // Every block and lesson those items, and the learner's own rows, hang off.
  const blockIds = [
    ...new Set([
      ...items.map((item) => item.blockId),
      ...drillState.map((doc) => doc.blockId),
      ...submissions.map((doc) => doc.blockId),
      ...blockReviews.map((doc) => doc.blockId),
      ...quizSessions.map((doc) => doc.blockId),
      ...enrollments.flatMap((doc) => (doc.currentBlockId ? [doc.currentBlockId] : [])),
    ]),
  ];
  const blocks = await c.blocks
    .find({ _id: { $in: blockIds } })
    .project<{ _id: string; packId: string; order: number; learnerId?: string }>({
      packId: 1,
      order: 1,
      learnerId: 1,
    })
    .toArray();
  const blockRefById = new Map<string, BlockRef>(
    blocks.map((block) => [block._id, { pack: block.packId, block: block.order, owned: Boolean(block.learnerId) }]),
  );

  const itemRefById = new Map<string, ItemRef>();
  for (const item of items) {
    const block = blockRefById.get(item.blockId);
    if (!block) continue;
    itemRefById.set(item._id, {
      ...block,
      kind: item.payload.kind,
      digest: contentDigest(item.payload),
      own: drillOrigin(item) === 'learner',
    });
  }

  const lessonOrderById = new Map(
    (
      await c.lessons
        .find({ _id: { $in: submissions.map((doc) => doc.lessonId) } })
        .project<{ _id: string; order: number }>({ order: 1 })
        .toArray()
    ).map((lesson) => [lesson._id, lesson.order]),
  );

  // Pack versions at export time. Not used to gate an import — a learner whose pack has moved on
  // should still get their streaks back — but it is the first thing worth knowing when a reference
  // fails to resolve, so it travels with the file.
  const touched = [...new Set([...enrollments, ...drillState, ...errorLog, ...articles].map((doc) => doc.packId))];
  const packs = (
    await c.packs
      .find({ _id: { $in: touched } })
      .project<{ _id: string; version: number }>({ version: 1 })
      .toArray()
  )
    .map((pack) => ({ packId: pack._id, version: pack.version }))
    .sort((a, b) => a.packId.localeCompare(b.packId));

  const readAtByArticle = new Map(readingState.map((state) => [state.articleId, state.readAt]));

  const archive: Archive = {
    kind: ARCHIVE_KIND,
    version: ARCHIVE_VERSION,
    exportedAt: ctx.now(),
    ...(generator ? { generator } : {}),
    packs,
    // The subject and the email are identity-service's, not ours to hand out in a file (ADR-0002).
    learner: {
      ...(learner?.displayName ? { displayName: learner.displayName } : {}),
      ...(learner?.uiLanguage ? { uiLanguage: learner.uiLanguage } : {}),
      ...(learner?.profile ? { profile: learner.profile } : {}),
      // Folders and what shows (ADR-0021). Skills are named by packId, which is already portable.
      ...(learner?.menu ? { menu: learner.menu } : {}),
    },
    enrollments: enrollments.map((doc) => ({
      pack: doc.packId,
      currentBlock: (doc.currentBlockId ? blockRefById.get(doc.currentBlockId) : undefined) ?? null,
      currentLessonOrder: doc.currentLessonOrder,
      startedAt: doc.startedAt,
    })),
    drillState: drillState.flatMap((doc) => {
      const item = itemRefById.get(doc.drillItemId);
      if (!item) return [];
      const {
        _id,
        learnerId: _owner,
        drillItemId: _item,
        packId: _pack,
        blockId: _block,
        updatedAt,
        ...progress
      } = doc;
      return [{ item, progress, updatedAt }];
    }),
    ownTerms: ownItems.flatMap((item) => {
      const block = blockRefById.get(item.blockId);
      if (!block || item.payload.kind !== 'term') return [];
      return [
        {
          ...block,
          term: item.payload.term,
          translation: item.payload.translation,
          ...(item.payload.example ? { example: item.payload.example } : {}),
        },
      ];
    }),
    attempts: attempts.flatMap((doc) => {
      const item = itemRefById.get(doc.drillItemId);
      if (!item) return [];
      return [
        {
          item,
          stage: doc.stage,
          given: doc.given,
          correct: doc.correct,
          acceptedOverride: doc.acceptedOverride,
          at: doc.at,
        },
      ];
    }),
    submissions: submissions.flatMap((doc) => {
      const block = blockRefById.get(doc.blockId);
      const lesson = lessonOrderById.get(doc.lessonId);
      if (!block || lesson === undefined) return [];
      return [
        {
          id: doc._id,
          lesson: { ...block, lesson },
          answers: doc.answers,
          ...(doc.speakingNote ? { speakingNote: doc.speakingNote } : {}),
          status: doc.status,
          createdAt: doc.createdAt,
          ...(doc.correctedAt ? { correctedAt: doc.correctedAt } : {}),
        },
      ];
    }),
    corrections: corrections.map((doc) => ({
      id: doc._id,
      submissionId: doc.submissionId,
      items: doc.items,
      categoryTally: doc.categoryTally,
      ...(doc.ratings ? { ratings: doc.ratings } : {}),
      ...(doc.note ? { note: doc.note } : {}),
      ...(doc.model ? { model: doc.model } : {}),
      at: doc.at,
    })),
    errorLog: errorLog.map(({ _id, learnerId: _owner, packId, ...rest }) => ({ pack: packId, ...rest })),
    blockReviews: blockReviews.flatMap((doc) => {
      const block = blockRefById.get(doc.blockId);
      if (!block) return [];
      const { blockId: _block, learnerId: _owner, ...rest } = doc;
      return [{ ...block, ...rest }];
    }),
    quizSessions: quizSessions.flatMap((doc) => {
      const block = blockRefById.get(doc.blockId);
      if (!block) return [];
      const asked = doc.itemIds.map((id) => itemRefById.get(id));
      // A sitting is the questions it asked, in order. One missing and it is no longer that sitting,
      // so it leaves whole or not at all rather than as a shortened version of itself.
      if (asked.some((ref) => ref === undefined)) return [];
      return [
        {
          id: doc._id,
          block,
          mode: doc.mode,
          items: asked as ItemRef[],
          answers: doc.answers.flatMap((answer) => {
            const item = itemRefById.get(answer.drillItemId);
            return item ? [{ ...answer, item, drillItemId: undefined }] : [];
          }),
          ...(doc.limitSeconds ? { limitSeconds: doc.limitSeconds } : {}),
          startedAt: doc.startedAt,
          ...(doc.finishedAt ? { finishedAt: doc.finishedAt } : {}),
        },
      ];
    }),
    articles: articles.map(({ _id, learnerId: _owner, packId, ...rest }) => ({
      ...rest,
      pack: packId,
      readAt: readAtByArticle.get(_id) ?? null,
    })),
  } as Archive;

  return archive;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface SectionReport {
  /** Rows the import wrote, or would write on a dry run. */
  applied: number;
  /** Rows already matching what is live — an import that changes nothing is a success, not a no-op. */
  unchanged: number;
  /** Rows whose reference names material this system does not have. */
  unresolved: number;
}

export interface ImportReport {
  dryRun: boolean;
  archive: { version: number; exportedAt: Date; generator?: string };
  /** Pack versions in the file against what is published here. Advisory — nothing is gated on it. */
  packs: { packId: string; archived: number; live: number | null }[];
  sections: Record<Section, SectionReport>;
  /** The first few references that did not resolve, so a learner can see *what* is missing. */
  examples: { section: Section; ref: string; why: string }[];
}

const EXAMPLE_LIMIT = 25;

const emptyReport = (): Record<Section, SectionReport> =>
  Object.fromEntries(SECTIONS.map((name) => [name, { applied: 0, unchanged: 0, unresolved: 0 }])) as Record<
    Section,
    SectionReport
  >;

export interface ImportOptions {
  /** Report what would happen and write nothing. The safe way to look at a file you are unsure of. */
  dryRun?: boolean;
  generator?: string;
}

/**
 * Fold an archive into this learner's account.
 *
 * The whole file is parsed before anything is written. A half-applied archive is worse than a
 * refused one — nobody can tell which half landed — so a malformed file is a `400` with the parse
 * error, not a partial restore.
 */
export async function importArchive(
  ctx: ServiceContext,
  learnerId: string,
  input: unknown,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) {
    throw invalid('this file is not a readable learner archive', { issues: parsed.error.issues.slice(0, 20) });
  }
  const archive = parsed.data;

  if (!READABLE_VERSIONS.includes(archive.version)) {
    throw invalid(`this archive is version ${archive.version}; this system reads ${READABLE_VERSIONS.join(', ')}`, {
      archiveVersion: archive.version,
      readable: READABLE_VERSIONS,
    });
  }

  const dryRun = options.dryRun ?? false;
  const c = ctx.store.collections;
  const sections = emptyReport();
  const examples: ImportReport['examples'] = [];
  const now = ctx.now();

  const miss = (section: Section, ref: string, why: string): void => {
    sections[section].unresolved += 1;
    if (examples.length < EXAMPLE_LIMIT) examples.push({ section, ref, why });
  };

  // --- resolving references ------------------------------------------------

  /** A block ref becomes an id under *this* learner, which is the whole point of the exercise. */
  const blockIdOf = (ref: BlockRef): string => blockIdFor(ref.pack, ref.block, ref.owned ? learnerId : undefined);
  const itemIdOf = (ref: ItemRef): string =>
    drillIdWithDigest(blockIdOf(ref), ref.digest, ref.own ? learnerId : undefined);

  // Cached because an archive asks about the same handful of blocks thousands of times over —
  // once per attempt, once per state row — and the answer cannot change mid-import.
  const existsCache = new Map<string, boolean>();
  const exists = async (id: string, collection: 'blocks' | 'lessons' | 'drillItems'): Promise<boolean> => {
    const key = `${collection}:${id}`;
    const cached = existsCache.get(key);
    if (cached !== undefined) return cached;
    const found = (await c[collection].countDocuments({ _id: id }, { limit: 1 })) > 0;
    existsCache.set(key, found);
    return found;
  };

  // --- the learner's own words, first --------------------------------------
  //
  // Before any drill state, deliberately: a word the learner added exists nowhere but in this file,
  // so it has to be back in the deck before the streak on it has anything to attach to.

  const ownTermIds = new Map<string, string>();
  for (const entry of archive.ownTerms) {
    const blockId = blockIdOf(entry);
    if (!(await exists(blockId, 'blocks'))) {
      miss('ownTerms', `${entry.pack}/b${entry.block}`, 'no such block on this system');
      continue;
    }
    const payload = {
      kind: 'term' as const,
      term: entry.term,
      translation: entry.translation,
      ...(entry.example ? { example: entry.example } : {}),
    };
    const _id = drillIdWithDigest(blockId, contentDigest(payload), learnerId);
    ownTermIds.set(itemRefKey({ ...entry, kind: 'term', digest: contentDigest(payload), own: true }), _id);

    const live = await c.drillItems.findOne({ _id });
    if (live && JSON.stringify(live.payload) === JSON.stringify(payload)) {
      sections.ownTerms.unchanged += 1;
      continue;
    }
    sections.ownTerms.applied += 1;
    if (dryRun) continue;
    const doc: Omit<DrillItemDoc, '_id'> = {
      packId: entry.pack,
      blockId,
      payload,
      learnerId,
      origin: 'learner',
    };
    await c.drillItems.replaceOne({ _id }, doc, { upsert: true });
  }

  /** An item id, if this system actually has that item. Own words count: they were just written. */
  const resolveItem = async (ref: ItemRef): Promise<string | null> => {
    const _id = itemIdOf(ref);
    if (ownTermIds.has(itemRefKey(ref))) return _id;
    return (await exists(_id, 'drillItems')) ? _id : null;
  };

  // --- practice state ------------------------------------------------------

  for (const entry of archive.drillState) {
    const drillItemId = await resolveItem(entry.item);
    if (!drillItemId) {
      miss('drillState', itemRefKey(entry.item), 'no such drill item on this system');
      continue;
    }
    const _id = drillStateIdFor(learnerId, drillItemId);
    const live = await c.drillState.findOne({ _id });
    const before: DrillProgress = live
      ? {
          stage: live.stage,
          streak: live.streak,
          stage1Cleared: live.stage1Cleared,
          stage2Cleared: live.stage2Cleared,
          mastered: live.mastered,
          attempts: live.attempts,
          correct: live.correct,
        }
      : initialProgress();
    const merged = mergeProgress(before, entry.progress);

    if (live && JSON.stringify(before) === JSON.stringify(merged)) {
      sections.drillState.unchanged += 1;
      continue;
    }
    sections.drillState.applied += 1;
    if (dryRun) continue;
    await c.drillState.replaceOne(
      { _id },
      {
        ...merged,
        learnerId,
        drillItemId,
        packId: entry.item.pack,
        blockId: blockIdOf(entry.item),
        // The moment the state reached this shape, which after a merge is now — not the file's clock.
        updatedAt: live ? now : entry.updatedAt,
      },
      { upsert: true },
    );
  }

  // --- position ------------------------------------------------------------

  for (const entry of archive.enrollments) {
    const _id = enrollmentIdFor(learnerId, entry.pack);
    const live = await c.enrollments.findOne({ _id });
    const incomingBlock = entry.currentBlock;
    const incomingBlockId = incomingBlock ? blockIdOf(incomingBlock) : undefined;

    if (incomingBlock && incomingBlockId && !(await exists(incomingBlockId, 'blocks'))) {
      miss('enrollments', `${entry.pack}/b${incomingBlock.block}`, 'no such block on this system');
      continue;
    }

    if (!live) {
      sections.enrollments.applied += 1;
      if (dryRun) continue;
      await c.enrollments.replaceOne(
        { _id },
        {
          learnerId,
          packId: entry.pack,
          ...(incomingBlockId ? { currentBlockId: incomingBlockId } : {}),
          currentLessonOrder: entry.currentLessonOrder,
          startedAt: entry.startedAt,
        },
        { upsert: true },
      );
      continue;
    }

    // Never backwards, for the same reason an item is never demoted: an old file must not undo work.
    const liveOrder = live.currentBlockId
      ? ((await c.blocks.findOne({ _id: live.currentBlockId }, { projection: { order: 1 } }))?.order ?? 0)
      : 0;
    const further = furtherPosition(
      { blockOrder: liveOrder, lessonOrder: live.currentLessonOrder },
      { blockOrder: incomingBlock?.block ?? 0, lessonOrder: entry.currentLessonOrder },
    );
    const startedAt = entry.startedAt < live.startedAt ? entry.startedAt : live.startedAt;
    const nextBlockId = further.blockOrder === liveOrder ? live.currentBlockId : incomingBlockId;

    if (
      further.lessonOrder === live.currentLessonOrder &&
      nextBlockId === live.currentBlockId &&
      startedAt.getTime() === live.startedAt.getTime()
    ) {
      sections.enrollments.unchanged += 1;
      continue;
    }
    sections.enrollments.applied += 1;
    if (dryRun) continue;
    await c.enrollments.replaceOne(
      { _id },
      {
        learnerId,
        packId: entry.pack,
        ...(nextBlockId ? { currentBlockId: nextBlockId } : {}),
        currentLessonOrder: further.lessonOrder,
        // The earlier of the two: when this learner actually started the pack, wherever they were.
        startedAt,
      },
      { upsert: true },
    );
  }

  // --- history -------------------------------------------------------------
  //
  // Everything below is an *event*: it happened, so an import never overwrites one that is already
  // here. Where the file and this system hold the same id — a restore onto the machine the archive
  // came from — the row is left exactly as it is.

  // An attempt's `_id` is random and means nothing, so an archived one cannot be recognised by it.
  // What identifies the event is the event: this learner, this item, this instant. Read once into a
  // set rather than asked per row — an archive is mostly attempts, and a query each would be a
  // round trip per answer the learner has ever given.
  //
  // Two attempts on one item within the same millisecond would collapse to one. They are a network
  // round trip apart in practice, and losing the second from a restored history is a far smaller
  // wrong than doubling every attempt each time somebody re-imports their own backup.
  const attemptKey = (drillItemId: string, at: Date): string => `${drillItemId}:${at.getTime()}`;
  const liveAttempts = new Set(
    (
      await c.attempts
        .find({ learnerId })
        .project<{ drillItemId: string; at: Date }>({ drillItemId: 1, at: 1 })
        .toArray()
    ).map((doc) => attemptKey(doc.drillItemId, doc.at)),
  );

  for (const entry of archive.attempts) {
    const drillItemId = await resolveItem(entry.item);
    if (!drillItemId) {
      miss('attempts', itemRefKey(entry.item), 'no such drill item on this system');
      continue;
    }
    const key = attemptKey(drillItemId, entry.at);
    if (liveAttempts.has(key)) {
      sections.attempts.unchanged += 1;
      continue;
    }
    liveAttempts.add(key);
    sections.attempts.applied += 1;
    if (dryRun) continue;
    await c.attempts.insertOne({
      _id: newEventId(),
      learnerId,
      drillItemId,
      stage: entry.stage,
      given: entry.given,
      correct: entry.correct,
      acceptedOverride: entry.acceptedOverride,
      at: entry.at,
    });
  }

  /**
   * The id an archived event should be written under.
   *
   * Events keep their id from the file, so a correction can still name its submission after the
   * move. But those ids are random and this system may already hold one — and if it belongs to
   * *another* learner, reusing it would either skip the row silently or overwrite somebody else's
   * work with this learner's. So an id that is taken by someone else is replaced by a fresh one,
   * and an id that is already this learner's own is what makes re-importing a backup a no-op.
   */
  const claimId = async (
    collection: 'submissions' | 'corrections' | 'quizSessions',
    archived: string,
  ): Promise<{ _id: string; mine: boolean }> => {
    const live = await c[collection].findOne({ _id: archived }, { projection: { learnerId: 1 } });
    if (!live) return { _id: archived, mine: false };
    if (live.learnerId === learnerId) return { _id: archived, mine: true };
    return { _id: newEventId(), mine: false };
  };

  /** Archived submission id → the id it actually landed under, so a correction can follow it. */
  const submissionIds = new Map<string, string>();
  for (const entry of archive.submissions) {
    const blockId = blockIdOf(entry.lesson);
    const lessonId = lessonIdFor(blockId, entry.lesson.lesson);
    if (!(await exists(lessonId, 'lessons'))) {
      miss('submissions', `${entry.lesson.pack}/b${entry.lesson.block}/l${entry.lesson.lesson}`, 'no such lesson here');
      continue;
    }
    const claimed = await claimId('submissions', entry.id);
    submissionIds.set(entry.id, claimed._id);
    if (claimed.mine) {
      sections.submissions.unchanged += 1;
      continue;
    }
    sections.submissions.applied += 1;
    if (dryRun) continue;
    await c.submissions.insertOne({
      _id: claimed._id,
      learnerId,
      packId: entry.lesson.pack,
      blockId,
      lessonId,
      answers: entry.answers,
      ...(entry.speakingNote ? { speakingNote: entry.speakingNote } : {}),
      status: entry.status,
      createdAt: entry.createdAt,
      ...(entry.correctedAt ? { correctedAt: entry.correctedAt } : {}),
    });
  }

  for (const entry of archive.corrections) {
    // A correction without its submission is feedback on nothing — the session log has no left-hand
    // page to print. It waits for the submission rather than landing on its own.
    const submissionId = submissionIds.get(entry.submissionId);
    if (!submissionId) {
      miss('corrections', entry.submissionId, 'its submission did not resolve');
      continue;
    }
    if (await c.corrections.countDocuments({ submissionId }, { limit: 1 })) {
      sections.corrections.unchanged += 1;
      continue;
    }
    sections.corrections.applied += 1;
    if (dryRun) continue;
    await c.corrections.insertOne({
      _id: (await claimId('corrections', entry.id))._id,
      submissionId,
      learnerId,
      items: entry.items,
      categoryTally: entry.categoryTally,
      ...(entry.ratings ? { ratings: entry.ratings } : {}),
      ...(entry.note ? { note: entry.note } : {}),
      correctedBy: 'external-coach',
      ...(entry.model ? { model: entry.model } : {}),
      at: entry.at,
    });
  }

  for (const entry of archive.errorLog) {
    const _id = errorLogIdFor(learnerId, entry.pack, entry.category);
    const live = await c.errorLog.findOne({ _id });
    const { pack, ...rest } = entry;

    // The later sighting wins the record whole, and the earlier first-sighting is kept: those are
    // the two facts a merge can honestly assert. Counts are never summed — the same mistake counted
    // from both sides of a backup would inflate a number the learner reads as their own history.
    if (live && live.lastSeen >= entry.lastSeen) {
      sections.errorLog.unchanged += 1;
      continue;
    }
    sections.errorLog.applied += 1;
    if (dryRun) continue;
    await c.errorLog.replaceOne(
      { _id },
      {
        ...rest,
        learnerId,
        packId: pack,
        firstSeen: live && live.firstSeen < entry.firstSeen ? live.firstSeen : entry.firstSeen,
      },
      { upsert: true },
    );
  }

  for (const entry of archive.blockReviews) {
    const blockId = blockIdOf(entry);
    if (!(await exists(blockId, 'blocks'))) {
      miss('blockReviews', `${entry.pack}/b${entry.block}`, 'no such block on this system');
      continue;
    }
    const _id = blockReviewIdFor(blockId, learnerId);
    if (await c.blockReviews.countDocuments({ _id }, { limit: 1 })) {
      sections.blockReviews.unchanged += 1;
      continue;
    }
    sections.blockReviews.applied += 1;
    if (dryRun) continue;
    const { pack: _pack, block: _block, owned: _owned, at, ...review } = entry;
    await c.blockReviews.replaceOne({ _id }, { ...review, blockId, learnerId, at }, { upsert: true });
  }

  for (const entry of archive.quizSessions) {
    const blockId = blockIdOf(entry.block);
    const itemIds: string[] = [];
    let broken = false;
    for (const ref of entry.items) {
      const id = await resolveItem(ref);
      if (!id) {
        broken = true;
        break;
      }
      itemIds.push(id);
    }
    if (broken) {
      miss('quizSessions', entry.id, 'a question in this sitting is not on this system');
      continue;
    }
    const claimed = await claimId('quizSessions', entry.id);
    if (claimed.mine) {
      sections.quizSessions.unchanged += 1;
      continue;
    }
    sections.quizSessions.applied += 1;
    if (dryRun) continue;
    const answers = [];
    for (const answer of entry.answers) {
      const drillItemId = await resolveItem(answer.item);
      if (!drillItemId) continue;
      answers.push({
        drillItemId,
        chosen: answer.chosen,
        correct: answer.correct,
        categories: answer.categories,
        at: answer.at,
      });
    }
    await c.quizSessions.insertOne({
      _id: claimed._id,
      learnerId,
      packId: entry.block.pack,
      blockId,
      mode: entry.mode,
      itemIds,
      answers,
      ...(entry.limitSeconds ? { limitSeconds: entry.limitSeconds } : {}),
      startedAt: entry.startedAt,
      ...(entry.finishedAt ? { finishedAt: entry.finishedAt } : {}),
    });
  }

  // --- the reading library -------------------------------------------------
  //
  // Articles are the learner's own content, so they are re-created rather than resolved — like the
  // learner's own words, they exist nowhere but in this file. The read mark rides with the article.

  for (const entry of archive.articles) {
    const { pack, readAt, addedAt, ...article } = entry;
    if (!(await c.packs.countDocuments({ _id: pack }, { limit: 1 }))) {
      miss('articles', `${pack}/${article.slug}`, 'no such pack on this system');
      continue;
    }
    const _id = articleIdFor(pack, learnerId, article.slug);
    const live = await c.articles.findOne({ _id });
    const liveRead = live ? await c.readingState.findOne({ _id: readingStateIdFor(learnerId, _id) }) : null;
    const readUnchanged = (liveRead?.readAt ?? null) !== null || readAt === null;

    if (live && readUnchanged) {
      sections.articles.unchanged += 1;
      continue;
    }
    sections.articles.applied += 1;
    if (dryRun) continue;

    await c.articles.replaceOne(
      { _id },
      {
        packId: pack,
        learnerId,
        slug: article.slug,
        labels: article.labels,
        bodies: article.bodies,
        ...(article.source ? { source: article.source } : {}),
        ...(article.estimatedMinutes ? { estimatedMinutes: article.estimatedMinutes } : {}),
        // The earlier of the two: when this article actually entered the library.
        addedAt: live && live.addedAt < addedAt ? live.addedAt : addedAt,
      },
      { upsert: true },
    );
    // Read is a floor too — an archive that does not know an article was read cannot unread it.
    if (readAt && !liveRead) {
      await c.readingState.replaceOne(
        { _id: readingStateIdFor(learnerId, _id) },
        { learnerId, articleId: _id, packId: pack, readAt },
        { upsert: true },
      );
    }
  }

  // --- the learner's own settings ------------------------------------------
  //
  // Applied last and only where this system has nothing: a display name or an interface language set
  // here is a choice made *here*, and a file from six months ago has no business overruling it. The
  // domain profile is the same — it is what the next block gets written about (ADR-0015).

  if (!dryRun) {
    const live = await c.learners.findOne({ _id: learnerId });
    const fill: Record<string, unknown> = {};
    if (archive.learner.displayName && !live?.displayName) fill.displayName = archive.learner.displayName;
    if (archive.learner.uiLanguage && !live?.uiLanguage) fill.uiLanguage = archive.learner.uiLanguage as Locale;
    if (archive.learner.profile && !live?.profile) fill.profile = archive.learner.profile;
    // Stored as it arrived: the menu is reconciled with what is started every time it is read, so a
    // folder naming a skill this system does not have simply shows without it.
    if (archive.learner.menu && !live?.menu) fill.menu = archive.learner.menu;
    if (Object.keys(fill).length > 0) await c.learners.updateOne({ _id: learnerId }, { $set: fill });
  }

  const livePacks = await c.packs
    .find({ _id: { $in: archive.packs.map((entry) => entry.packId) } })
    .project<{ _id: string; version: number }>({ version: 1 })
    .toArray();
  const liveVersion = new Map(livePacks.map((pack) => [pack._id, pack.version]));

  return {
    dryRun,
    archive: {
      version: archive.version,
      exportedAt: archive.exportedAt,
      ...(archive.generator ? { generator: archive.generator } : {}),
    },
    packs: archive.packs.map((entry) => ({
      packId: entry.packId,
      archived: entry.version,
      live: liveVersion.get(entry.packId) ?? null,
    })),
    sections,
    examples,
  };
}
