'use client';

/**
 * Switching the interface language.
 *
 * It swaps the locale segment of the current path and writes the choice to a cookie, so it survives
 * the next visit and the middleware honours it before any page renders. Pack content is untouched:
 * a Dutch lesson stays Dutch in the English interface (ADR-0005).
 */

import { Languages } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { LOCALE_COOKIE, withLocale, type Locale } from '@/i18n/config';

export function LanguageSwitch({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();

  const swap = (): void => {
    const next: Locale = locale === 'nl' ? 'en' : 'nl';
    // A year is long enough to feel remembered without being permanent.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    const query = search.toString();
    router.push(withLocale(pathname, next) + (query ? `?${query}` : ''));
    router.refresh();
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={swap}
      title={label}
      aria-label={label}
      className="gap-1.5 text-muted-foreground hover:text-foreground"
    >
      <Languages className="h-4 w-4" />
      <span className="text-xs font-semibold uppercase">{locale}</span>
    </Button>
  );
}
