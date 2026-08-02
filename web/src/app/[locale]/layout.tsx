/**
 * The locale layout: `<html lang>`, and the theme and palette machinery. The document, not the app.
 *
 * `lang` here is the **interface** language. Pack content carries its own `lang` where it is
 * rendered, which is what keeps a Dutch passage announced as Dutch inside an English interface
 * (ADR-0005).
 *
 * The theme and palette attributes are applied by a pre-paint script so there is no flash of the
 * wrong colours before React hydrates.
 *
 * Deliberately no chrome: the signed-in shell lives in `(app)/layout.tsx` and the sign-in surface in
 * `(auth)/layout.tsx`, so a page that nobody is signed in for cannot render a rail it has no data
 * for and no session behind.
 */

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { PaletteProvider } from '@/components/palette-provider';
import { isLocale, LOCALES } from '@/i18n/config';
import { DEFAULT_PALETTE, paletteStylesheet } from '@/lib/theme/palettes';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const themeInit = `(function(){try{var t=localStorage.getItem('sc.theme');if(t)document.documentElement.setAttribute('data-theme',t);var p=localStorage.getItem('sc.palette')||'${DEFAULT_PALETTE}';document.documentElement.setAttribute('data-palette',p);}catch(e){}})();`;

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale} suppressHydrationWarning>
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
