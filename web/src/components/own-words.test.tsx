/**
 * Filing your own words under a topic (ADR-0031, ADR-0032).
 *
 * The api is mocked: what is under test is what gets sent — a declared topic by its id however it was
 * typed, a learner's own label as typed — and that moving a word saves only when the topic changed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { OwnWords } from './own-words';
import { getDictionary } from '@/i18n/dictionaries';
import type { LearnerTerm } from '@/lib/types';

const clientApi = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ clientApi, isSessionExpired: () => false }));

const dictionary = getDictionary();
const t = dictionary.drills;
const TOPICS = [
  { id: 'work', title: 'Work & meetings' },
  { id: 'home', title: 'Home & housing' },
];

const word = (term: string, group?: string): LearnerTerm => ({
  drillItemId: `words.b1.u1.${term}`,
  blockId: 'words.b1',
  packId: 'words',
  payload: { kind: 'term', term, translation: `${term} (en)`, ...(group ? { group } : {}) },
});

function mount(words: LearnerTerm[]) {
  clientApi.mockImplementation(async (path: string) => (path.endsWith('/terms') ? { terms: words } : {}));
  render(
    <OwnWords
      blockId="words.b1"
      contentLanguage="nl"
      translationLanguage="en"
      dictionary={dictionary}
      onChanged={() => undefined}
      onSessionExpired={() => undefined}
      topics={TOPICS}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t.addWord }));
}

const sent = (method: string) =>
  clientApi.mock.calls.filter(([, init]) => init?.method === method).map(([path, init]) => [path, init.body]);

describe('OwnWords — topics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('files a new word under a declared topic by its id, typed by its title', async () => {
    mount([]);
    fireEvent.change(screen.getByLabelText(t.addWordTerm), { target: { value: 'de vergadering' } });
    fireEvent.change(screen.getByLabelText(t.addWordTranslation), { target: { value: 'the meeting' } });
    fireEvent.change(screen.getByLabelText(t.addWordTopic), { target: { value: 'work & meetings' } });
    fireEvent.click(screen.getByRole('button', { name: t.addWordSubmit }));

    await waitFor(() =>
      expect(sent('POST')).toEqual([['/v1/blocks/words.b1/terms', expect.objectContaining({ group: 'work' })]]),
    );
  });

  it('shows each word’s topic by title, and moves it when the box changes — only then', async () => {
    mount([word('de buurman', 'home'), word('het fietspad')]);
    const neighbour = await screen.findByLabelText(`${t.addWordTopic}: de buurman`);
    expect((neighbour as HTMLInputElement).value).toBe('Home & housing');

    fireEvent.blur(neighbour);
    expect(sent('PATCH')).toEqual([]);

    const path = screen.getByLabelText(`${t.addWordTopic}: het fietspad`);
    fireEvent.change(path, { target: { value: 'Getting around' } });
    fireEvent.blur(path);
    fireEvent.change(neighbour, { target: { value: '' } });
    fireEvent.blur(neighbour);

    await waitFor(() =>
      expect(sent('PATCH')).toEqual([
        ['/v1/terms/words.b1.u1.het fietspad', { group: 'Getting around' }],
        ['/v1/terms/words.b1.u1.de buurman', { group: null }],
      ]),
    );
  });
});
