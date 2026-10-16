/**
 * Search: a lexical index over guides and cards, held in this process's memory (ADR-0030).
 *
 * Nothing here is authoritative. The index is derived from the guide files and from MongoDB and can
 * be thrown away at any moment; the three ways it stays current all rely on that:
 *
 * - **At boot** it is built in full before the api listens. Guides change only with the image, so a
 *   deploy is the guide reindex.
 * - **On write**, a service that changes a block's cards calls `blockChanged`, which re-reads that
 *   block. Only a write made in *this* process reaches it.
 * - **On a timer** (`SEARCH_REBUILD_MINUTES`) it is rebuilt into a fresh index and swapped in when
 *   complete — for the writes that are not made here: the `maintain-skills` scripts run as separate
 *   processes, and their hooks would fire in theirs.
 *
 * A failed rebuild keeps the previous index. A failed hook logs and leaves the write alone: search
 * being stale for one interval is a lesser fault than a publish that errors after it has succeeded.
 *
 * What a document is, who may see it and what a snippet marks are `domain/search.ts`'s, pure. This
 * file holds the engine and the I/O around it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import MiniSearch, { type SearchResult } from 'minisearch';
import type { Store } from '../db/client.js';
import type { DrillItemDoc } from '../db/collections.js';
import { singleLanguageText } from '../domain/pack-text.js';
import {
  SEARCH_BOOSTS,
  SEARCH_FIELDS,
  cardDocument,
  foldGuides,
  guideDocuments,
  normalizeTerm,
  parseGuideSource,
  snippetFor,
  tokenize,
  visibleTo,
  type SearchDocument,
  type SearchKind,
  type SnippetPart,
} from '../domain/search.js';

export interface SearchOptions {
  kind?: SearchKind;
  skill?: string;
  limit: number;
}

export interface SearchHit {
  kind: SearchKind;
  skillId: string;
  skillTitle: string;
  title: string;
  context: string;
  snippet: SnippetPart[];
  /** Guides: where the section is. */
  slug?: string;
  anchor?: string;
  /** Cards: the deck it is in. */
  blockId?: string;
  drillItemId?: string;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  /** How many results the filters left, before `limit`. */
  total: number;
  /** Per kind, within the skill filter — so the kind tabs can say what each holds. */
  counts: Record<SearchKind, number>;
  /** Per skill, within the kind filter, most results first. */
  skills: { skillId: string; title: string; count: number }[];
}

// ---------------------------------------------------------------------------
// The engine — in memory, no I/O
// ---------------------------------------------------------------------------

const newMiniSearch = () =>
  new MiniSearch<SearchDocument>({
    idField: 'id',
    fields: [...SEARCH_FIELDS],
    tokenize: (text) => tokenize(text),
    processTerm: (term) => normalizeTerm(term),
  });

/**
 * The documents and the index over them. Separate from the loaders so the ranking can be tested
 * without a database (`tests/unit/search-engine.test.ts`).
 */
export class SearchEngine {
  private readonly index = newMiniSearch();
  private readonly documents = new Map<string, SearchDocument>();
  private readonly byBlock = new Map<string, Set<string>>();
  private skillTitles = new Map<string, string>();

  get size(): number {
    return this.documents.size;
  }

  setSkillTitles(titles: Map<string, string>): void {
    this.skillTitles = titles;
  }

  add(document: SearchDocument): void {
    this.remove(document.id);
    this.index.add(document);
    this.documents.set(document.id, document);
    if (document.blockId) {
      const ids = this.byBlock.get(document.blockId) ?? new Set<string>();
      ids.add(document.id);
      this.byBlock.set(document.blockId, ids);
    }
  }

  remove(id: string): void {
    const existing = this.documents.get(id);
    if (!existing) return;
    this.index.discard(id);
    this.documents.delete(id);
    if (existing.blockId) this.byBlock.get(existing.blockId)?.delete(id);
  }

  /** A block's cards, replaced wholesale — what a republish or an archive amounts to. */
  replaceBlock(blockId: string, documents: SearchDocument[]): void {
    for (const id of [...(this.byBlock.get(blockId) ?? [])]) this.remove(id);
    this.byBlock.delete(blockId);
    for (const document of documents) this.add(document);
  }

  /**
   * Every term must match, the last one as a prefix (the learner is still typing it), each with a
   * little fuzziness for a typo. When nothing matches every term, any term will do — ranked, so the
   * documents matching more of them still come first.
   */
  query(learnerId: string, text: string, options: SearchOptions): SearchResponse {
    const filter = (result: SearchResult) => {
      const document = this.documents.get(String(result.id));
      return document !== undefined && visibleTo(document, learnerId);
    };
    const run = (combineWith: 'AND' | 'OR') =>
      this.index.search(text, {
        combineWith,
        boost: SEARCH_BOOSTS,
        prefix: (_term, index, terms) => index === terms.length - 1,
        fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
        filter,
      });

    let results = run('AND');
    if (results.length === 0) results = run('OR');

    const ranked = foldGuides(
      results.map((result) => ({ ...this.documents.get(String(result.id))!, terms: new Set(result.terms) })),
    );

    const inSkill = ranked.filter((hit) => !options.skill || hit.skillId === options.skill);
    const ofKind = ranked.filter((hit) => !options.kind || hit.kind === options.kind);
    const filtered = inSkill.filter((hit) => !options.kind || hit.kind === options.kind);

    const perSkill = new Map<string, number>();
    for (const hit of ofKind) perSkill.set(hit.skillId, (perSkill.get(hit.skillId) ?? 0) + 1);

    return {
      query: text,
      total: filtered.length,
      counts: {
        guide: inSkill.filter((hit) => hit.kind === 'guide').length,
        card: inSkill.filter((hit) => hit.kind === 'card').length,
      },
      skills: [...perSkill]
        .map(([skillId, count]) => ({ skillId, title: this.titleOf(skillId), count }))
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'en')),
      hits: filtered.slice(0, options.limit).map((hit) => ({
        kind: hit.kind,
        skillId: hit.skillId,
        skillTitle: this.titleOf(hit.skillId),
        title: hit.title,
        context: hit.context,
        snippet: snippetFor(hit, hit.terms),
        ...(hit.slug ? { slug: hit.slug } : {}),
        ...(hit.anchor ? { anchor: hit.anchor } : {}),
        ...(hit.blockId ? { blockId: hit.blockId } : {}),
        ...(hit.drillItemId ? { drillItemId: hit.drillItemId } : {}),
      })),
    };
  }

  private titleOf(skillId: string): string {
    return this.skillTitles.get(skillId) ?? skillId;
  }
}

// ---------------------------------------------------------------------------
// The index — the engine, kept current
// ---------------------------------------------------------------------------

/** What a write tells search. Absent from a context built outside the server process. */
export interface SearchHooks {
  /** A block's cards may have changed — published, republished, archived, a word added or removed. */
  blockChanged(blockId: string): Promise<void>;
  /** A skill's manifest was written; its title may have changed. */
  skillsChanged(): Promise<void>;
}

export interface SearchIndex extends SearchHooks {
  query(learnerId: string, text: string, options: SearchOptions): SearchResponse;
  /** Build a fresh index and swap it in. Concurrent calls share one build. */
  rebuild(): Promise<void>;
  /** Start the rebuild timer. */
  start(): void;
  stop(): void;
}

/** The pino-shaped subset this needs, so the service does not depend on fastify. */
export interface SearchLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface SearchIndexOptions {
  store: Store;
  skillsDir: string;
  /** Minutes between full rebuilds; 0 turns the timer off. */
  rebuildMinutes: number;
  log: SearchLog;
}

const toItem = ({ _id, ...rest }: DrillItemDoc) => ({ ...rest, drillItemId: _id });

export function createSearchIndex(options: SearchIndexOptions): SearchIndex {
  const { store, skillsDir, rebuildMinutes, log } = options;
  const c = store.collections;

  let engine = new SearchEngine();
  let guides: SearchDocument[] | null = null;
  let timer: NodeJS.Timeout | null = null;
  let building: Promise<void> | null = null;
  /** What changed while a rebuild was reading — re-applied to the new index once it is swapped in. */
  let pending: { blocks: Set<string>; skills: boolean } | null = null;

  /** Read once: the guide files only change with the image. */
  const guideDocs = (): SearchDocument[] => {
    if (guides) return guides;
    guides = [];
    if (!existsSync(skillsDir)) {
      log.warn({ skillsDir }, 'search: no skills directory, so no guides are indexed');
      return guides;
    }
    for (const skillId of readdirSync(skillsDir)) {
      const directory = join(skillsDir, skillId, 'guides');
      if (!existsSync(directory)) continue;
      for (const file of readdirSync(directory).filter((name) => name.endsWith('.md'))) {
        const guide = parseGuideSource(skillId, file.replace(/\.md$/, ''), readFileSync(join(directory, file), 'utf8'));
        if (guide) guides.push(...guideDocuments(guide));
      }
    }
    return guides;
  };

  const skillTitles = async (): Promise<Map<string, string>> => {
    const packs = await c.packs.find({}, { projection: { _id: 1, title: 1, contentLanguage: 1 } }).toArray();
    // A title stored before ADR-0026 may still be `{ nl, en }`; it is read as one string here too.
    return new Map(packs.map((pack) => [pack._id, singleLanguageText(pack.title, pack.contentLanguage) ?? pack._id]));
  };

  const blockDocuments = async (blockId: string): Promise<SearchDocument[]> => {
    const block = await c.blocks.findOne({ _id: blockId }, { projection: { status: 1, learnerId: 1 } });
    if (block?.status !== 'published') return [];
    const items = await c.drillItems.find({ blockId, 'payload.kind': 'term' }).toArray();
    return items.map((doc) => cardDocument(toItem(doc), block.learnerId)).filter((doc) => doc !== null);
  };

  const applyBlock = async (blockId: string) => engine.replaceBlock(blockId, await blockDocuments(blockId));

  const rebuild = (): Promise<void> => {
    if (building) return building;
    building = (async () => {
      const started = Date.now();
      pending = { blocks: new Set(), skills: false };
      try {
        const next = new SearchEngine();
        next.setSkillTitles(await skillTitles());
        for (const document of guideDocs()) next.add(document);

        const blocks = await c.blocks.find({ status: 'published' }, { projection: { _id: 1, learnerId: 1 } }).toArray();
        const owners = new Map(blocks.map((block) => [block._id, block.learnerId]));
        const items = await c.drillItems
          .find({ blockId: { $in: [...owners.keys()] }, 'payload.kind': 'term' })
          .toArray();
        for (const doc of items) {
          const document = cardDocument(toItem(doc), owners.get(doc.blockId));
          if (document) next.add(document);
        }

        engine = next;
        const caught = pending;
        pending = null;
        for (const blockId of caught.blocks) await applyBlock(blockId);
        if (caught.skills) engine.setSkillTitles(await skillTitles());

        log.info({ documents: engine.size, ms: Date.now() - started }, 'search index built');
      } catch (error) {
        pending = null;
        log.error({ err: error }, 'search index rebuild failed; the previous index is kept');
      } finally {
        building = null;
      }
    })();
    return building;
  };

  return {
    query: (learnerId, text, queryOptions) => engine.query(learnerId, text, queryOptions),
    rebuild,

    async blockChanged(blockId) {
      pending?.blocks.add(blockId);
      try {
        await applyBlock(blockId);
      } catch (error) {
        log.error({ err: error, blockId }, 'search: could not refresh a block; the next rebuild will');
      }
    },

    async skillsChanged() {
      if (pending) pending.skills = true;
      try {
        engine.setSkillTitles(await skillTitles());
      } catch (error) {
        log.error({ err: error }, 'search: could not refresh skill titles; the next rebuild will');
      }
    },

    start() {
      if (timer || rebuildMinutes <= 0) return;
      timer = setInterval(() => void rebuild(), rebuildMinutes * 60_000);
      // The timer alone never keeps the process alive — shutdown is not something to wait on it for.
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
