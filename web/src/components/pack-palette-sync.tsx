'use client';

/**
 * Keeps the palette in step with the pack the learner is looking at.
 *
 * Renders nothing. It exists because the hue is a document-level attribute while the pack is a
 * property of the URL, and the shell that owns the document sits *above* the segment that names the
 * pack — so the pack has to be re-derived on the client, where every navigation is observable.
 * `packIdFromUrl` is the same function the middleware uses for the first paint, which is what keeps
 * a full page load and a client navigation from disagreeing.
 */

import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { usePalette } from '@/components/palette-provider';
import { packIdFromUrl } from '@/lib/pack-scope';

export function PackPaletteSync({ palettes }: { palettes: Record<string, string | undefined> }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setPackPalette } = usePalette();

  const packId = packIdFromUrl(pathname, searchParams);
  // Outside a pack there is no pack palette, so the learner's choice or the default applies.
  const palette = packId ? palettes[packId] : undefined;

  React.useEffect(() => {
    setPackPalette(palette);
  }, [palette, setPackPalette]);

  return null;
}
