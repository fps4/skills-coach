/**
 * Moving a learner's words and reading out of a programme pack into skills of their own (ADR-0022).
 *
 * The Dutch programme carried a word deck and a reading library inside it. Both are becoming skills
 * of their own — a word trainer and a reading list — so a learner can study them without the
 * programme, and the programme can go. This copies what each learner had into the new skills:
 *
 * - **Every word they could practise** — the programme's own and the ones they added — becomes one of
 *   *their own* words in the word skill's deck, so nothing a later publish does can touch it
 *   (ADR-0012). Two copies of the same word collapse into one.
 * - **Their progress on each word comes with it**, merged by the archive's never-demote rule
 *   (ADR-0020) where two old items become one new one, and their attempt history is copied too.
 * - **Their reading library and what they had read** move to the reading skill, keyed by the same
 *   slugs, so a reload by the reading workflow lands on the same articles.
 * - **They are enrolled in both**, and the two are filed in one folder of their menu (ADR-0021).
 *
 * It **copies and never deletes**. The source pack is untouched, which is what makes this safe to run
 * twice and safe to check before anything is removed; taking the old pack away is a separate,
 * deliberate step (`remove-pack --including-history`).
 *
 * Idempotent: every id it writes is derived from what it copies, so a second run finds everything
 * already there and changes nothing that is already at least as far along.
 */

import { mergeProgress } from '../domain/portable.js';
import { normalizeMenu } from '../domain/menu.js';
import type { DrillProgress } from '../domain/drill-progress.js';
import type { LocalizedText, TermPayload } from '../domain/types.js';
import { conflict } from '../http/errors.js';
import { getPack, listBlocks, publishBlock } from './content.js';
import { articleIdFor, drillIdFor, drillStateIdFor, readingStateIdFor, type ServiceContext } from './context.js';
import { enroll } from './learners.js';

/** The block every learner's words live in, in a skill that is only a deck (ADR-0022). */
export const DECK_BLOCK = {
  order: 1,
  slug: 'woordenlijst',
  title: { nl: 'Woordenlijst', en: 'Word list' } satisfies LocalizedText,
};

export interface MigrationOptions {
  /** The programme pack words and reading come out of. */
  from: string;
  /** The word skill they go into. Must be published already. */
  words: string;
  /** The reading skill articles go into. Must be published already. */
  reading: string;
  /** The menu folder both new skills are filed in, created if the learner has none by this name. */
  folder: LocalizedText;
  /** Report what would happen and write nothing. */
  dryRun: boolean;
}

export interface LearnerReport {
  learnerId: string;
  words: number;
  wordsWithProgress: number;
  attempts: number;
  articles: number;
  read: number;
}

export interface MigrationReport {
  deckBlockId: string;
  deckCreated: boolean;
  learners: LearnerReport[];
}

/** The side of a word a deck keys it on, and what it carries — never the lesson it came from. */
const deckPayload = (payload: TermPayload): TermPayload => ({
  kind: 'term',
  term: payload.term,
  translation: payload.translation,
  ...(payload.example ? { example: payload.example } : {}),
});

const PROGRESS_FIELDS = [
  'stage',
  'streak',
  'stage1Cleared',
  'stage2Cleared',
  'mastered',
  'attempts',
  'correct',
] as const;
const progressOf = (doc: DrillProgress): DrillProgress =>
  Object.fromEntries(PROGRESS_FIELDS.map((field) => [field, doc[field]])) as unknown as DrillProgress;

export async function migrateToSkills(ctx: ServiceContext, options: MigrationOptions): Promise<MigrationReport> {
  const c = ctx.store.collections;
  // All three must exist: publishing the new manifests is its own reviewed step, and copying into a
  // pack that is not there would leave words in a deck nobody can open.
  await getPack(ctx, options.from);
  await getPack(ctx, options.words);
  await getPack(ctx, options.reading);

  // --- the deck ----------------------------------------------------------------

  const existingDeck = (await listBlocks(ctx, options.words)).find((block) => block.order === DECK_BLOCK.order);
  if (existingDeck && existingDeck.lessonCount > 0) {
    throw conflict(`${options.words} block ${DECK_BLOCK.order} has lessons; it is not a deck this can fill`);
  }
  let deckBlockId = existingDeck?.blockId;
  if (!deckBlockId) {
    if (options.dryRun) deckBlockId = `${options.words}.b${DECK_BLOCK.order}`;
    else
      deckBlockId = (
        await publishBlock(ctx, options.words, { ...DECK_BLOCK, status: 'published', lessons: [], drillItems: [] })
      ).block.blockId;
  }

  // --- who --------------------------------------------------------------------

  // Anyone with anything to carry: an enrollment, a word of their own, or a reading library.
  const learnerIds = new Set<string>(
    [
      ...(await c.enrollments.distinct('learnerId', { packId: options.from })),
      ...(await c.drillItems.distinct('learnerId', { packId: options.from, learnerId: { $exists: true } })),
      ...(await c.articles.distinct('learnerId', { packId: options.from })),
    ].filter((id): id is string => typeof id === 'string'),
  );

  const learners: LearnerReport[] = [];
  for (const learnerId of [...learnerIds].sort()) {
    learners.push(await migrateLearner(ctx, options, deckBlockId, learnerId));
  }

  return { deckBlockId, deckCreated: !existingDeck, learners };
}

async function migrateLearner(
  ctx: ServiceContext,
  options: MigrationOptions,
  deckBlockId: string,
  learnerId: string,
): Promise<LearnerReport> {
  const c = ctx.store.collections;

  // --- words ------------------------------------------------------------------

  // Every term this learner could practise in the programme: the pack's own, and their own words.
  const terms = await c.drillItems
    .find({
      packId: options.from,
      'payload.kind': 'term',
      $or: [{ learnerId: { $exists: false } }, { learnerId }],
    })
    .toArray();

  // Old item → new item. Several old items can land on one new one: the same word taught in two
  // blocks, or taught and also added by the learner.
  const target = new Map<string, string>();
  const payloads = new Map<string, TermPayload>();
  for (const item of terms) {
    const payload = deckPayload(item.payload as TermPayload);
    const newId = drillIdFor(deckBlockId, payload, learnerId);
    target.set(item._id, newId);
    if (!payloads.has(newId)) payloads.set(newId, payload);
  }

  const oldStates = await c.drillState.find({ learnerId, drillItemId: { $in: [...target.keys()] } }).toArray();
  const merged = new Map<string, { progress: DrillProgress; updatedAt: Date }>();
  for (const state of oldStates) {
    const newId = target.get(state.drillItemId);
    if (!newId) continue;
    const previous = merged.get(newId);
    merged.set(newId, {
      progress: previous ? mergeProgress(previous.progress, progressOf(state)) : progressOf(state),
      updatedAt: previous && previous.updatedAt > state.updatedAt ? previous.updatedAt : state.updatedAt,
    });
  }

  const attempts = await c.attempts.find({ learnerId, drillItemId: { $in: [...target.keys()] } }).toArray();

  if (!options.dryRun) {
    for (const [newId, payload] of payloads) {
      // Inserted only when missing: a word the learner has edited since a first run keeps its edit.
      await c.drillItems.updateOne(
        { _id: newId },
        {
          $setOnInsert: {
            packId: options.words,
            blockId: deckBlockId,
            payload,
            learnerId,
            origin: 'learner' as const,
          },
        },
        { upsert: true },
      );
    }

    for (const [newId, { progress, updatedAt }] of merged) {
      const stateId = drillStateIdFor(learnerId, newId);
      const live = await c.drillState.findOne({ _id: stateId });
      // Never demote: practice done in the new skill since a first run is kept if it is further on.
      const next = live ? mergeProgress(progressOf(live), progress) : progress;
      await c.drillState.replaceOne(
        { _id: stateId },
        {
          ...next,
          learnerId,
          drillItemId: newId,
          packId: options.words,
          blockId: deckBlockId,
          updatedAt: live && live.updatedAt > updatedAt ? live.updatedAt : updatedAt,
        },
        { upsert: true },
      );
    }

    for (const attempt of attempts) {
      const newId = target.get(attempt.drillItemId);
      if (!newId) continue;
      // Keyed on the attempt it copies, so a second run writes the same documents again.
      const { _id, ...rest } = attempt;
      await c.attempts.replaceOne(
        { _id: `${_id}>${options.words}` },
        { ...rest, drillItemId: newId },
        { upsert: true },
      );
    }

    await enroll(ctx, learnerId, options.words, deckBlockId);
  }

  // --- reading ----------------------------------------------------------------

  const articles = await c.articles.find({ packId: options.from, learnerId }).toArray();
  const readStates = await c.readingState.find({ learnerId, packId: options.from }).toArray();
  const readAt = new Map(readStates.map((state) => [state.articleId, state.readAt]));

  if (!options.dryRun) {
    for (const article of articles) {
      const { _id, ...rest } = article;
      const newId = articleIdFor(options.reading, learnerId, article.slug);
      // Replaced rather than inserted-if-missing: the article is content, and the copy should match
      // the source until the source goes away.
      await c.articles.replaceOne({ _id: newId }, { ...rest, packId: options.reading }, { upsert: true });
      const at = readAt.get(_id);
      if (at) {
        await c.readingState.replaceOne(
          { _id: readingStateIdFor(learnerId, newId) },
          { learnerId, articleId: newId, packId: options.reading, readAt: at },
          { upsert: true },
        );
      }
    }
    if (articles.length > 0) await enroll(ctx, learnerId, options.reading);

    await fileInFolder(ctx, learnerId, options);
  }

  return {
    learnerId,
    words: payloads.size,
    wordsWithProgress: merged.size,
    attempts: attempts.length,
    articles: articles.length,
    read: articles.filter((article) => readAt.has(article._id)).length,
  };
}

/**
 * Put the new skills in one folder of the learner's menu, and leave everything else where it is.
 *
 * The folder is found by name in the learner's interface language, so a learner who already made a
 * "Nederlands" folder gets the skills filed there rather than a second folder of the same name.
 */
async function fileInFolder(ctx: ServiceContext, learnerId: string, options: MigrationOptions): Promise<void> {
  const c = ctx.store.collections;
  const learner = await c.learners.findOne({ _id: learnerId });
  if (!learner) return;

  const started = (await c.enrollments.find({ learnerId }).sort({ startedAt: 1 }).toArray()).map(
    (entry) => entry.packId,
  );
  const menu = normalizeMenu(learner.menu, started);
  const name = options.folder[learner.uiLanguage] ?? options.folder.nl ?? options.folder.en ?? 'Folder';

  let folder = menu.folders.find((entry) => entry.name === name);
  if (!folder) {
    folder = { folderId: `f${options.words.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30)}`, name };
    menu.folders.push(folder);
  }
  const folderId = folder.folderId;

  const placements = menu.placements.map((entry) =>
    entry.packId === options.words || entry.packId === options.reading ? { ...entry, folderId, hidden: false } : entry,
  );
  await c.learners.updateOne({ _id: learnerId }, { $set: { menu: normalizeMenu({ ...menu, placements }, started) } });
}
