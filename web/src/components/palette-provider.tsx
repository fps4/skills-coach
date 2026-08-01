'use client';

/**
 * The colour-palette axis, orthogonal to light/dark.
 *
 * The chosen palette is written to localStorage and reflected as `data-palette` on `<html>`; the
 * CSS rules per palette come from the generated stylesheet in `lib/theme/palettes.ts`, emitted once
 * in the layout head.
 *
 * A pre-paint script in the layout sets the attribute before React hydrates, so there is no flash.
 * This provider only keeps the React state in step and exposes the setter to the picker.
 */

import * as React from 'react';

import { DEFAULT_PALETTE, PALETTES } from '@/lib/theme/palettes';

const STORAGE_KEY = 'sc.palette';

type PaletteContextValue = {
  palette: string;
  setPalette: (id: string) => void;
};

const PaletteContext = React.createContext<PaletteContextValue>({
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
});

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPaletteState] = React.useState(DEFAULT_PALETTE);

  // After mount, adopt whatever the pre-paint script already applied, so the picker shows the
  // persisted choice rather than the default.
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && PALETTES.some((entry) => entry.id === stored)) setPaletteState(stored);
    } catch {
      // Storage unavailable — keep the default.
    }
  }, []);

  const setPalette = React.useCallback((id: string) => {
    if (!PALETTES.some((entry) => entry.id === id)) return;
    setPaletteState(id);
    document.documentElement.setAttribute('data-palette', id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Ignore a persistence failure; the choice still applies for this session.
    }
  }, []);

  return <PaletteContext.Provider value={{ palette, setPalette }}>{children}</PaletteContext.Provider>;
}

export function usePalette(): PaletteContextValue {
  return React.useContext(PaletteContext);
}
