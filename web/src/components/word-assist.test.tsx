/**
 * Reviewing a word a coach filled in (ADR-0023).
 *
 * The api is mocked: what is under test is what the learner sees and what gets sent when they
 * accept — their edits and the lines they unticked, not the suggestion as it arrived.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WordAssist } from './word-assist';
import { getDictionary } from '@/i18n/dictionaries';
import type { TermRequest } from '@/lib/types';

const clientApi = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ clientApi, isSessionExpired: () => false }));

const dictionary = getDictionary('en');

const SUGGESTED: TermRequest = {
  requestId: 'req-1',
  packId: 'words',
  blockId: 'words.b1',
  term: 'verdwijnen',
  status: 'suggested',
  requestedAt: '2026-09-30T08:00:00.000Z',
  suggestion: {
    translation: 'to disappear',
    example: 'De kat verdween.',
    details: { synonyms: ['wegraken'], antonyms: ['verschijnen'] },
  },
};

function respond(requests: TermRequest[]) {
  clientApi.mockImplementation(async (path: string) =>
    path.endsWith('/term-requests') ? { requests } : path.includes('/terms') ? { terms: [] } : {},
  );
}

describe('WordAssist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('shows a filled-in word for review as soon as it loads', async () => {
    respond([SUGGESTED]);
    render(<WordAssist blockId="words.b1" contentLanguage="nl" translationLanguage="en" dictionary={dictionary} />);

    expect(await screen.findByText(dictionary.assist.ready, { exact: false })).toBeTruthy();
    expect(screen.getByDisplayValue('to disappear')).toBeTruthy();
    expect(screen.getByDisplayValue('wegraken')).toBeTruthy();
  });

  it('sends the learner’s edits and the lines they left out when they accept', async () => {
    respond([SUGGESTED]);
    render(<WordAssist blockId="words.b1" contentLanguage="nl" translationLanguage="en" dictionary={dictionary} />);

    const translation = await screen.findByDisplayValue('to disappear');
    fireEvent.change(translation, { target: { value: 'to vanish' } });
    fireEvent.click(screen.getByRole('checkbox', { name: `${dictionary.assist.include}: ${dictionary.assist.antonyms}` }));
    fireEvent.click(screen.getByRole('button', { name: dictionary.assist.addToDeck }));

    await waitFor(() =>
      expect(clientApi).toHaveBeenCalledWith(
        '/v1/term-requests/req-1/accept',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ translation: 'to vanish', omit: ['antonyms'] }),
        }),
      ),
    );
  });

  it('says so when nothing has been asked for yet', async () => {
    respond([]);
    render(<WordAssist blockId="words.b1" contentLanguage="nl" translationLanguage="en" dictionary={dictionary} />);

    expect(await screen.findByText(dictionary.assist.nothingYet)).toBeTruthy();
  });
});
