/**
 * MongoDB connection and index management.
 *
 * There is no migration runner (ADR-0003): indexes are declared here and applied at boot.
 * `createIndex` is idempotent, so booting twice is harmless and a new index ships with the code
 * that needs it.
 */

import { MongoClient, type Db } from 'mongodb';
import { COLLECTIONS, collections, type Collections } from './collections.js';

export interface Store {
  client: MongoClient;
  db: Db;
  collections: Collections;
  close(): Promise<void>;
}

export async function connect(uri: string, dbName: string): Promise<Store> {
  const client = new MongoClient(uri, {
    // Fail fast on a wrong URI rather than hanging a request for the default 30 seconds.
    serverSelectionTimeoutMS: 5_000,
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

  await c.blocks.createIndex({ packId: 1, order: 1 }, { unique: true, name: 'block_order_unique' });
  await c.blocks.createIndex({ packId: 1, status: 1 }, { name: 'block_by_status' });

  await c.lessons.createIndex({ blockId: 1, order: 1 }, { unique: true, name: 'lesson_order_unique' });
  await c.lessons.createIndex({ packId: 1 }, { name: 'lesson_by_pack' });

  await c.drillItems.createIndex({ blockId: 1, lessonOrder: 1 }, { name: 'drill_by_block_lesson' });
  await c.drillItems.createIndex({ packId: 1 }, { name: 'drill_by_pack' });

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

  // Retention rather than pruning logic — the whole point of the TTL index.
  await c.auditEvents.createIndex(
    { at: 1 },
    { name: 'audit_ttl', expireAfterSeconds: auditRetentionDays * 24 * 60 * 60 },
  );
  await c.auditEvents.createIndex({ 'actor.subject': 1, at: -1 }, { name: 'audit_by_actor' });
}

/** Drop everything. Test support only — never called by the application. */
export async function dropAll(db: Db): Promise<void> {
  for (const name of Object.values(COLLECTIONS)) {
    await db.collection(name).deleteMany({});
  }
}
