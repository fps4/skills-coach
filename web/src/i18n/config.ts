/**
 * Locale handling for the **interface** (ADR-0005).
 *
 * This governs chrome only — navigation, labels, buttons, empty states. Pack content is authored in
 * the pack's own content language and renders exactly as written, in every interface language.
 * Nothing here ever touches content.
 */

export const LOCALES = ['nl', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'nl';

/** The cookie an explicit language switch writes, so the choice is sticky across visits. */
export const LOCALE_COOKIE = 'sc_locale';

export function isLocale(value: string | undefined | null): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The locale segment of a path, when it has one. */
export function localeFromPath(pathname: string): Locale | null {
  const segment = pathname.split('/')[1];
  return isLocale(segment) ? segment : null;
}

/** Swap the locale in a path, preserving everything after it. */
export function withLocale(pathname: string, locale: Locale): string {
  const segments = pathname.split('/');
  if (isLocale(segments[1])) {
    segments[1] = locale;
    return segments.join('/');
  }
  return `/${locale}${pathname === '/' ? '' : pathname}`;
}

/**
 * Pick a locale: an explicit choice beats a browser preference, which beats the default.
 * The learner's stored preference is applied by the layout once their profile is known — the
 * middleware runs before any API call, so it works from the cookie and the header alone.
 */
export function negotiateLocale(cookie: string | undefined, acceptLanguage: string | undefined): Locale {
  if (isLocale(cookie)) return cookie;

  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase();
    if (!tag) continue;
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
