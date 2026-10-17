/**
 * The flashcard surface's keyboard (ADR-0027).
 *
 * The api is mocked: what is under test is that a key does what its badge says — and only on this
 * page, only when it is not being typed, and not after the page has gone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Flashcards } from './flashcards';
import { getDictionary } from '@/i18n/dictionaries';
import type { DeckPage, DrillProgress } from '@/lib/types';

const clientApi = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({
  clientApi,
  isSessionExpired: () => false,
  query: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
    return `?${search.toString()}`;
  },
}));

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const dictionary = getDictionary();
const t = dictionary.flashcards;

const fresh: DrillProgress = {
  stage: 1,
  streak: 0,
  stage1Cleared: false,
  stage2Cleared: false,
  mastered: false,
  attempts: 0,
  correct: 0,
};

const DECK: DeckPage = {
  items: [
    {
      drillItemId: 'kg.b1.d1',
      stage: 1,
      prompt: { kind: 'term', stage: 1, prompt: 'Widget join', group: 'Basics', hint: 'A zipper.' },
      progress: fresh,
    },
    {
      drillItemId: 'kg.b1.d2',
      stage: 1,
      prompt: { kind: 'term', stage: 1, prompt: 'Gadget fan-out' },
      progress: fresh,
    },
  ],
  summary: { total: 2, stage1Cleared: 0, stage2Unlocked: 0, mastered: 0, inProgress: 2 },
  topics: [],
};

const TOPICS: DeckPage['topics'] = [
  { id: 'Basics', title: 'Basics', summary: { total: 1, stage1Cleared: 0, stage2Unlocked: 0, mastered: 0, inProgress: 1 } },
  { id: '_none', summary: { total: 1, stage1Cleared: 1, stage2Unlocked: 0, mastered: 1, inProgress: 0 } },
];

function respond() {
  clientApi.mockImplementation(async (path: string, init?: { body?: Record<string, unknown> }) => {
    if (path.startsWith('/v1/drills?')) {
      if (path.includes('mode=learn')) {
        return {
          ...DECK,
          items: DECK.items.map((item) => ({ ...item, card: { expected: `back of ${item.prompt.prompt}` } })),
        };
      }
      return DECK;
    }
    if (path.endsWith('/reveal')) {
      return {
        drillItemId: 'kg.b1.d1',
        stage: 1,
        expected: 'Matching two widget lists on a shared key.',
        details: { analogy: 'Like a SQL inner join.', code: 'left JOIN right', source: 'Widgets guide · Joining' },
      };
    }
    if (path.endsWith('/attempts')) {
      const got = init?.body?.self === 'got';
      return {
        drillItemId: 'kg.b1.d1',
        correct: got,
        overridden: false,
        selfGraded: true,
        expected: 'Matching two widget lists on a shared key.',
        progress: { ...fresh, attempts: 1, correct: got ? 1 : 0, streak: got ? 1 : 0 },
      };
    }
    return {};
  });
}

const key = (k: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key: k, ...init });

function mount(grading: 'self' | 'typed' = 'self', topic?: string) {
  return render(
    <Flashcards
      blockId="kg.b1"
      contentLanguage="en"
      translationLanguage="en"
      grading={grading}
      dictionary={dictionary}
      addHref="/flashcards?blockId=kg.b1&view=add"
      topic={topic}
    />,
  );
}

const calls = (suffix: string) => clientApi.mock.calls.filter(([path]) => String(path).endsWith(suffix));

describe('Flashcards — the keyboard', () => {
  beforeEach(() => {
    clientApi.mockReset();
    respond();
  });
  afterEach(cleanup);

  it('shows the front only, then turns the card over on F', async () => {
    mount();
    await screen.findByText('Widget join');
    expect(screen.queryByText('Matching two widget lists on a shared key.')).toBeNull();

    key('f');
    await screen.findByText('Matching two widget lists on a shared key.');
    expect(calls('/reveal')).toHaveLength(1);
    expect(screen.getByText('Like a SQL inner join.')).toBeTruthy();
    expect(screen.getByText('left JOIN right')).toBeTruthy();
    expect(screen.getByText(/Widgets guide · Joining/)).toBeTruthy();
    // Nothing graded yet: a reveal is not an attempt.
    expect(calls('/attempts')).toHaveLength(0);
  });

  it('grades with G, says what happened, and moves on with N', async () => {
    mount();
    await screen.findByText('Widget join');
    key(' ');
    await screen.findByText(t.didYouHaveIt);

    key('g');
    await screen.findByText(t.statusOneMore);
    expect(calls('/attempts')[0]?.[1]).toMatchObject({ method: 'POST', body: { stage: 1, self: 'got' } });

    key('n');
    await screen.findByText('Gadget fan-out');
  });

  it('marks a miss with M and resets the streak line', async () => {
    mount();
    await screen.findByText('Widget join');
    key('f');
    await screen.findByText(t.didYouHaveIt);
    key('m');
    await screen.findByText(t.statusReset);
    expect(calls('/attempts')[0]?.[1]).toMatchObject({ body: { self: 'missed' } });
  });

  it('shows the hint on H', async () => {
    mount();
    await screen.findByText('Widget join');
    key('h');
    await screen.findByText('A zipper.');
  });

  it('ends the batch with counts, and N fetches the next one', async () => {
    mount();
    for (const term of ['Widget join', 'Gadget fan-out']) {
      await screen.findByText(term);
      key('f');
      await screen.findByText(t.didYouHaveIt);
      key('g');
      await screen.findByText(t.statusOneMore);
      key('n');
    }
    await screen.findByText(t.batchDone);
    expect(screen.getByText(`2 ${t.got}`)).toBeTruthy();

    const before = clientApi.mock.calls.length;
    key('n');
    await waitFor(() => expect(clientApi.mock.calls.length).toBeGreaterThan(before));
  });

  it('switches to learn mode on L, showing the answer, and records nothing there', async () => {
    mount();
    await screen.findByText('Widget join');
    key('l');
    await screen.findByText('back of Widget join');
    expect(clientApi.mock.calls.some(([path]) => String(path).includes('mode=learn'))).toBe(true);

    key('n');
    await screen.findByText('back of Gadget fan-out');
    key('b');
    await screen.findByText('back of Widget join');
    expect(calls('/attempts')).toHaveLength(0);
    expect(calls('/reveal')).toHaveLength(0);
  });

  it('asks for the other direction on D', async () => {
    mount();
    await screen.findByText('Widget join');
    key('d');
    await waitFor(() => expect(clientApi.mock.calls.some(([path]) => String(path).includes('stage=2'))).toBe(true));
  });

  it('ignores keys held with Ctrl, ⌘ or Alt', async () => {
    mount();
    await screen.findByText('Widget join');
    key('f', { ctrlKey: true });
    key('f', { metaKey: true });
    key('f', { altKey: true });
    expect(calls('/reveal')).toHaveLength(0);
  });

  it('lets a typed answer contain the letters that are shortcuts', async () => {
    mount('typed');
    const input = await screen.findByPlaceholderText(t.answerPlaceholder);
    key('f', {}, input);
    key('l', {}, input);
    key('d', {}, input);
    expect(clientApi.mock.calls.some(([path]) => String(path).includes('mode=learn'))).toBe(false);
    expect(clientApi.mock.calls.some(([path]) => String(path).includes('stage=2'))).toBe(false);
  });

  it('stops listening once the surface is gone', async () => {
    const view = mount();
    await screen.findByText('Widget join');
    view.unmount();
    key('f');
    key('l');
    expect(calls('/reveal')).toHaveLength(0);
  });

  it('labels its buttons with their keys', async () => {
    mount();
    await screen.findByText('Widget join');
    const show = screen.getByRole('button', { name: new RegExp(t.showAnswer) });
    expect(show.getAttribute('aria-keyshortcuts')).toBe('F Space');
    expect(show.querySelector('kbd')?.textContent).toBe('F');
  });
});

describe('Flashcards — topics (ADR-0031)', () => {
  beforeEach(() => {
    clientApi.mockReset();
    push.mockReset();
    respond();
  });
  afterEach(cleanup);

  const withTopics = () => {
    const plain = clientApi.getMockImplementation()!;
    clientApi.mockImplementation(async (path: string, init?: unknown) => {
      const page = await plain(path, init);
      return path.startsWith('/v1/drills?') ? { ...page, topics: TOPICS } : page;
    });
  };

  it('offers no topic picker for a deck whose cards have no topic', async () => {
    mount();
    await screen.findByText('Widget join');
    expect(screen.queryByLabelText(t.topic)).toBeNull();
  });

  it('lists every topic with its counts, the cards without one by the interface’s own word', async () => {
    withTopics();
    mount();
    const picker = (await screen.findByLabelText(t.topic)) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.textContent)).toEqual([t.allTopics, 'Basics · 0/1', `${t.noTopic} · 1/1`]);
  });

  it('asks the api for only the chosen topic', async () => {
    withTopics();
    mount('self', 'Basics');
    await screen.findByText('Widget join');
    expect(clientApi.mock.calls[0][0]).toContain('topic=Basics');
    expect(((await screen.findByLabelText(t.topic)) as HTMLSelectElement).value).toBe('Basics');
  });

  it('changes topic by address, keeping learn mode, and back to the whole deck', async () => {
    withTopics();
    mount();
    const picker = await screen.findByLabelText(t.topic);
    key('l');
    await screen.findByText('back of Widget join');
    fireEvent.change(picker, { target: { value: '_none' } });
    expect(push).toHaveBeenLastCalledWith('/flashcards?blockId=kg.b1&topic=_none&mode=learn');
    key('p');
    await waitFor(() => expect(screen.queryByText('back of Widget join')).toBeNull());
    fireEvent.change(picker, { target: { value: '' } });
    expect(push).toHaveBeenLastCalledWith('/flashcards?blockId=kg.b1');
  });

  it('says a topic link that matches nothing is not an empty deck', async () => {
    clientApi.mockImplementation(async () => ({ ...DECK, items: [], summary: { ...DECK.summary, total: 0 }, topics: TOPICS }));
    mount('self', 'Renamed');
    expect(await screen.findByText(t.topicEmpty)).toBeTruthy();
    expect(screen.queryByText(t.empty)).toBeNull();
  });
});
