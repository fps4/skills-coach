/**
 * Turning the learner's stored menu into what the rail draws (ADR-0021).
 *
 * The api has already reconciled the menu with what the learner started — every started skill has
 * exactly one placement — so this only groups and filters. It is kept pure and React-free so the
 * grouping is tested rather than eyeballed, and so the rail and the organise page cannot disagree
 * about which skill sits where.
 */

import type { LearnerMenu } from '@/lib/types';

export interface RailFolder<T> {
  folderId: string;
  name: string;
  /** The shown skills in this folder, in the learner's order. */
  items: T[];
}

export interface ArrangedRail<T> {
  folders: RailFolder<T>[];
  /** Shown skills outside any folder. */
  loose: T[];
  /** Skills kept in the library and off the menu. */
  hidden: number;
}

/**
 * Group the skills the rail knows about by the learner's menu.
 *
 * A skill the rail has but the menu does not place — started after the menu was fetched — shows
 * loose rather than disappearing; one the menu places but the rail does not know is skipped. Every
 * folder is kept, even one with nothing shown in it: a folder the learner just made has to appear
 * where they made it, or it looks as if creating it failed (ADR-0024). A caller that only wants the
 * folders with something in them — the start page — filters for itself.
 */
export function arrangeRail<T extends { packId: string }>(menu: LearnerMenu | null, items: readonly T[]): ArrangedRail<T> {
  const byId = new Map(items.map((item) => [item.packId, item]));
  const folders = (menu?.folders ?? []).map((folder) => ({ ...folder, items: [] as T[] }));
  const folderById = new Map(folders.map((folder) => [folder.folderId, folder]));
  const loose: T[] = [];
  let hidden = 0;
  const placed = new Set<string>();

  for (const placement of menu?.placements ?? []) {
    const item = byId.get(placement.packId);
    if (!item || placed.has(placement.packId)) continue;
    placed.add(placement.packId);
    if (placement.hidden) {
      hidden += 1;
      continue;
    }
    const folder = placement.folderId ? folderById.get(placement.folderId) : undefined;
    (folder ? folder.items : loose).push(item);
  }

  for (const item of items) if (!placed.has(item.packId)) loose.push(item);

  return { folders, loose, hidden };
}
