/**
 * Grouping the rail by the learner's menu (ADR-0021).
 *
 * What is pinned: a started skill always shows somewhere unless the learner hid it, and hiding is
 * counted rather than silent — the rail says how many are waiting in the library.
 */

import { describe, expect, it } from 'vitest';
import { arrangeRail } from './menu';
import type { LearnerMenu } from './types';

const skill = (packId: string) => ({ packId });

describe('arrangeRail', () => {
  it('shows everything loose when there is no menu yet', () => {
    expect(arrangeRail(null, [skill('a'), skill('b')])).toEqual({ folders: [], loose: [skill('a'), skill('b')], hidden: 0 });
  });

  it('files skills into their folders, in the learner’s order', () => {
    const menu: LearnerMenu = {
      folders: [{ folderId: 'nl', name: 'Nederlands' }],
      placements: [
        { packId: 'b', folderId: 'nl', hidden: false },
        { packId: 'c', folderId: null, hidden: false },
        { packId: 'a', folderId: 'nl', hidden: false },
      ],
    };

    expect(arrangeRail(menu, [skill('a'), skill('b'), skill('c')])).toEqual({
      folders: [{ folderId: 'nl', name: 'Nederlands', items: [skill('b'), skill('a')] }],
      loose: [skill('c')],
      hidden: 0,
    });
  });

  it('counts hidden skills instead of showing them', () => {
    const menu: LearnerMenu = {
      folders: [],
      placements: [
        { packId: 'a', folderId: null, hidden: true },
        { packId: 'b', folderId: null, hidden: false },
      ],
    };

    expect(arrangeRail(menu, [skill('a'), skill('b')])).toEqual({ folders: [], loose: [skill('b')], hidden: 1 });
  });

  it('leaves a folder with nothing shown out of the rail', () => {
    const menu: LearnerMenu = {
      folders: [{ folderId: 'nl', name: 'Nederlands' }],
      placements: [{ packId: 'a', folderId: 'nl', hidden: true }],
    };

    expect(arrangeRail(menu, [skill('a')]).folders).toEqual([]);
  });

  it('shows a skill the menu does not know yet, loose, rather than losing it', () => {
    const menu: LearnerMenu = { folders: [], placements: [{ packId: 'a', folderId: null, hidden: false }] };

    expect(arrangeRail(menu, [skill('a'), skill('new')]).loose).toEqual([skill('a'), skill('new')]);
  });

  it('skips a placement for a skill the rail does not have', () => {
    const menu: LearnerMenu = { folders: [], placements: [{ packId: 'gone', folderId: null, hidden: true }] };

    expect(arrangeRail(menu, [])).toEqual({ folders: [], loose: [], hidden: 0 });
  });
});
