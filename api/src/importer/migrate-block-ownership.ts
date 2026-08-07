/**
 * `npm run migrate:block-ownership -- --pack <packId> --learner <learnerId> [--dry-run]`
 *
 * Give a pack's existing blocks an owner (ADR-0015).
 *
 * Blocks used to be keyed `(packId, order)`, so every learner in a pack shared them and the pack was
 * in practice about whoever its first learner was. This hands those blocks to that learner, which is
 * what they always were, so the pack can go back to being only the methodology.
 *
 * This is a **migration tool, not part of the loop.** It writes to MongoDB directly because there is
 * no API for changing who a published block belongs to, and there should not be one — republishing
 * under a `learnerId` is how a block gets an owner from here on.
 *
 * Three properties make it safe to run, and to re-run:
 *
 *  - **It changes no identifier.** Lesson, drill-item, submission, review and drill-state ids all
 *    hang off a block id; re-deriving one to namespace the owner in would orphan every streak
 *    attached to it. Ownership is a field. `publishBlock` reuses a stored `_id` for the same reason,
 *    so these blocks keep their unnamespaced ids permanently.
 *  - **It sets `origin` wherever it sets `learnerId`.** On a drill item those answer two different
 *    questions — who sees it, and whether a republish may sweep it away. Stamping an owner without
 *    stating the origin would make published vocabulary look like a word the learner added, which
 *    would exempt it from the sweep and offer them a delete button on their own curriculum.
 *  - **It skips what a learner added themselves.** Those already carry `origin: 'learner'`, or
 *    carry a `learnerId` and no origin, which means the same thing.
 *
 * Idempotent: every write is a `$set` to the value it should already hold.
 */

import { loadConfig } from '../config.js';
import { connect } from '../db/client.js';

interface Args {
  packId: string;
  learnerId: string;
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

  const { pack, learner } = args;
  if (typeof pack !== 'string' || typeof learner !== 'string') {
    throw new Error('usage: migrate:block-ownership --pack <packId> --learner <learnerId> [--dry-run]');
  }
  return { packId: pack, learnerId: learner, dryRun: args['dry-run'] === true };
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
    if (!pack) throw new Error(`pack ${args.packId} is not published`);

    const learner = await store.collections.learners.findOne({ _id: args.learnerId });
    if (!learner) {
      // A learner record is created lazily from the token's `sub` on their first request, so an id
      // that does not exist yet usually means they have never signed in — and guessing one would
      // hand a pack's blocks to nobody.
      throw new Error(
        `learner ${args.learnerId} does not exist — they are created on first sign-in, so have them log in once first`,
      );
    }

    // Only blocks nobody owns yet. Re-running finds none, which is what makes this idempotent.
    const blocks = await store.collections.blocks
      .find({ packId: args.packId, learnerId: { $exists: false } })
      .sort({ order: 1 })
      .toArray();

    if (blocks.length === 0) {
      log(`no unowned blocks in ${args.packId} — nothing to do.`);
      return;
    }

    const blockIds = blocks.map((block) => block._id);

    // Everything a publish produced under those blocks. A learner's own words are excluded by the
    // same rule the publish sweep uses, from the other side.
    const packItems = await store.collections.drillItems.countDocuments({
      blockId: { $in: blockIds },
      $or: [{ origin: 'pack' }, { origin: { $exists: false }, learnerId: { $exists: false } }],
    });
    const ownWords = await store.collections.drillItems.countDocuments({
      blockId: { $in: blockIds },
      $or: [{ origin: 'learner' }, { origin: { $exists: false }, learnerId: { $exists: true } }],
    });

    log(`pack     ${args.packId}`);
    log(`learner  ${args.learnerId}${learner.displayName ? ` (${learner.displayName})` : ''}`);
    log(`blocks   ${blocks.length}`);
    for (const block of blocks) log(`  b${block.order}  ${block.slug}  →  ${block._id}  (id unchanged)`);
    log(`drill items  ${packItems} published, ${ownWords} added by a learner and left alone`);

    if (args.dryRun) {
      log('\n--dry-run: nothing was written.');
      return;
    }

    const blockResult = await store.collections.blocks.updateMany(
      { _id: { $in: blockIds } },
      { $set: { learnerId: args.learnerId } },
    );

    const drillResult = await store.collections.drillItems.updateMany(
      {
        blockId: { $in: blockIds },
        $or: [{ origin: 'pack' }, { origin: { $exists: false }, learnerId: { $exists: false } }],
      },
      { $set: { learnerId: args.learnerId, origin: 'pack' } },
    );

    log(
      `\nwrote ${blockResult.modifiedCount} blocks and ${drillResult.modifiedCount} drill items to ${config.mongoDb}.`,
    );
    log('No identifier changed, so every streak, submission and review is still attached.');
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
