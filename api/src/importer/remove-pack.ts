/**
 * `npm run remove:pack -- --pack <packId> [--dry-run]`
 *
 * Delete a pack and everything published under it.
 *
 * There is deliberately no API for this — `archive_block` takes a block out of circulation *without*
 * deleting what learners did in it, which is the right behaviour for anything anyone has worked. A
 * pack that nobody has worked is the one case where deletion is honest rather than destructive, and
 * it exists because of ADR-0015: a manifest forked to give a second learner their own domain, before
 * a block could carry an owner, has no reason to stay once the fork is folded back.
 *
 * **It refuses if anyone has worked the pack.** A submission, a correction, an error-log entry or a
 * drill streak all mean this is somebody's history, and history is archived, never deleted. That
 * check is the whole safety story, so it runs before anything is removed and names what it found.
 */

import { loadConfig } from '../config.js';
import { connect, type Store } from '../db/client.js';

interface Args {
  packId: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else args[key] = true;
  }

  const { pack } = args;
  if (typeof pack !== 'string') throw new Error('usage: remove:pack --pack <packId> [--dry-run]');
  return { packId: pack, dryRun: args['dry-run'] === true };
}

/** Everything that would make deleting this pack a loss of somebody's history. */
async function learnerWork(store: Store, packId: string): Promise<Record<string, number>> {
  const blockIds = await store.collections.blocks.distinct('_id', { packId });

  const [submissions, errorLog, drillState, enrollments, reviews, ownWords] = await Promise.all([
    store.collections.submissions.countDocuments({ packId }),
    store.collections.errorLog.countDocuments({ packId }),
    store.collections.drillState.countDocuments({ packId }),
    store.collections.enrollments.countDocuments({ packId }),
    store.collections.blockReviews.countDocuments({ blockId: { $in: blockIds } }),
    store.collections.drillItems.countDocuments({
      packId,
      $or: [{ origin: 'learner' }, { origin: { $exists: false }, learnerId: { $exists: true } }],
    }),
  ]);

  return { submissions, errorLog, drillState, enrollments, reviews, ownWords };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  const config = loadConfig();
  const store = await connect(config.mongoUri, config.mongoDb);

  try {
    const pack = await store.collections.packs.findOne({ _id: args.packId });
    if (!pack) {
      log(`pack ${args.packId} is not published — nothing to remove.`);
      return;
    }

    const work = await learnerWork(store, args.packId);
    const found = Object.entries(work).filter(([, count]) => count > 0);

    if (found.length > 0) {
      log(`${args.packId} has learner work in it:\n`);
      for (const [what, count] of found) log(`  ${what.padEnd(14)} ${count}`);
      log('\nRefusing to remove. History is archived, never deleted — use archive_block instead.');
      process.exitCode = 1;
      return;
    }

    const [blocks, lessons, drillItems] = await Promise.all([
      store.collections.blocks.countDocuments({ packId: args.packId }),
      store.collections.lessons.countDocuments({ packId: args.packId }),
      store.collections.drillItems.countDocuments({ packId: args.packId }),
    ]);

    log(`pack     ${args.packId}`);
    log(`blocks   ${blocks}`);
    log(`lessons  ${lessons}`);
    log(`drills   ${drillItems}`);
    log('no learner has worked this pack ✓');

    if (args.dryRun) {
      log('\n--dry-run: nothing was written.');
      return;
    }

    await store.collections.drillItems.deleteMany({ packId: args.packId });
    await store.collections.lessons.deleteMany({ packId: args.packId });
    await store.collections.blocks.deleteMany({ packId: args.packId });
    await store.collections.packs.deleteOne({ _id: args.packId });

    log(`\nremoved ${args.packId} from ${config.mongoDb}.`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
