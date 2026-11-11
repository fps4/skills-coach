/**
 * One pass over the queue: every requested word gets a card, or a later retry (ADR-0034).
 *
 * Words are filled one at a time, oldest first. A word that fails waits before it is tried again,
 * longer each time, so one word the model cannot answer never turns into a request every few seconds
 * — and never holds up the words behind it.
 */
import Anthropic from '@anthropic-ai/sdk';
import { toSuggestion, type QueuedTermRequest, type TermSuggestion } from './card.js';
import { CoachApiError } from './coach-api.js';
import { CardRefusedError, type CardWriter } from './writer.js';

export interface Queue {
  listRequested(limit: number): Promise<QueuedTermRequest[]>;
  suggest(requestId: string, suggestion: TermSuggestion): Promise<void>;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface CycleResult {
  suggested: number;
  failed: number;
  deferred: number;
}

const FIRST_RETRY_MS = 60_000;
const LAST_RETRY_MS = 60 * 60_000;
const BATCH = 50;

export class WordWorker {
  private readonly failures = new Map<string, { count: number; retryAt: number }>();

  constructor(
    private readonly queue: Queue,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async cycle(writer: CardWriter): Promise<CycleResult> {
    const result: CycleResult = { suggested: 0, failed: 0, deferred: 0 };
    const requests = await this.queue.listRequested(BATCH);
    this.forgetLeft(requests);

    for (const request of requests) {
      const failure = this.failures.get(request.requestId);
      if (failure && failure.retryAt > this.now()) {
        result.deferred += 1;
        continue;
      }
      if (await this.fill(writer, request)) result.suggested += 1;
      else result.failed += 1;
    }
    return result;
  }

  private async fill(writer: CardWriter, request: QueuedTermRequest): Promise<boolean> {
    const started = this.now();
    try {
      const suggestion = toSuggestion(await writer.write(request), request);
      if (!suggestion) throw new Error('the card had no translation');
      await this.queue.suggest(request.requestId, suggestion);
      this.failures.delete(request.requestId);
      this.log.info('word filled in', { requestId: request.requestId, ms: this.now() - started });
      return true;
    } catch (error) {
      // The learner discarded or retried the word while it was being written: nothing to do.
      if (error instanceof CoachApiError && (error.status === 404 || error.status === 409)) {
        this.failures.delete(request.requestId);
        this.log.info('word no longer waiting', { requestId: request.requestId, status: error.status });
        return false;
      }
      const count = (this.failures.get(request.requestId)?.count ?? 0) + 1;
      const wait = Math.min(FIRST_RETRY_MS * 2 ** (count - 1), LAST_RETRY_MS);
      this.failures.set(request.requestId, { count, retryAt: this.now() + wait });
      this.log.warn('word not filled in; will retry', {
        requestId: request.requestId,
        attempt: count,
        retryInSeconds: Math.round(wait / 1000),
        reason: error instanceof CardRefusedError ? 'refused' : String(error instanceof Error ? error.message : error),
      });
      // A bad key or an exhausted account fails every word alike; say so once, loudly.
      if (isAccountProblem(error)) throw error;
      return false;
    }
  }

  /** A request that left the queue (filled elsewhere, discarded) needs no retry bookkeeping. */
  private forgetLeft(requests: QueuedTermRequest[]): void {
    const waiting = new Set(requests.map((r) => r.requestId));
    for (const id of this.failures.keys()) if (!waiting.has(id)) this.failures.delete(id);
  }
}

function isAccountProblem(error: unknown): boolean {
  return error instanceof Anthropic.APIError && (error.status === 401 || error.status === 402 || error.status === 403);
}
