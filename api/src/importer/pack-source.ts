/**
 * Reading a pack from a directory on disk.
 *
 * The layout is the one authors already use — a manifest, then one directory per block holding
 * numbered lesson files and optional drill CSVs:
 *
 *   pack.yaml
 *   blocks/            (or blokken/)
 *     01-slug/         (or blok-01-slug/)
 *       README.md      optional — block title and metadata
 *       les-1.md       or lesson-1.md
 *       woordenschat.csv    optional — term drills
 *       zinsvolgorde.csv    optional — word-order drills
 *
 * Everything language-specific is either configuration (`sectionMap`, `csv` aliases in the
 * manifest) or an accepted alias, so this reads an English pack as readily as a Dutch one.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  packManifestSchema,
  publishBlockSchema,
  type PackManifestInput,
  type PublishBlockInput,
} from '../domain/schemas.js';
import type { SectionMapEntry } from '../domain/types.js';
import { column, parseCsv, splitParts } from './csv.js';
import { DEFAULT_SECTION_MAP, parseBlockReadme, parseLesson } from './markdown.js';

const BLOCK_DIRECTORIES = ['blocks', 'blokken'];
const BLOCK_DIRECTORY_PATTERN = /^(?:blok|block)?-?(\d+)[-_](.+)$/i;
const LESSON_FILE_PATTERN = /^(?:les|lesson)[-_]?(\d+)\.md$/i;

const TERM_CSV = ['woordenschat.csv', 'vocabulary.csv', 'terms.csv'];
const WORD_ORDER_CSV = ['zinsvolgorde.csv', 'word-order.csv', 'sentences.csv'];

/** Column aliases, overridable per pack via a `csv:` block in the manifest. */
export interface CsvAliases {
  term: string[];
  translation: string[];
  example: string[];
  lesson: string[];
  sentence: string[];
  parts: string[];
  tip: string[];
  partsAlt: string[];
}

export const DEFAULT_CSV_ALIASES: CsvAliases = {
  term: ['Nederlands', 'Term', 'Woord', 'Word'],
  translation: ['English', 'Vertaling', 'Translation'],
  example: ['Voorbeeld', 'Example'],
  lesson: ['Les', 'Lesson'],
  sentence: ['Zin', 'Sentence'],
  parts: ['Delen', 'Parts'],
  tip: ['Tip', 'Hint'],
  partsAlt: ['DelenB', 'PartsB', 'PartsAlt'],
};

export interface LoadedPack {
  manifest: PackManifestInput;
  blocks: PublishBlockInput[];
  warnings: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findFirst(directory: string, names: string[]): Promise<string | null> {
  const entries = await readdir(directory);
  const lowered = new Map(entries.map((entry) => [entry.toLocaleLowerCase(), entry]));
  for (const name of names) {
    const match = lowered.get(name.toLocaleLowerCase());
    if (match) return join(directory, match);
  }
  return null;
}

export async function loadManifest(path: string): Promise<PackManifestInput> {
  const raw = parseYaml(await readFile(path, 'utf8')) as unknown;
  return packManifestSchema.parse(raw);
}

/** Term drills from a vocabulary CSV. Terms already carried by a lesson's vocabulary section are
 *  not duplicated here — the publish step derives those, and drill ids are content-derived, so a
 *  term appearing in both places collapses to one item anyway. */
function readTermCsv(text: string, aliases: CsvAliases): PublishBlockInput['drillItems'] {
  const { rows } = parseCsv(text);
  const items: PublishBlockInput['drillItems'] = [];

  for (const row of rows) {
    const term = column(row, aliases.term);
    const translation = column(row, aliases.translation);
    if (!term || !translation) continue;

    const lesson = column(row, aliases.lesson);
    items.push({
      lessonOrder: lesson ? Number(lesson) || undefined : undefined,
      payload: { kind: 'term', term, translation, example: column(row, aliases.example) },
    });
  }
  return items;
}

function readWordOrderCsv(text: string, aliases: CsvAliases, warnings: string[]): PublishBlockInput['drillItems'] {
  const { rows } = parseCsv(text);
  const items: PublishBlockInput['drillItems'] = [];

  for (const [index, row] of rows.entries()) {
    const sentence = column(row, aliases.sentence);
    const partsRaw = column(row, aliases.parts);
    const translation = column(row, aliases.translation);
    if (!sentence || !partsRaw || !translation) continue;

    const parts = splitParts(partsRaw);
    if (parts.length < 2) {
      warnings.push(`word-order row ${index + 2}: "${sentence}" has fewer than two chunks — skipped`);
      continue;
    }

    const altRaw = column(row, aliases.partsAlt);
    const partsAlt = altRaw ? splitParts(altRaw) : undefined;
    const lesson = column(row, aliases.lesson);

    items.push({
      lessonOrder: lesson ? Number(lesson) || undefined : undefined,
      payload: {
        kind: 'word-order',
        sentence,
        parts,
        translation,
        tip: column(row, aliases.tip),
        // Kept even when it is not a permutation: the runtime ignores an unusable alternative and
        // reports how many it ignored, which is how an authoring typo becomes visible.
        partsAlt: partsAlt && partsAlt.length >= 2 ? partsAlt : undefined,
      },
    });
  }
  return items;
}

async function loadBlock(
  directory: string,
  order: number,
  slug: string,
  sectionMap: SectionMapEntry[],
  aliases: CsvAliases,
  warnings: string[],
): Promise<PublishBlockInput> {
  const entries = await readdir(directory);

  const lessonFiles = entries
    .map((name) => ({ name, match: name.match(LESSON_FILE_PATTERN) }))
    .filter((entry): entry is { name: string; match: RegExpMatchArray } => entry.match !== null)
    .map((entry) => ({ name: entry.name, order: Number(entry.match[1]) }))
    .sort((a, b) => a.order - b.order);

  if (lessonFiles.length === 0) {
    throw new Error(`block ${slug}: no lesson files (expected les-1.md or lesson-1.md) in ${directory}`);
  }

  const lessons: PublishBlockInput['lessons'] = [];
  for (const file of lessonFiles) {
    const parsed = parseLesson(await readFile(join(directory, file.name), 'utf8'), sectionMap);
    for (const warning of parsed.warnings) warnings.push(`${slug}/${file.name}: ${warning}`);
    if (parsed.sections.length === 0) {
      warnings.push(`${slug}/${file.name}: no sections parsed — skipped`);
      continue;
    }
    lessons.push({
      order: file.order,
      title: parsed.title,
      level: parsed.level,
      estimatedMinutes: parsed.estimatedMinutes,
      focus: parsed.focus,
      sections: parsed.sections,
    });
  }

  const readmePath = await findFirst(directory, ['README.md', 'readme.md', 'block.md']);
  const readme = readmePath ? parseBlockReadme(await readFile(readmePath, 'utf8')) : { title: '' };

  const drillItems: PublishBlockInput['drillItems'] = [];
  const termCsv = await findFirst(directory, TERM_CSV);
  if (termCsv) drillItems.push(...readTermCsv(await readFile(termCsv, 'utf8'), aliases));
  const wordOrderCsv = await findFirst(directory, WORD_ORDER_CSV);
  if (wordOrderCsv) drillItems.push(...readWordOrderCsv(await readFile(wordOrderCsv, 'utf8'), aliases, warnings));

  return publishBlockSchema.parse({
    order,
    slug,
    title: readme.title || slug,
    level: readme.level ?? lessons[0]?.level,
    theme: readme.theme,
    milestone: readme.milestone,
    status: 'published',
    lessons,
    drillItems,
  });
}

export interface LoadOptions {
  /** Content root — the directory holding `blocks/` (or `blokken/`). */
  source: string;
  /** Manifest path. Defaults to `<source>/pack.yaml`. */
  manifest?: string;
  /** Import only this block order. */
  only?: number;
}

export async function loadPack(options: LoadOptions): Promise<LoadedPack> {
  const manifestPath = options.manifest ?? join(options.source, 'pack.yaml');
  if (!(await exists(manifestPath))) {
    throw new Error(
      `no manifest at ${manifestPath}. Pass --manifest <path> when the content directory does not hold one ` +
        `(a directory of lessons authored elsewhere will not).`,
    );
  }

  const manifest = await loadManifest(manifestPath);
  const sectionMap = manifest.sectionMap?.length ? manifest.sectionMap : DEFAULT_SECTION_MAP;
  const aliases = DEFAULT_CSV_ALIASES;
  const warnings: string[] = [];

  let blocksRoot: string | null = null;
  for (const name of BLOCK_DIRECTORIES) {
    const candidate = join(options.source, name);
    if (await exists(candidate)) {
      blocksRoot = candidate;
      break;
    }
  }
  if (!blocksRoot) {
    throw new Error(`no block directory in ${options.source} (expected one of: ${BLOCK_DIRECTORIES.join(', ')})`);
  }

  const directories = (await readdir(blocksRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, match: entry.name.match(BLOCK_DIRECTORY_PATTERN) }))
    .filter((entry): entry is { name: string; match: RegExpMatchArray } => entry.match !== null)
    .map((entry) => ({
      name: entry.name,
      order: Number(entry.match[1]),
      slug: (entry.match[2] as string).toLocaleLowerCase(),
    }))
    .sort((a, b) => a.order - b.order);

  if (directories.length === 0) {
    throw new Error(`no block directories in ${blocksRoot} (expected e.g. 01-introductions or blok-01-voorstellen)`);
  }

  const blocks: PublishBlockInput[] = [];
  for (const entry of directories) {
    if (options.only !== undefined && entry.order !== options.only) continue;
    blocks.push(await loadBlock(join(blocksRoot, entry.name), entry.order, entry.slug, sectionMap, aliases, warnings));
  }

  return { manifest, blocks, warnings };
}
