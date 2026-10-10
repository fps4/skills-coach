/**
 * The interface used to carry its language in the first path segment — `/nl/words`, `/en/words`.
 * It no longer does (ADR-0025), but those URLs live on in bookmarks, browser history and links
 * people sent themselves, so the middleware redirects them rather than letting them 404.
 *
 * Pure, so the rule is tested rather than discovered: only the two locales that ever shipped are
 * stripped. Any other first segment is a route, not a language.
 */

const RETIRED_LOCALES = ['nl', 'en'];

/** The path without its retired locale segment, or null when it never had one. */
export function withoutRetiredLocale(pathname: string): string | null {
  const [, first, ...rest] = pathname.split('/');
  if (first === undefined || !RETIRED_LOCALES.includes(first)) return null;
  const remainder = rest.join('/');
  return remainder ? `/${remainder}` : '/';
}
