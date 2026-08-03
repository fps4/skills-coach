/**
 * `npm run validate:manifests [-- <packs-dir>]`
 *
 * Parses every pack manifest in the tree and reports what it found. A manifest is committed
 * (ADR-0008) precisely so a change to it is reviewable, and this is what makes the review honest:
 * a manifest that stops parsing, or that quietly contradicts itself, fails the DoD.
 *
 * Deliberately not `import:pack --dry-run`: `loadPack` requires a block directory, and a committed
 * pack ships without one — its blocks live outside the tree. `loadManifest` is the block-free entry
 * point and this reuses it verbatim, so the check and the importer cannot disagree about what a
 * valid manifest is.
 *
 * The lint rules below sit *above* the schema. Each one encodes a way a manifest can be structurally
 * valid and still wrong at runtime — silently, which is the only reason it is worth a check here.
 */

import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';

import type { PackManifestInput } from '../domain/schemas.js';
import { loadManifest } from './pack-source.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The repository's `packs/`, whatever the caller's working directory is. */
const DEFAULT_PACKS_DIR = resolve(HERE, '../../../packs');

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
function lint(manifest: PackManifestInput): string[] {
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

  return problems;
}

async function main(): Promise<void> {
  const packsDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PACKS_DIR;

  if (!(await isDirectory(packsDir))) {
    throw new Error(`no packs directory at ${packsDir}`);
  }

  const entries = (await readdir(packsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());

  let checked = 0;
  let failed = 0;

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const manifestPath = join(packsDir, entry.name, 'pack.yaml');
    try {
      await stat(manifestPath);
    } catch {
      // A directory holding only blocks is normal — its manifest is kept elsewhere.
      continue;
    }

    checked += 1;

    try {
      const manifest = await loadManifest(manifestPath);
      const problems = lint(manifest);
      const ramp = manifest.framework.ramp?.length ?? 0;

      log(
        `${problems.length === 0 ? '✓' : '✗'} ${entry.name}/pack.yaml — ${manifest.packId} ` +
          `(${manifest.contentLanguage} → ${manifest.translationLanguage}), ` +
          `${manifest.framework.levels.length} levels, ${ramp} ramp step${ramp === 1 ? '' : 's'}, ` +
          `${manifest.errorCategories.length} error categories`,
      );

      for (const problem of problems) log(`    · ${problem}`);
      if (problems.length > 0) failed += 1;
    } catch (error) {
      failed += 1;
      log(`✗ ${entry.name}/pack.yaml`);
      if (error instanceof ZodError) {
        for (const issue of error.issues) {
          log(`    · ${issue.path.join('.') || '(root)'}: ${issue.message}`);
        }
      } else {
        log(`    · ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (checked === 0) throw new Error(`no pack manifests under ${packsDir}`);

  log(`\n${checked} manifest${checked === 1 ? '' : 's'} checked, ${failed} with problems.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
