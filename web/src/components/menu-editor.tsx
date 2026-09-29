'use client';

/**
 * Organising the menu: folders, which folder a skill is in, and which skills show (ADR-0021).
 *
 * Every change saves at once — the whole menu, replaced, which is what the api takes — and then
 * refreshes the shell so the rail follows. The api reconciles whatever is sent with what the learner
 * has started, so nothing here has to guard against losing a skill; it only has to say what the
 * learner asked for.
 *
 * Reordering is up and down buttons, deliberately. Drag and drop is nicer with a mouse and worse
 * with a keyboard or a screen reader; buttons are the version everyone can use, and dragging can be
 * layered on top later without changing what gets saved.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Folder, FolderPlus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { clientApi } from '@/lib/api-client';
import { packIcon } from '@/lib/pack-scope';
import { pickTitle } from '@/lib/text';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import type { LearnerMenu, MenuPlacement, TitleText } from '@/lib/types';

export interface MenuSkill {
  packId: string;
  title: TitleText;
  icon?: string;
  /** One line under the name — what the skill is, in its own words. */
  description?: TitleText;
}

interface Props {
  locale: Locale;
  dictionary: Dictionary;
  initial: LearnerMenu;
  skills: MenuSkill[];
}

/** Short, random and slug-shaped, which is all the api asks of a folder id. */
const newFolderId = (): string => `f${Math.random().toString(36).slice(2, 10)}`;

export function MenuEditor({ locale, dictionary, initial, skills }: Props) {
  const t = dictionary.menu;
  const router = useRouter();
  const [menu, setMenu] = useState<LearnerMenu>(initial);
  const [error, setError] = useState<string | null>(null);
  const [focusFolder, setFocusFolder] = useState<string | null>(null);

  const skillById = new Map(skills.map((skill) => [skill.packId, skill]));

  const save = async (next: LearnerMenu): Promise<void> => {
    const previous = menu;
    setMenu(next);
    setError(null);
    try {
      const { menu: saved } = await clientApi<{ menu: LearnerMenu }>('/v1/me/menu', { method: 'PUT', body: next });
      setMenu(saved);
      router.refresh();
    } catch {
      setMenu(previous);
      setError(t.saveFailed);
    }
  };

  const updatePlacement = (packId: string, change: Partial<MenuPlacement>): void => {
    void save({
      ...menu,
      placements: menu.placements.map((entry) => (entry.packId === packId ? { ...entry, ...change } : entry)),
    });
  };

  /** Move a skill past its neighbour in the same folder. The order of every other skill is kept. */
  const moveSkill = (packId: string, direction: -1 | 1): void => {
    const index = menu.placements.findIndex((entry) => entry.packId === packId);
    const self = menu.placements[index];
    if (!self) return;
    let other = index + direction;
    while (other >= 0 && other < menu.placements.length && menu.placements[other]?.folderId !== self.folderId) other += direction;
    if (other < 0 || other >= menu.placements.length) return;
    const placements = [...menu.placements];
    [placements[index], placements[other]] = [placements[other]!, placements[index]!];
    void save({ ...menu, placements });
  };

  const moveFolder = (folderId: string, direction: -1 | 1): void => {
    const index = menu.folders.findIndex((entry) => entry.folderId === folderId);
    const other = index + direction;
    if (index < 0 || other < 0 || other >= menu.folders.length) return;
    const folders = [...menu.folders];
    [folders[index], folders[other]] = [folders[other]!, folders[index]!];
    void save({ ...menu, folders });
  };

  const addFolder = (): void => {
    const folderId = newFolderId();
    setFocusFolder(folderId);
    void save({ ...menu, folders: [...menu.folders, { folderId, name: t.newFolderName }] });
  };

  const renameFolder = (folderId: string, name: string): void => {
    const current = menu.folders.find((entry) => entry.folderId === folderId);
    if (!current || current.name === name.trim()) return;
    void save({ ...menu, folders: menu.folders.map((entry) => (entry.folderId === folderId ? { ...entry, name } : entry)) });
  };

  /** Its skills stay — they move out of the folder, exactly where they were in the order. */
  const deleteFolder = (folderId: string): void => {
    void save({
      folders: menu.folders.filter((entry) => entry.folderId !== folderId),
      placements: menu.placements.map((entry) => (entry.folderId === folderId ? { ...entry, folderId: null } : entry)),
    });
  };

  const row = (placement: MenuPlacement, first: boolean, last: boolean) => {
    const skill = skillById.get(placement.packId);
    if (!skill) return null;
    const Icon = packIcon(skill.icon);
    const title = pickTitle(skill.title, locale);

    return (
      <li
        key={placement.packId}
        className="flex flex-wrap items-center gap-3 border-t border-border/60 px-4 py-3 first:border-t-0"
      >
        <Icon className={cn('h-4 w-4 shrink-0', placement.hidden ? 'text-muted-foreground/60' : 'text-primary')} />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm font-medium', placement.hidden && 'text-muted-foreground')}>{title}</p>
          {skill.description ? (
            <p className="truncate text-xs text-muted-foreground">{pickTitle(skill.description, locale)}</p>
          ) : null}
        </div>

        <label className="sr-only" htmlFor={`folder-${placement.packId}`}>
          {t.folder}: {title}
        </label>
        <select
          id={`folder-${placement.packId}`}
          value={placement.folderId ?? ''}
          onChange={(event) => updatePlacement(placement.packId, { folderId: event.target.value || null })}
          className="h-9 max-w-44 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">{t.noFolder}</option>
          {menu.folders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          role="switch"
          aria-checked={!placement.hidden}
          aria-label={`${t.inMenu}: ${title}`}
          onClick={() => updatePlacement(placement.packId, { hidden: !placement.hidden })}
          className={cn(
            'relative h-6 w-10 shrink-0 rounded-full transition-colors',
            placement.hidden ? 'bg-muted' : 'bg-primary',
          )}
        >
          <span
            className={cn(
              'absolute top-1 h-4 w-4 rounded-full transition-all',
              placement.hidden ? 'left-1 bg-muted-foreground' : 'left-5 bg-primary-foreground',
            )}
          />
        </button>

        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${t.moveUp}: ${title}`}
            disabled={first}
            onClick={() => moveSkill(placement.packId, -1)}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${t.moveDown}: ${title}`}
            disabled={last}
            onClick={() => moveSkill(placement.packId, 1)}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      </li>
    );
  };

  const group = (folderId: string | null) => {
    const placements = menu.placements.filter((entry) => entry.folderId === folderId && skillById.has(entry.packId));
    return { placements, shown: placements.filter((entry) => !entry.hidden).length };
  };

  const loose = group(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" role="status">
          {error}
        </p>
        <Button variant="outline" onClick={addFolder}>
          <FolderPlus className="mr-2 h-4 w-4" />
          {t.newFolder}
        </Button>
      </div>

      {menu.folders.map((folder, index) => {
        const { placements, shown } = group(folder.folderId);
        return (
          <Card key={folder.folderId} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
              <Folder className="h-4 w-4 shrink-0 text-primary" />
              <label className="sr-only" htmlFor={`name-${folder.folderId}`}>
                {t.folderName}
              </label>
              <input
                id={`name-${folder.folderId}`}
                defaultValue={folder.name}
                maxLength={60}
                autoFocus={focusFolder === folder.folderId}
                onFocus={(event) => (focusFolder === folder.folderId ? event.target.select() : undefined)}
                onBlur={(event) => renameFolder(folder.folderId, event.target.value)}
                onKeyDown={(event) => (event.key === 'Enter' ? event.currentTarget.blur() : undefined)}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold hover:border-border focus-visible:border-border focus-visible:outline-none"
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {shown}/{placements.length} {t.shown}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t.moveUp}: ${folder.name}`}
                disabled={index === 0}
                onClick={() => moveFolder(folder.folderId, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t.moveDown}: ${folder.name}`}
                disabled={index === menu.folders.length - 1}
                onClick={() => moveFolder(folder.folderId, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t.deleteFolder}: ${folder.name}`}
                onClick={() => deleteFolder(folder.folderId)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {placements.length > 0 ? (
              <ul>{placements.map((entry, at) => row(entry, at === 0, at === placements.length - 1))}</ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t.emptyFolder}</p>
            )}
          </Card>
        );
      })}

      {loose.placements.length > 0 ? (
        <Card className="overflow-hidden border-dashed">
          <p className="border-b border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground">
            {t.loose} · {loose.shown}/{loose.placements.length} {t.shown}
          </p>
          <ul>{loose.placements.map((entry, at) => row(entry, at === 0, at === loose.placements.length - 1))}</ul>
        </Card>
      ) : null}

      {menu.placements.length === 0 ? <p className="text-sm text-muted-foreground">{t.empty}</p> : null}
    </div>
  );
}
