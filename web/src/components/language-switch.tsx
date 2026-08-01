'use client';

/**
 * Switching the interface language.
 *
 * It swaps the locale segment of the current path and writes the choice to a cookie, so it survives
 * the next visit and the middleware honours it before any page renders. Pack content is untouched:
 * a Dutch lesson stays Dutch in the English interface (ADR-0005).
 */

import { usePathname, useRouter } from 'next/navigation';
import { LOCALES, LOCALE_COOKIE, withLocale, type Locale } from '@/i18n/config';

export function LanguageSwitch({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const choose = (next: Locale): void => {
    if (next === locale) return;
    // A year is long enough to be "remembered" without being permanent.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.push(withLocale(pathname, next));
    router.refresh();
  };

  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => choose(option)}
          aria-current={option === locale ? 'true' : undefined}
          className={
            option === locale
              ? 'rounded-md bg-accent px-2 py-1 text-xs font-semibold uppercase text-accent-ink'
              : 'rounded-md px-2 py-1 text-xs font-semibold uppercase text-muted transition hover:text-ink'
          }
        >
          {option}
        </button>
      ))}
    </div>
  );
}
