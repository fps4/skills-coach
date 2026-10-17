/**
 * `npm run retopic:cards -- --pack <packId> [--dry-run]`
 *
 * Move a deck's cards from the section labels they were published with onto the topic ids the
 * skill's manifest now declares (ADR-0032, `services/retopic.ts`). Publish the manifest first: the
 * declared topics are read from the live pack, not from the file.
 *
 * Prints every label it would move and every label it cannot place; `--dry-run` stops there. It is
 * safe to run twice — a card already on an id is left alone.
 */

import { loadConfig } from '../config.js';
import { connect } from '../db/client.js';
import { createContext } from '../services/context.js';
import { retopicCards } from '../services/retopic.js';

function parseArgs(argv: string[]): { packId: string; dryRun: boolean } {
  const at = argv.indexOf('--pack');
  const packId = at >= 0 ? argv[at + 1] : undefined;
  if (!packId || packId.startsWith('--')) throw new Error('usage: retopic:cards --pack <packId> [--dry-run]');
  return { packId, dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  const config = loadConfig();
  const store = await connect(config.mongoUri, config.mongoDb, config.mongoCredentials);
  try {
    const report = await retopicCards(createContext(store, config), args.packId, { dryRun: args.dryRun });
    log(`${args.packId}`);
    for (const { from, to, cards } of report.moved) log(`  ${String(cards).padStart(4)}  ${from}  →  ${to}`);
    for (const { label, cards } of report.unmatched)
      log(`  ${String(cards).padStart(4)}  ${label}  (no declared topic — left as it is)`);
    if (report.moved.length === 0) log('  nothing to move');
    if (report.unmatched.length > 0) process.exitCode = 1;
    log(
      args.dryRun ? '\n--dry-run: nothing was written.' : `\nmoved ${report.moved.length} labels in ${config.mongoDb}.`,
    );
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
