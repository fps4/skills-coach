/**
 * `npm run import:errorlog -- --source <file.md> --learner <id> --pack <packId> [--dry-run]`
 *
 * A one-time backfill for a learner's accumulated error log from the markdown table the source
 * program maintained by hand.
 *
 * This is a **migration tool, not part of the loop.** It writes to MongoDB directly, because there
 * is deliberately no API for setting counters — the runtime derives those from corrections
 * (ADR-0001). It still runs the numbers through the same domain rules, so a backfilled entry is
 * indistinguishable from one earned through the loop.
 *
 * It refuses to write a category the pack does not declare. Categories are the join key for the
 * whole adaptation loop, and a row filed under an undeclared id would accumulate quietly while new
 * corrections piled up under the real one — two half-histories of the same mistake.
 *
 * Once a learner's history is in, use the coach API. Running this again would double their counts.
 */

import { readFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { connect } from '../db/client.js';
import { errorLogIdFor } from '../services/context.js';
import { mapToDeclared, parseErrorLog, toEntries } from './error-log-source.js';

interface Args {
  source: string;
  learnerId: string;
  packId: string;
  dryRun: boolean;
  /** `--map "raw heading=declared-id"`, repeatable, for headings the matcher cannot resolve. */
  map: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};
  const map: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const value = next && !next.startsWith('--') ? next : undefined;

    if (key === 'map' && value) {
      const [from, to] = value.split('=');
      if (from && to) map[from.trim()] = to.trim();
      i += 1;
      continue;
    }
    if (value !== undefined) {
      args[key] = value;
      i += 1;
    } else args[key] = true;
  }

  const { source, learner, pack } = args;
  if (typeof source !== 'string' || typeof learner !== 'string' || typeof pack !== 'string') {
    throw new Error(
      'usage: import:errorlog --source <file.md> --learner <learnerId> --pack <packId> [--map "raw=declared-id"] [--dry-run]',
    );
  }
  return { source, learnerId: learner, packId: pack, dryRun: args['dry-run'] === true, map };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const parsed = parseErrorLog(await readFile(args.source, 'utf8'), new Date());
  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  if (parsed.length === 0) {
    log('no error-log rows found — is the source the markdown table?');
    return;
  }

  const config = loadConfig();
  // Credentials go alongside the URI, exactly as `index.ts` connects. Omitting them works against a
  // laptop's unauthenticated MongoDB and fails against every deployed one with "Command find
  // requires authentication" — which is precisely where a migration tool is needed.
  const store = await connect(config.mongoUri, config.mongoDb, config.mongoCredentials);

  try {
    const pack = await store.collections.packs.findOne({ _id: args.packId });
    if (!pack) throw new Error(`pack ${args.packId} is not published — import the pack first`);
    const declared = pack.errorCategories.map((category) => category.id);

    // Apply explicit mappings first, then the matcher.
    const withOverrides = parsed.map((row) => ({ ...row, category: args.map[row.category] ?? row.category }));
    const { rows, unresolved } = mapToDeclared(withOverrides, declared);

    if (unresolved.length > 0) {
      log(`${unresolved.length} heading(s) match no category this pack declares:\n`);
      for (const entry of unresolved) log(`  "${entry.raw}"  (×${entry.count})`);
      log(`\nthe pack declares:\n  ${declared.join('\n  ')}`);
      log('\nResolve each with --map "raw heading=declared-id", or add the category to the pack manifest.');
      log('Refusing to write — a category the pack does not declare would never join anything.');
      process.exitCode = 1;
      return;
    }

    const entries = toEntries(rows, args.learnerId, args.packId);

    log(`${entries.length} categories for learner ${args.learnerId} in pack ${args.packId}:`);
    for (const [index, entry] of entries.entries()) {
      const raw = withOverrides[index]?.category;
      const renamed = raw && raw !== entry.category ? `  ← "${raw}"` : '';
      log(`  ${entry.category.padEnd(24)} ×${String(entry.count).padStart(3)}  ${entry.status.padEnd(10)}${renamed}`);
    }

    if (args.dryRun) {
      log('\n--dry-run: nothing was written.');
      return;
    }

    for (const entry of entries) {
      const id = errorLogIdFor(entry.learnerId, entry.packId, entry.category);
      await store.collections.errorLog.replaceOne({ _id: id }, entry, { upsert: true });
    }
    log(`\nwrote ${entries.length} entries to ${config.mongoDb}.`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
