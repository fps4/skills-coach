/**
 * The "All my skills" page lists every skill, and adding one is what starts it (ADR-0024).
 *
 * The api is mocked: what is under test is which skills are offered to add, and what gets sent when
 * one is — including the folder it was added into.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MenuEditor, type MenuSkill } from './menu-editor';
import { getDictionary } from '@/i18n/dictionaries';
import type { LearnerMenu } from '@/lib/types';

const clientApi = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ clientApi, isSessionExpired: () => false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const dictionary = getDictionary('en');

const SKILLS: MenuSkill[] = [
  { packId: 'words', title: { en: 'Word trainer' } },
  { packId: 'graphs', title: { en: 'Graphs' } },
];

const MENU: LearnerMenu = {
  folders: [{ folderId: 'arch', name: 'Architecture' }],
  placements: [{ packId: 'words', folderId: null, hidden: false }],
};

describe('MenuEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('offers only the skills not in the menu yet', () => {
    render(<MenuEditor locale="en" dictionary={dictionary} initial={MENU} skills={SKILLS} />);

    expect(screen.getByText(dictionary.menu.available)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: new RegExp(`^${dictionary.menu.add}`) })).toHaveLength(1);
    expect(screen.getByRole('button', { name: `${dictionary.menu.add}: Graphs` })).toBeTruthy();
  });

  it('adds a skill into the folder chosen for it, and shows the menu that comes back', async () => {
    clientApi.mockResolvedValue({
      menu: {
        folders: MENU.folders,
        placements: [...MENU.placements, { packId: 'graphs', folderId: 'arch', hidden: false }],
      },
    });
    render(<MenuEditor locale="en" dictionary={dictionary} initial={MENU} skills={SKILLS} />);

    fireEvent.change(screen.getByLabelText(`${dictionary.menu.folder}: Graphs`), { target: { value: 'arch' } });
    fireEvent.click(screen.getByRole('button', { name: `${dictionary.menu.add}: Graphs` }));

    await waitFor(() =>
      expect(clientApi).toHaveBeenCalledWith('/v1/me/menu/skills', {
        method: 'POST',
        body: { packId: 'graphs', folderId: 'arch' },
      }),
    );
    await waitFor(() => expect(screen.queryByText(dictionary.menu.available)).toBeNull());
  });
});
