/**
 * `npm run validate:manifests [-- <skills-dir>]`
 *
 * Parses every skill manifest in the tree (`skills/<id>/skill.yaml`, ADR-0029) and reports what it
 * found. A manifest is committed (ADR-0008) precisely so a change to it is reviewable, and this is
 * what makes the review honest: a manifest that stops parsing, or that quietly contradicts itself,
 * fails the DoD.
 *
 * Deliberately not `import:pack --dry-run`: `loadPack` requires a block directory, and a committed
 * pack ships without one — its blocks live outside the tree. `loadManifest` is the block-free entry
 * point and this reuses it verbatim, so the check and the importer cannot disagree about what a
 * valid manifest is.
 *
 * The lint rules below sit *above* the schema. Each one encodes a way a manifest can be structurally
 * valid and still wrong at runtime — silently, which is the only reason it is worth a check here.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';

import type { PackManifestInput } from '../domain/schemas.js';
import { MANIFEST_FILE, loadManifest } from './pack-source.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The repository's `skills/`, whatever the caller's working directory is. */
const DEFAULT_SKILLS_DIR = resolve(HERE, '../../../skills');

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Problems the schema cannot see.
 *
 * Every rule here is something `domain/` resolves silently at runtime: `rampStepFor` takes the first
 * matching step, so an overlap shadows rather than errors; `nextLevel` returns null for a level that
 * is not on the ladder, so the brief loses the rung it is climbing toward; a duplicated category id
 * merges two vocabularies into one counter.
 */
function lint(manifest: PackManifestInput, guides: ReadonlySet<string>): string[] {
  const problems: string[] = [];

  const ids = manifest.errorCategories.map((category) => category.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  for (const id of duplicates) problems.push(`error category "${id}" is declared more than once`);

  const ramp = manifest.framework.ramp ?? [];
  const levels = new Set(manifest.framework.levels);

  for (const step of ramp) {
    if (step.fromBlock > step.toBlock) {
      problems.push(`ramp step ${step.fromBlock}–${step.toBlock} ends before it starts`);
    }
    if (!levels.has(step.level)) {
      problems.push(
        `ramp step ${step.fromBlock}–${step.toBlock} names level "${step.level}", which framework.levels does not list`,
      );
    }
  }

  // Sorted by start, so a later step beginning before its predecessor ends is an overlap.
  const ordered = [...ramp].sort((a, b) => a.fromBlock - b.fromBlock);
  for (const [index, step] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (!previous) continue;
    if (step.fromBlock <= previous.toBlock) {
      problems.push(
        `ramp steps ${previous.fromBlock}–${previous.toBlock} and ${step.fromBlock}–${step.toBlock} overlap; ` +
          `the first one declared wins and the other is unreachable`,
      );
    } else if (step.fromBlock > previous.toBlock + 1) {
      problems.push(
        `ramp has a gap between blocks ${previous.toBlock + 1} and ${step.fromBlock - 1}; ` +
          `those blocks would carry no level and no dials`,
      );
    }
  }

  // A grading mode for cards the pack never shows (ADR-0027): the setting can only ever be read by a
  // surface the manifest has opted out of, which means it was written for a different manifest.
  const surfaces = manifest.presentation?.surfaces;
  if (manifest.flashcards && surfaces && !surfaces.includes('drills:terms')) {
    problems.push('flashcards declares a grading mode, but presentation.surfaces leaves out drills:terms');
  }

  // A topic's guides are links on its tile (ADR-0032). The api never sees the guide files, so a slug
  // that names no file would publish fine and render a link to a 404 — this is the only place to catch it.
  for (const topic of manifest.flashcards?.topics ?? []) {
    for (const slug of topic.guides ?? []) {
      if (!guides.has(slug)) problems.push(`topic "${topic.id}" names guide "${slug}", which is not in guides/`);
    }
  }

  return problems;
}

/**
 * Keys with no value in the raw YAML.
 *
 * The usual cause is a comma inside an unquoted flow mapping: `{ id: x, label: who decides, owns it }`
 * parses as `{ id: "x", label: "who decides", "owns it": null }`. The schema then strips the unknown
 * key, so the label publishes cut short and nothing complains. Checked on the raw document because by the time the
 * schema has parsed it, the evidence is gone.
 */
function emptyKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => emptyKeys(item, `${path}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    return child === null
      ? [`"${here}" has no value — a comma in an unquoted {…} value splits it; quote the value`]
      : emptyKeys(child, here);
  });
}

/** The slugs of a skill's guides (`guides/<slug>.md`, ADR-0029). None when it has no `guides/`. */
async function guideSlugs(skillDir: string): Promise<Set<string>> {
  const directory = join(skillDir, 'guides');
  if (!(await isDirectory(directory))) return new Set();
  const files = await readdir(directory);
  return new Set(files.filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)));
}

async function main(): Promise<void> {
  const skillsDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SKILLS_DIR;

  if (!(await isDirectory(skillsDir))) {
    throw new Error(`no skills directory at ${skillsDir}`);
  }

  const entries = (await readdir(skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());

  let checked = 0;
  let failed = 0;

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const manifestPath = join(skillsDir, entry.name, MANIFEST_FILE);
    try {
      await stat(manifestPath);
    } catch {
      // A directory holding only blocks is normal — its manifest is kept elsewhere.
      continue;
    }

    checked += 1;

    try {
      const manifest = await loadManifest(manifestPath);
      const problems = [
        ...emptyKeys(parseYaml(await readFile(manifestPath, 'utf8'))),
        ...lint(manifest, await guideSlugs(join(skillsDir, entry.name))),
      ];
      const ramp = manifest.framework.ramp?.length ?? 0;
      const topics = manifest.flashcards?.topics?.length ?? 0;

      log(
        `${problems.length === 0 ? '✓' : '✗'} ${entry.name}/${MANIFEST_FILE} — ${manifest.packId} ` +
          `(${manifest.contentLanguage} → ${manifest.translationLanguage}), ` +
          `${manifest.framework.levels.length} levels, ${ramp} ramp step${ramp === 1 ? '' : 's'}, ` +
          `${manifest.errorCategories.length} error categories` +
          (topics > 0 ? `, ${topics} topics` : ''),
      );

      for (const problem of problems) log(`    · ${problem}`);
      if (problems.length > 0) failed += 1;
    } catch (error) {
      failed += 1;
      log(`✗ ${entry.name}/${MANIFEST_FILE}`);
      if (error instanceof ZodError) {
        for (const issue of error.issues) {
          log(`    · ${issue.path.join('.') || '(root)'}: ${issue.message}`);
        }
      } else {
        log(`    · ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (checked === 0) throw new Error(`no skill manifests under ${skillsDir}`);

  log(`\n${checked} manifest${checked === 1 ? '' : 's'} checked, ${failed} with problems.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
