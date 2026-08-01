import Link from 'next/link';

import { PaletteToggle } from '@/components/palette-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitch } from '@/components/language-switch';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

/** The sticky brand header. The wordmark carries the accent, so the palette is visible at a glance. */
export function AppHeader({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-card/80 px-5 py-3 backdrop-blur">
      <Link href={`/${locale}`} className="text-base font-bold tracking-tight">
        Skills <span className="text-primary">Coach</span>
      </Link>
      <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground sm:inline">
        {dictionary.chrome.tagline}
      </span>

      <div className="flex-1" />

      <nav className="flex items-center gap-1">
        <LanguageSwitch locale={locale} label={dictionary.nav.language} />
        <PaletteToggle label={dictionary.chrome.palette} />
        <ThemeToggle label={dictionary.chrome.theme} />
      </nav>
    </header>
  );
}
