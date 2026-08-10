/**
 * Where the toggle leaves you.
 *
 * The api call is mocked because what is under test is the navigation, not the request: marking read
 * is the end of a visit and returns to the queue, putting it back is not and stays. The two are one
 * button, so it is worth pinning that they do not share an ending.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ReadToggle } from './read-toggle';
import { getDictionary } from '@/i18n/dictionaries';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const clientApi = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ clientApi, isSessionExpired: () => false }));

const dictionary = getDictionary('en');
const LIBRARY = '/en/reading?packId=dutch-conversation-nl';

function renderToggle(readAt: string | null) {
  return render(<ReadToggle articleId="art-1" readAt={readAt} library={LIBRARY} dictionary={dictionary} />);
}

describe('ReadToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.mockResolvedValue({});
  });

  // Vitest runs without globals, so testing-library's automatic cleanup never registers.
  afterEach(cleanup);

  it('returns to the library once the article is marked read', async () => {
    renderToggle(null);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(push).toHaveBeenCalledWith(LIBRARY));
    expect(clientApi).toHaveBeenCalledWith('/v1/reading/art-1/read', { method: 'POST', body: { read: true } });
    // The list is re-fetched rather than served from the client cache, which still has this article
    // sitting in the unread queue.
    expect(refresh).toHaveBeenCalled();
  });

  it('stays on the article when the mark is put back', async () => {
    renderToggle('2026-08-01T10:00:00.000Z');
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(clientApi).toHaveBeenCalledWith('/v1/reading/art-1/read', { method: 'POST', body: { read: false } });
    expect(push).not.toHaveBeenCalled();
  });

  it('does not navigate when the call fails', async () => {
    clientApi.mockRejectedValue(new Error('nope'));
    renderToggle(null);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText(dictionary.common.error)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });
});
