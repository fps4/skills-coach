/**
 * `npm run migrate:to-skills -- --from <packId> --words <packId> --reading <packId> [--apply]`
 *
 * Copy every learner's words, word progress, attempts and reading library out of a programme pack
 * into a word skill and a reading skill of their own, enrol them in both, and file both in one menu
 * folder (ADR-0022). See `services/skill-migration.ts` for exactly what moves.
 *
 * **Dry unless `--apply` is given**, the opposite of the other importers' `--dry-run`: this touches
 * every learner at once, so the version that only reports is the one a slip of the keyboard gets.
 * It copies and never deletes, and running it twice changes nothing the first run did not.
 *
 * Talks to MongoDB directly, like `remove-pack`: it is run inside the api container, whose own
 * environment already holds the connection, so no credential ever has to be typed or printed.
 */

import { loadConfig } from '../config.js';
import { connect } from '../db/client.js';
import { createContext } from '../services/context.js';
import { migrateToSkills } from '../services/skill-migration.js';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[arg.slice(2)] = next;
      i += 1;
    } else args[arg.slice(2)] = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { from, words, reading } = args;
  if (typeof from !== 'string' || typeof words !== 'string' || typeof reading !== 'string') {
    throw new Error(
      'usage: migrate:to-skills --from <packId> --words <packId> --reading <packId> [--folder-nl Nederlands] [--folder-en Dutch] [--apply]',
    );
  }
  const dryRun = args.apply !== true;
  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  const config = loadConfig();
  const store = await connect(config.mongoUri, config.mongoDb, config.mongoCredentials);
  try {
    const report = await migrateToSkills(createContext(store, config), {
      from,
      words,
      reading,
      folder: {
        nl: typeof args['folder-nl'] === 'string' ? args['folder-nl'] : 'Nederlands',
        en: typeof args['folder-en'] === 'string' ? args['folder-en'] : 'Dutch',
      },
      dryRun,
    });

    const created = report.deckCreated ? (dryRun ? ' (would be created)' : ' (created)') : '';
    log(`deck      ${report.deckBlockId}${created}`);
    log(`learners  ${report.learners.length}\n`);
    for (const entry of report.learners) {
      log(
        `  ${entry.learnerId}  words ${entry.words} (with progress ${entry.wordsWithProgress}, attempts ${entry.attempts})` +
          `  articles ${entry.articles} (read ${entry.read})`,
      );
    }
    log(dryRun ? '\ndry run: nothing was written. Re-run with --apply.' : `\ncopied into ${words} and ${reading}.`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
