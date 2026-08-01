/**
 * The locale layout: `<html lang>`, the theme and palette machinery, and the shell.
 *
 * `lang` here is the **interface** language. Pack content carries its own `lang` where it is
 * rendered, which is what keeps a Dutch passage announced as Dutch inside an English interface
 * (ADR-0005).
 *
 * The theme and palette attributes are applied by a pre-paint script so there is no flash of the
 * wrong colours before React hydrates.
 */

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { AppHeader } from '@/components/app-header';
import { LearnerRail } from '@/components/learner-rail';
import { PaletteProvider } from '@/components/palette-provider';
import { isLocale, LOCALES, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { api } from '@/lib/api';
import { DEFAULT_PALETTE, paletteStylesheet } from '@/lib/theme/palettes';
import type { PackProgress } from '@/lib/types';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const themeInit = `(function(){try{var t=localStorage.getItem('sc.theme');if(t)document.documentElement.setAttribute('data-theme',t);var p=localStorage.getItem('sc.palette')||'${DEFAULT_PALETTE}';document.documentElement.setAttribute('data-palette',p);}catch(e){}})();`;

/**
 * The block the rail should point its drills at. Resolved here so every page shares one lookup;
 * it fails softly, because the layout also renders for sign-in, where there is no session yet.
 */
async function currentBlockId(): Promise<string | null> {
  try {
    const { packs } = await api<{ packs: PackProgress[] }>('/api/v1/progress');
    return packs.find((entry) => entry.currentBlock)?.currentBlock?.blockId ?? null;
  } catch {
    return null;
  }
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dictionary = getDictionary(locale as Locale);
  const blockId = await currentBlockId();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: paletteStylesheet() }} />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <PaletteProvider>
          <AppHeader locale={locale as Locale} dictionary={dictionary} />
          <div className="flex min-h-[calc(100dvh-57px)]">
            <LearnerRail locale={locale as Locale} dictionary={dictionary} currentBlockId={blockId} />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </PaletteProvider>
      </body>
    </html>
  );
}
