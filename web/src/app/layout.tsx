/**
 * The root layout: `<html lang>`, and the theme and palette machinery. The document, not the app.
 *
 * `lang` here is the **interface** language, which is English and nothing else (ADR-0025). Pack
 * content carries its own `lang` where it is rendered, which is what keeps a Dutch passage announced
 * as Dutch inside the English interface (ADR-0005).
 *
 * The theme and palette attributes are applied by a pre-paint script so there is no flash of the
 * wrong colours before React hydrates.
 *
 * Deliberately no chrome: the signed-in shell lives in `(app)/layout.tsx` and the sign-in surface in
 * `(auth)/layout.tsx`, so a page that nobody is signed in for cannot render a rail it has no data
 * for and no session behind.
 */

import type { ReactNode } from 'react';
import './globals.css';

import { PaletteProvider } from '@/components/palette-provider';
import { DEFAULT_PALETTE, paletteStylesheet } from '@/lib/theme/palettes';

export const metadata = {
  title: 'Skills Coach',
  description: 'A personalizable, pack-driven training platform.',
};

const themeInit = `(function(){try{var t=localStorage.getItem('sc.theme');if(t)document.documentElement.setAttribute('data-theme',t);var p=localStorage.getItem('sc.palette')||'${DEFAULT_PALETTE}';document.documentElement.setAttribute('data-palette',p);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: paletteStylesheet() }} />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <PaletteProvider>{children}</PaletteProvider>
      </body>
    </html>
  );
}
