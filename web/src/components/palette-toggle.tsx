'use client';

/**
 * The palette picker: a swatch menu beside the light/dark toggle. Selection routes through
 * `PaletteProvider`, which reflects it on `<html>` and persists it.
 */

import { Check, Palette as PaletteIcon } from 'lucide-react';
import * as React from 'react';

import { usePalette } from '@/components/palette-provider';
import { Button } from '@/components/ui/button';
import { PALETTES } from '@/lib/theme/palettes';
import { cn } from '@/lib/utils';

export function PaletteToggle({ label }: { label: string }) {
  const { palette, setPalette } = usePalette();
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground hover:text-foreground"
      >
        <PaletteIcon className="h-4 w-4" />
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 z-50 mt-2 min-w-44 rounded-md border border-border bg-card p-1 text-card-foreground shadow-card"
        >
          {PALETTES.map((entry) => {
            const active = entry.id === palette;
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setPalette(entry.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
                  'hover:bg-muted focus-visible:bg-muted',
                  active && 'font-medium',
                )}
              >
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: entry.swatch }}
                />
                <span className="flex-1 text-left">{entry.label}</span>
                {active ? <Check className="h-4 w-4" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
