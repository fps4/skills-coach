'use client';

/**
 * The colour-palette axis, orthogonal to light/dark.
 *
 * Two inputs decide the hue, and the precedence between them is the whole point (ADR-0009):
 * **an explicit choice wins, otherwise the pack's palette, otherwise the default.** `sc.palette` is
 * written only when the learner picks one, so its presence already means "they chose" — which is
 * what lets a pack colour the app without ever overriding a person.
 *
 * The attribute is applied as `data-palette` on `<html>`; the CSS per palette comes from the
 * generated stylesheet in `lib/theme/palettes.ts`. A pre-paint script has already applied the stored
 * choice before React hydrates, so nothing here runs until storage has been read — otherwise the
 * first commit would clobber a stored palette with the default for a frame.
 */

import * as React from 'react';

import { resolvePalette } from '@/lib/pack-scope';
import { PALETTES } from '@/lib/theme/palettes';

const STORAGE_KEY = 'sc.palette';

type PaletteContextValue = {
  /** What is actually applied. */
  palette: string;
  /** The learner's explicit choice, if they have made one. */
  pinned: string | null;
  /** The active pack's palette, if a pack is in scope and declares one. */
  packPalette: string | undefined;
  /** Pick a hue and keep it everywhere. */
  setPalette: (id: string) => void;
  /** Drop the choice and take each pack's colour again. */
  followPack: () => void;
  /** Set by the pack-scope sync as the learner moves between packs. */
  setPackPalette: (id: string | undefined) => void;
};

const PaletteContext = React.createContext<PaletteContextValue>({
  palette: resolvePalette(null, undefined),
  pinned: null,
  packPalette: undefined,
  setPalette: () => {},
  followPack: () => {},
  setPackPalette: () => {},
});

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [pinned, setPinned] = React.useState<string | null>(null);
  const [packPalette, setPackPalette] = React.useState<string | undefined>(undefined);
  const [storageRead, setStorageRead] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && PALETTES.some((entry) => entry.id === stored)) setPinned(stored);
    } catch {
      // Storage unavailable — nothing is pinned, so packs colour the app.
    }
    setStorageRead(true);
  }, []);

  const palette = resolvePalette(pinned, packPalette);

  React.useEffect(() => {
    // Until storage has been read we do not know whether anything is pinned, and applying a guess
    // would undo what the pre-paint script correctly put there.
    if (!storageRead) return;
    document.documentElement.setAttribute('data-palette', palette);
  }, [palette, storageRead]);

  const setPalette = React.useCallback((id: string) => {
    if (!PALETTES.some((entry) => entry.id === id)) return;
    setPinned(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Ignore a persistence failure; the choice still applies for this session.
    }
  }, []);

  const followPack = React.useCallback(() => {
    setPinned(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Same again: the change applies now regardless.
    }
  }, []);

  const value = React.useMemo(
    () => ({ palette, pinned, packPalette, setPalette, followPack, setPackPalette }),
    [palette, pinned, packPalette, setPalette, followPack],
  );

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette(): PaletteContextValue {
  return React.useContext(PaletteContext);
}
