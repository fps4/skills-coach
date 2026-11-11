import { describe, expect, it } from 'vitest';
import type { Card, QueuedTermRequest, TermSuggestion } from '../src/card.js';
import { CoachApiError } from '../src/coach-api.js';
import { WordWorker, type Logger } from '../src/worker.js';
import { CardRefusedError, type CardWriter } from '../src/writer.js';

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const word = (requestId: string, term = 'lopen'): QueuedTermRequest => ({
  requestId,
  term,
  contentLanguage: 'nl',
  translationLanguage: 'en',
  topics: [],
});

class FakeQueue {
  waiting: QueuedTermRequest[] = [];
  suggested = new Map<string, TermSuggestion>();
  rejectWith?: number;
  async listRequested() {
    return this.waiting.filter((r) => !this.suggested.has(r.requestId));
  }
  async suggest(requestId: string, suggestion: TermSuggestion) {
    if (this.rejectWith) throw new CoachApiError(this.rejectWith, 'rejected');
    this.suggested.set(requestId, suggestion);
  }
}

const writerOf = (answer: (r: QueuedTermRequest) => Card | Error): CardWriter & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    async write(r) {
      calls.push(r.requestId);
      const result = answer(r);
      if (result instanceof Error) throw result;
      return result;
    },
  };
};

describe('a pass over the queue', () => {
  it('fills in every waiting word', async () => {
    const queue = new FakeQueue();
    queue.waiting = [word('a', 'lopen'), word('b', 'zwemmen')];
    const writer = writerOf((r) => ({ translation: `${r.term} in English` }));

    const result = await new WordWorker(queue, silent).cycle(writer);

    expect(result).toEqual({ suggested: 2, failed: 0, deferred: 0 });
    expect(queue.suggested.get('b')).toEqual({ translation: 'zwemmen in English' });
  });

  it('does not let one failing word hold up the words behind it', async () => {
    const queue = new FakeQueue();
    queue.waiting = [word('bad'), word('good')];
    const writer = writerOf((r) => (r.requestId === 'bad' ? new CardRefusedError('no') : { translation: 'ok' }));

    const result = await new WordWorker(queue, silent).cycle(writer);

    expect(result).toEqual({ suggested: 1, failed: 1, deferred: 0 });
    expect([...queue.suggested.keys()]).toEqual(['good']);
  });

  it('waits before trying a failed word again, longer after each failure', async () => {
    let now = 0;
    const queue = new FakeQueue();
    queue.waiting = [word('bad')];
    const writer = writerOf(() => new Error('model unavailable'));
    const worker = new WordWorker(queue, silent, () => now);

    await worker.cycle(writer); // fails; next try after 1 minute
    now = 30_000;
    expect(await worker.cycle(writer)).toEqual({ suggested: 0, failed: 0, deferred: 1 });
    now = 61_000;
    await worker.cycle(writer); // fails again; next try after 2 minutes
    now = 61_000 + 90_000;
    expect((await worker.cycle(writer)).deferred).toBe(1);
    expect(writer.calls).toEqual(['bad', 'bad']);
  });

  it('counts a card without a translation as a failure, not a suggestion', async () => {
    const queue = new FakeQueue();
    queue.waiting = [word('a')];
    const result = await new WordWorker(queue, silent).cycle(writerOf(() => ({ translation: ' ' })));
    expect(result.failed).toBe(1);
    expect(queue.suggested.size).toBe(0);
  });

  it('lets a word go quietly when the learner discarded it meanwhile', async () => {
    const queue = new FakeQueue();
    queue.waiting = [word('a')];
    queue.rejectWith = 409;
    let now = 0;
    const worker = new WordWorker(queue, silent, () => now);
    const writer = writerOf(() => ({ translation: 'ok' }));

    await worker.cycle(writer);
    queue.rejectWith = undefined;
    now = 1_000;
    // No retry wait was recorded: if it comes back, it is filled at once.
    expect((await worker.cycle(writer)).suggested).toBe(1);
  });
});
