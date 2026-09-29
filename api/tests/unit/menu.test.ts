/**
 * The learner's menu — folders of skills, and which skills show (ADR-0021).
 *
 * The menu is the learner's own arrangement of the packs they have started. What is pinned here is
 * that it can never lose a skill: a pack the learner is working on is always *somewhere* — in a
 * folder, loose, or hidden in the library — whatever state the stored arrangement is in.
 */

import { describe, expect, it } from 'vitest';
import { MAX_FOLDERS, normalizeMenu, type LearnerMenu } from '../../src/domain/menu.js';

const empty: LearnerMenu = { folders: [], placements: [] };

describe('normalizeMenu', () => {
  it('shows a skill the learner has started but never placed, loose and at the end', () => {
    const menu = normalizeMenu({ folders: [], placements: [{ packId: 'woorden', folderId: null, hidden: false }] }, [
      'woorden',
      'lezen',
    ]);

    expect(menu.placements).toEqual([
      { packId: 'woorden', folderId: null, hidden: false },
      { packId: 'lezen', folderId: null, hidden: false },
    ]);
  });

  it('gives every started skill a placement when nothing has been arranged yet', () => {
    expect(normalizeMenu(undefined, ['a', 'b'])).toEqual({
      folders: [],
      placements: [
        { packId: 'a', folderId: null, hidden: false },
        { packId: 'b', folderId: null, hidden: false },
      ],
    });
  });

  it('drops a skill the learner is no longer enrolled in', () => {
    const menu = normalizeMenu(
      {
        folders: [],
        placements: [
          { packId: 'gone', folderId: null, hidden: false },
          { packId: 'kept', folderId: null, hidden: true },
        ],
      },
      ['kept'],
    );

    expect(menu.placements).toEqual([{ packId: 'kept', folderId: null, hidden: true }]);
  });

  it('keeps the order the learner chose', () => {
    const menu = normalizeMenu(
      {
        folders: [],
        placements: [
          { packId: 'c', folderId: null, hidden: false },
          { packId: 'a', folderId: null, hidden: false },
          { packId: 'b', folderId: null, hidden: false },
        ],
      },
      ['a', 'b', 'c'],
    );

    expect(menu.placements.map((entry) => entry.packId)).toEqual(['c', 'a', 'b']);
  });

  it('takes a skill out of a folder that no longer exists, rather than losing it', () => {
    const menu = normalizeMenu({ folders: [], placements: [{ packId: 'a', folderId: 'deleted', hidden: false }] }, [
      'a',
    ]);

    expect(menu.placements).toEqual([{ packId: 'a', folderId: null, hidden: false }]);
  });

  it('keeps a folder with nothing in it — an empty folder is something the learner just made', () => {
    const menu = normalizeMenu({ folders: [{ folderId: 'nl', name: 'Nederlands' }], placements: [] }, []);

    expect(menu.folders).toEqual([{ folderId: 'nl', name: 'Nederlands' }]);
  });

  it('keeps the first of two placements for the same skill', () => {
    const menu = normalizeMenu(
      {
        folders: [{ folderId: 'nl', name: 'Nederlands' }],
        placements: [
          { packId: 'a', folderId: 'nl', hidden: false },
          { packId: 'a', folderId: null, hidden: true },
        ],
      },
      ['a'],
    );

    expect(menu.placements).toEqual([{ packId: 'a', folderId: 'nl', hidden: false }]);
  });

  it('keeps the first of two folders with the same id', () => {
    const menu = normalizeMenu(
      {
        folders: [
          { folderId: 'nl', name: 'Nederlands' },
          { folderId: 'nl', name: 'Dutch' },
        ],
        placements: [],
      },
      [],
    );

    expect(menu.folders).toEqual([{ folderId: 'nl', name: 'Nederlands' }]);
  });

  it('trims a folder name, and falls back rather than keeping an empty one', () => {
    const menu = normalizeMenu(
      {
        folders: [
          { folderId: 'a', name: '  Nederlands  ' },
          { folderId: 'b', name: '   ' },
        ],
        placements: [],
      },
      [],
    );

    expect(menu.folders.map((folder) => folder.name)).toEqual(['Nederlands', 'Folder']);
  });

  it('refuses nothing and loses nothing past the folder limit: the extra folders go, their skills stay', () => {
    const folders = Array.from({ length: MAX_FOLDERS + 2 }, (_, index) => ({
      folderId: `f${index}`,
      name: `F${index}`,
    }));
    const last = folders.at(-1)!.folderId;
    const menu = normalizeMenu({ folders, placements: [{ packId: 'a', folderId: last, hidden: false }] }, ['a']);

    expect(menu.folders).toHaveLength(MAX_FOLDERS);
    expect(menu.placements).toEqual([{ packId: 'a', folderId: null, hidden: false }]);
  });

  it('is idempotent', () => {
    const once = normalizeMenu(
      {
        folders: [{ folderId: 'nl', name: ' Nederlands ' }],
        placements: [
          { packId: 'b', folderId: 'nl', hidden: true },
          { packId: 'x', folderId: 'nope', hidden: false },
        ],
      },
      ['a', 'b', 'x'],
    );

    expect(normalizeMenu(once, ['a', 'b', 'x'])).toEqual(once);
  });

  it('returns an empty menu for a learner with nothing started', () => {
    expect(normalizeMenu(empty, [])).toEqual(empty);
  });
});
