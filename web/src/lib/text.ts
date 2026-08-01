/**
 * Small helpers shared by the surfaces.
 *
 * `pickTitle` resolves a pack's localized *metadata* — a block title a pack chose to author in both
 * languages. This is the one place localized pack data exists, and it is metadata, never material:
 * lesson prose, terms and translations are content and pass through untouched (ADR-0005).
 */

import type { Dictionary } from '@/i18n/dictionaries';
import type { ErrorStatus, Locale, TitleText } from './types';

export function pickTitle(title: TitleText | undefined, locale: Locale): string {
  if (!title) return '';
  if (typeof title === 'string') return title;
  return title[locale] ?? title[locale === 'nl' ? 'en' : 'nl'] ?? '';
}

export function formatDate(iso: string | undefined, locale: Locale): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function statusLabel(status: ErrorStatus, dictionary: Dictionary): string {
  switch (status) {
    case 'new':
      return dictionary.progress.statusNew;
    case 'recurring':
      return dictionary.progress.statusRecurring;
    case 'improving':
      return dictionary.progress.statusImproving;
    case 'mastered':
      return dictionary.progress.statusMastered;
  }
}

/** Colour by meaning: recurring is a problem, mastered is done, the rest sit in between. */
export function statusTone(status: ErrorStatus): 'muted' | 'primary' | 'success' | 'destructive' {
  switch (status) {
    case 'recurring':
      return 'destructive';
    case 'improving':
      return 'primary';
    case 'mastered':
      return 'success';
    case 'new':
      return 'muted';
  }
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
