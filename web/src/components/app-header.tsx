import Link from 'next/link';

import { PaletteToggle } from '@/components/palette-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOut } from '@/components/sign-out';
import type { Dictionary } from '@/i18n/dictionaries';

/** The sticky brand header. The wordmark carries the accent, so the palette is visible at a glance. */
export function AppHeader({ dictionary }: { dictionary: Dictionary }) {
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-card/80 px-5 py-3 backdrop-blur">
      <Link href="/" className="text-base font-bold tracking-tight">
        Skills <span className="text-primary">Coach</span>
      </Link>
      <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground sm:inline">
        {dictionary.chrome.tagline}
      </span>

      <div className="flex-1" />

      <nav className="flex items-center gap-1">
        <PaletteToggle label={dictionary.chrome.palette} followLabel={dictionary.chrome.followPack} />
        <ThemeToggle label={dictionary.chrome.theme} />
        {/* Last, and separated: it leaves the app, unlike everything to its left. */}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <SignOut label={dictionary.nav.signOut} />
      </nav>
    </header>
  );
}
