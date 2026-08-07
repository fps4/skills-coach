/**
 * MongoDB connection and index management.
 *
 * There is no migration runner (ADR-0003): indexes are declared here and applied at boot.
 * `createIndex` is idempotent, so booting twice is harmless and a new index ships with the code
 * that needs it.
 */

import { MongoClient, type Db } from 'mongodb';
import type { MongoCredentials } from '../config.js';
import { COLLECTIONS, collections, type Collections } from './collections.js';

export interface Store {
  client: MongoClient;
  db: Db;
  collections: Collections;
  close(): Promise<void>;
}

export async function connect(uri: string, dbName: string, credentials?: MongoCredentials): Promise<Store> {
  const client = new MongoClient(uri, {
    // Fail fast on a wrong URI rather than hanging a request for the default 30 seconds.
    serverSelectionTimeoutMS: 5_000,
    // Credentials go through the driver rather than into the URI, so nothing has to be
    // percent-encoded and a password containing `@` or `#` cannot corrupt the connection string.
    ...(credentials
      ? { auth: { username: credentials.username, password: credentials.password }, authSource: credentials.authSource }
      : {}),
  });
  await client.connect();
  const db = client.db(dbName);
  return {
    client,
    db,
    collections: collections(db),
    close: () => client.close(),
  };
}

/**
 * Apply every index. Uniqueness here is doing real work: it is what makes republishing a block
 * idempotent, and what stops a learner accumulating duplicate drill state under a race.
 */
export async function ensureIndexes(db: Db, auditRetentionDays: number): Promise<void> {
  const c = collections(db);

  // A block's position is (pack, owner, order): a pack-wide block 1 and one learner's block 1 are
  // different blocks, and two learners' block 1s are too (ADR-0015). A missing `learnerId` indexes
  // as null, which is what lets the pack-wide and owned forms coexist under one unique key.
  //
  // Superseded `block_order_unique` on (packId, order). A key change cannot reuse a name, so the new
  // index goes up under a new one and the old is dropped — the only place this codebase does
  // anything a migration runner would, and it stays idempotent.
  await c.blocks.createIndex({ packId: 1, learnerId: 1, order: 1 }, { unique: true, name: 'block_position_unique' });
  await dropIfExists(c.blocks, 'block_order_unique');
  await c.blocks.createIndex({ packId: 1, status: 1 }, { name: 'block_by_status' });

  await c.lessons.createIndex({ blockId: 1, order: 1 }, { unique: true, name: 'lesson_order_unique' });
  await c.lessons.createIndex({ packId: 1 }, { name: 'lesson_by_pack' });

  await c.drillItems.createIndex({ blockId: 1, lessonOrder: 1 }, { name: 'drill_by_block_lesson' });
  await c.drillItems.createIndex({ packId: 1 }, { name: 'drill_by_pack' });
  // Sparse: an owner is carried by a learner's own words and by the content of a block written for
  // them, and pack-wide items still far outnumber both.
  await c.drillItems.createIndex({ learnerId: 1, blockId: 1 }, { sparse: true, name: 'drill_by_owner' });

  // The token's `sub` is the only identity we keep, so it must map to exactly one learner.
  await c.learners.createIndex({ subject: 1 }, { unique: true, name: 'learner_subject_unique' });

  await c.enrollments.createIndex({ learnerId: 1, packId: 1 }, { unique: true, name: 'enrollment_unique' });

  await c.drillState.createIndex({ learnerId: 1, drillItemId: 1 }, { unique: true, name: 'drill_state_unique' });
  await c.drillState.createIndex({ learnerId: 1, blockId: 1 }, { name: 'drill_state_by_block' });

  await c.attempts.createIndex({ learnerId: 1, at: -1 }, { name: 'attempt_by_learner' });
  await c.attempts.createIndex({ drillItemId: 1, at: -1 }, { name: 'attempt_by_item' });

  // The coach's work queue: pending submissions, oldest first.
  await c.submissions.createIndex({ status: 1, createdAt: 1 }, { name: 'submission_queue' });
  await c.submissions.createIndex({ learnerId: 1, lessonId: 1 }, { name: 'submission_by_lesson' });
  await c.submissions.createIndex({ learnerId: 1, blockId: 1 }, { name: 'submission_by_block' });

  await c.corrections.createIndex({ submissionId: 1 }, { unique: true, name: 'correction_unique' });

  await c.errorLog.createIndex({ learnerId: 1, packId: 1, category: 1 }, { unique: true, name: 'error_log_unique' });

  await c.blockReviews.createIndex({ blockId: 1, learnerId: 1 }, { unique: true, name: 'block_review_unique' });

  // A learner's sittings, newest first — what the results screen and the brief both read.
  await c.quizSessions.createIndex({ learnerId: 1, startedAt: -1 }, { name: 'quiz_by_learner' });
  await c.quizSessions.createIndex({ learnerId: 1, blockId: 1, startedAt: -1 }, { name: 'quiz_by_block' });

  // Retention rather than pruning logic — the whole point of the TTL index.
  await c.auditEvents.createIndex(
    { at: 1 },
    { name: 'audit_ttl', expireAfterSeconds: auditRetentionDays * 24 * 60 * 60 },
  );
  await c.auditEvents.createIndex({ 'actor.subject': 1, at: -1 }, { name: 'audit_by_actor' });
}

/**
 * Drop an index that a later version replaced, tolerating its absence.
 *
 * Booting a fresh database has nothing to drop, and booting an upgraded one drops it once — either
 * way this is safe to run on every start, which is what keeps `ensureIndexes` the whole of the
 * migration story.
 */
async function dropIfExists(
  collection: { indexExists(name: string): Promise<boolean>; dropIndex(name: string): Promise<unknown> },
  name: string,
): Promise<void> {
  if (await collection.indexExists(name).catch(() => false)) {
    await collection.dropIndex(name).catch(() => undefined);
  }
}

/** Drop everything. Test support only — never called by the application. */
export async function dropAll(db: Db): Promise<void> {
  for (const name of Object.values(COLLECTIONS)) {
    await db.collection(name).deleteMany({});
  }
}
