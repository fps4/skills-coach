/**
 * Word requests (ADR-0023): the learner asks, a coach suggests, the learner decides.
 *
 * The runtime fills nothing in (ADR-0001). It holds a requested word until a coach — a person with an
 * MCP client, or a worker calling `/coach/v1` — proposes a card for it, and then holds the proposal
 * until the learner has looked at it. Accepting is the only way a suggestion reaches a deck, and it
 * goes in through the same `addTerm` a hand-typed word does, so it is an ordinary own word from then on
 * (ADR-0012).
 *
 * **What a coach sees is the word, never the learner.** The queue carries the term and the two
 * languages it moves between — enough to fill a card in — and an opaque request id. No learner id, no
 * deck, nothing else from their account. That is the narrowest possible exception to ADR-0012's rule
 * that a learner's own words never reach the coach surface: a word reaches it only because its learner
 * sent it there, and only that word.
 */

import { randomUUID } from 'node:crypto';
import { conflict, invalid, notFound } from '../http/errors.js';
import {
  acceptTermRequestSchema,
  requestTermsSchema,
  termSuggestionSchema,
  type AcceptTermRequestInput,
  type TermSuggestionInput,
} from '../domain/schemas.js';
import {
  acceptedTerm,
  nextStatus,
  requestedTerms,
  TermRequestTransitionError,
  type TermRequestAction,
  type TermRequestStatus,
  type TermSuggestion,
} from '../domain/term-request.js';
import type { DrillItem } from '../domain/types.js';
import type { TermRequestDoc } from '../db/collections.js';
import { getBlockFor, getPack } from './content.js';
import { addTerm } from './learner-terms.js';
import type { ServiceContext } from './context.js';

/** A request as its learner sees it. */
export interface TermRequest {
  requestId: string;
  packId: string;
  blockId: string;
  term: string;
  status: TermRequestStatus;
  suggestion?: TermSuggestion;
  requestedAt: Date;
  suggestedAt?: Date;
  resolvedAt?: Date;
  drillItemId?: string;
}

/** A request as a coach sees it: the word and its languages, and nothing about who asked. */
export interface QueuedTermRequest {
  requestId: string;
  term: string;
  /** The language the word is in. */
  contentLanguage: string;
  /** The language the translation, and every detail's gloss, should be written in. */
  translationLanguage: string;
  status: TermRequestStatus;
  requestedAt: Date;
}

const toRequest = ({ _id, learnerId: _learner, ...rest }: TermRequestDoc): TermRequest => ({ ...rest, requestId: _id });

/** Apply a transition, or refuse it as a conflict the caller can read. */
function transition(doc: TermRequestDoc, action: TermRequestAction): TermRequestStatus {
  try {
    return nextStatus(doc.status, action);
  } catch (error) {
    if (error instanceof TermRequestTransitionError) throw conflict(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The learner's side
// ---------------------------------------------------------------------------

/**
 * Ask for words to be filled in, into the deck of this block.
 *
 * A word already waiting or waiting for review is not asked for twice — the existing request comes
 * back instead — and a word the learner threw away can simply be asked for again.
 */
export async function requestTerms(
  ctx: ServiceContext,
  learnerId: string,
  blockId: string,
  input: { terms: string[] },
): Promise<TermRequest[]> {
  const terms = requestedTerms(requestTermsSchema.parse(input).terms);
  if (terms.length === 0) throw invalid('no words to fill in');
  // Refuses a block that does not exist or is somebody else's — the same gate adding a word has.
  const block = await getBlockFor(ctx, blockId, learnerId);
  const c = ctx.store.collections;
  const now = ctx.now();

  const open = await c.termRequests.find({ learnerId, blockId, status: { $in: ['requested', 'suggested'] } }).toArray();
  const openByTerm = new Map(open.map((doc) => [doc.term.toLocaleLowerCase(), doc]));

  const result: TermRequest[] = [];
  for (const term of terms) {
    const existing = openByTerm.get(term.toLocaleLowerCase());
    if (existing) {
      result.push(toRequest(existing));
      continue;
    }
    const doc: TermRequestDoc = {
      _id: randomUUID(),
      learnerId,
      packId: block.packId,
      blockId,
      term,
      status: 'requested',
      requestedAt: now,
    };
    await c.termRequests.insertOne(doc);
    result.push(toRequest(doc));
  }
  return result;
}

/**
 * This learner's requests for one deck: everything open, plus what was resolved recently — a list
 * that grows forever is not a list anyone reads.
 */
export async function listRequests(
  ctx: ServiceContext,
  learnerId: string,
  blockId: string,
  { resolvedSince }: { resolvedSince: Date },
): Promise<TermRequest[]> {
  const docs = await ctx.store.collections.termRequests
    .find({
      learnerId,
      blockId,
      $or: [{ status: { $in: ['requested', 'suggested'] } }, { resolvedAt: { $gte: resolvedSince } }],
    })
    .sort({ requestedAt: -1 })
    .toArray();
  return docs.map(toRequest);
}

/** How many of this learner's requests in a pack wait on a coach, and how many wait on them. */
export async function countRequests(
  ctx: ServiceContext,
  learnerId: string,
  packId: string,
): Promise<{ waiting: number; ready: number }> {
  const c = ctx.store.collections.termRequests;
  const [waiting, ready] = await Promise.all([
    c.countDocuments({ learnerId, packId, status: 'requested' }),
    c.countDocuments({ learnerId, packId, status: 'suggested' }),
  ]);
  return { waiting, ready };
}

/** One of this learner's requests, or a 404 — someone else's request is not theirs to know about. */
async function ownRequest(ctx: ServiceContext, learnerId: string, requestId: string): Promise<TermRequestDoc> {
  const doc = await ctx.store.collections.termRequests.findOne({ _id: requestId, learnerId });
  if (!doc) throw notFound(`word request ${requestId}`);
  return doc;
}

/**
 * Accept a suggestion, as edited, into the deck. The word becomes an ordinary own word (ADR-0012):
 * same id rule, same idempotence, same privacy.
 */
export async function acceptRequest(
  ctx: ServiceContext,
  learnerId: string,
  requestId: string,
  input: AcceptTermRequestInput,
): Promise<{ request: TermRequest; item: DrillItem }> {
  const doc = await ownRequest(ctx, learnerId, requestId);
  const status = transition(doc, 'accept');
  const { omit, ...edits } = acceptTermRequestSchema.parse(input);
  // `transition` has already refused a request with no suggestion; this narrows the type.
  if (!doc.suggestion) throw conflict('nothing has been suggested for this word yet');

  let card;
  try {
    card = acceptedTerm(doc.term, doc.suggestion, edits, omit);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }

  const item = await addTerm(ctx, learnerId, doc.blockId, card);
  const now = ctx.now();
  const updated = await ctx.store.collections.termRequests.findOneAndUpdate(
    { _id: requestId, learnerId, status: doc.status },
    { $set: { status, resolvedAt: now, drillItemId: item.drillItemId } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('this word request changed while it was being accepted');
  return { request: toRequest(updated), item };
}

/** Send a word back to the coach — the suggestion was wrong, or it was thrown away too soon. */
export async function retryRequest(ctx: ServiceContext, learnerId: string, requestId: string): Promise<TermRequest> {
  const doc = await ownRequest(ctx, learnerId, requestId);
  const status = transition(doc, 'retry');
  const updated = await ctx.store.collections.termRequests.findOneAndUpdate(
    { _id: requestId, learnerId, status: doc.status },
    { $set: { status, requestedAt: ctx.now() }, $unset: { suggestion: '', suggestedAt: '', resolvedAt: '' } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('this word request changed while it was being sent back');
  return toRequest(updated);
}

/** Throw a request away. It is kept, marked discarded, so it can be asked for again. */
export async function discardRequest(ctx: ServiceContext, learnerId: string, requestId: string): Promise<TermRequest> {
  const doc = await ownRequest(ctx, learnerId, requestId);
  const status = transition(doc, 'discard');
  const updated = await ctx.store.collections.termRequests.findOneAndUpdate(
    { _id: requestId, learnerId, status: doc.status },
    { $set: { status, resolvedAt: ctx.now() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('this word request changed while it was being discarded');
  return toRequest(updated);
}

// ---------------------------------------------------------------------------
// The coach's side
// ---------------------------------------------------------------------------

/**
 * The queue: words waiting to be filled in, oldest first.
 *
 * The projection is the privacy boundary — see the header — so it is built here, once, rather than by
 * whichever transport asks.
 */
export async function listQueue(
  ctx: ServiceContext,
  { status = 'requested', limit = 50 }: { status?: 'requested' | 'suggested'; limit?: number } = {},
): Promise<QueuedTermRequest[]> {
  const docs = await ctx.store.collections.termRequests
    .find({ status })
    .sort({ requestedAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .toArray();

  const languages = new Map<string, { contentLanguage: string; translationLanguage: string }>();
  const queued: QueuedTermRequest[] = [];
  for (const doc of docs) {
    let pair = languages.get(doc.packId);
    if (!pair) {
      const pack = await getPack(ctx, doc.packId).catch(() => null);
      if (!pack) continue; // the skill is gone; nothing to fill in for
      pair = { contentLanguage: pack.contentLanguage, translationLanguage: pack.translationLanguage };
      languages.set(doc.packId, pair);
    }
    queued.push({ requestId: doc._id, term: doc.term, ...pair, status: doc.status, requestedAt: doc.requestedAt });
  }
  return queued;
}

/**
 * Propose a card for a requested word. Validated against the same schema a learner's accepted card
 * is, so a coach cannot put anything on a card the learner could not.
 */
export async function suggest(
  ctx: ServiceContext,
  requestId: string,
  input: TermSuggestionInput,
): Promise<QueuedTermRequest> {
  const suggestion = termSuggestionSchema.parse(input);
  const doc = await ctx.store.collections.termRequests.findOne({ _id: requestId });
  if (!doc) throw notFound(`word request ${requestId}`);
  const status = transition(doc, 'suggest');

  const updated = await ctx.store.collections.termRequests.findOneAndUpdate(
    { _id: requestId, status: doc.status },
    { $set: { status, suggestion, suggestedAt: ctx.now() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('this word request changed while the suggestion was being saved');

  const pack = await getPack(ctx, updated.packId);
  return {
    requestId,
    term: updated.term,
    contentLanguage: pack.contentLanguage,
    translationLanguage: pack.translationLanguage,
    status: updated.status,
    requestedAt: updated.requestedAt,
  };
}
