/**
 * The learner's menu: folders of skills, and which of them show (ADR-0021).
 *
 * A learner works on many small skills and studies a few at a time. The menu is how they say which:
 * they file skills into folders of their own naming, and hide the ones they are not studying now.
 * Hidden is not gone — a hidden skill keeps its progress and waits in the library.
 *
 * The arrangement belongs to the learner, never to a pack. A pack does not know which folder it is
 * in, and nothing here reads anything a pack declares.
 *
 * `normalizeMenu` is the one rule: whatever was stored, and whatever a client sends, every skill the
 * learner has started comes out placed exactly once. A skill can be moved or hidden; it cannot be
 * lost by a stale folder id, a duplicate, or an arrangement written before it was started.
 */

export const MAX_FOLDERS = 50;
export const MAX_FOLDER_NAME = 60;
const FALLBACK_FOLDER_NAME = 'Folder';

export interface MenuFolder {
  /** Chosen by the client. Opaque here; only its uniqueness matters. */
  folderId: string;
  name: string;
}

export interface MenuPlacement {
  packId: string;
  /** Null means the skill sits in the menu outside any folder. */
  folderId: string | null;
  /** Kept in the library, off the menu. Progress is untouched either way. */
  hidden: boolean;
}

/**
 * The stored arrangement. Order is the array order — of folders among themselves, and of skills
 * within whichever folder they are in.
 */
export interface LearnerMenu {
  folders: MenuFolder[];
  placements: MenuPlacement[];
}

/**
 * Reconcile an arrangement with the skills the learner has actually started.
 *
 * - Every started skill gets exactly one placement; one never placed is appended, loose and shown.
 * - A placement for a skill no longer started is dropped.
 * - A placement naming a folder that does not exist moves out of it, rather than vanishing.
 * - Duplicates keep the first occurrence; folder names are trimmed and never left empty.
 *
 * Pure and idempotent, so the same function serves a read (a stale stored menu) and a write (a
 * client's proposed menu) without either needing its own rules.
 */
export function normalizeMenu(stored: LearnerMenu | undefined, startedPackIds: readonly string[]): LearnerMenu {
  const folders: MenuFolder[] = [];
  const folderIds = new Set<string>();
  for (const folder of stored?.folders ?? []) {
    if (folders.length >= MAX_FOLDERS) break;
    if (folderIds.has(folder.folderId)) continue;
    folderIds.add(folder.folderId);
    const name = folder.name.trim().slice(0, MAX_FOLDER_NAME);
    folders.push({ folderId: folder.folderId, name: name || FALLBACK_FOLDER_NAME });
  }

  const started = new Set(startedPackIds);
  const placed = new Set<string>();
  const placements: MenuPlacement[] = [];
  for (const placement of stored?.placements ?? []) {
    if (!started.has(placement.packId) || placed.has(placement.packId)) continue;
    placed.add(placement.packId);
    const folderId = placement.folderId !== null && folderIds.has(placement.folderId) ? placement.folderId : null;
    placements.push({ packId: placement.packId, folderId, hidden: placement.hidden });
  }

  for (const packId of startedPackIds) {
    if (placed.has(packId)) continue;
    placed.add(packId);
    placements.push({ packId, folderId: null, hidden: false });
  }

  return { folders, placements };
}
