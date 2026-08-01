/**
 * Reading a hand-maintained error-log table.
 *
 * Separate from the CLI that uses it (`import-error-log.ts`) so the parser can be imported and
 * tested without a module's top-level `main()` running as a side effect.
 *
 * The shape it reads is the one the source program kept by hand:
 *
 *   | Categorie | Voorbeeldfout | Correct | Eerst gezien | Laatst gezien | Keer | Status |
 */

import { deriveStatus } from '../domain/error-log.js';
import type { ErrorLogEntry } from '../domain/types.js';
import { parseTable } from './markdown.js';

const HEADER = /^(categorie|category)$/i;

/** Accepts a full date or just a year-month; anything unparseable falls back to the given date. */
function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const match = value.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return fallback;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? '01')));
}

export interface ParsedErrorRow {
  category: string;
  wrong: string;
  right: string;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
}

export function parseErrorLog(markdown: string, now: Date): ParsedErrorRow[] {
  const rows = parseTable(markdown).filter((row) => row.length >= 3 && !HEADER.test(row[0] as string));
  const parsed: ParsedErrorRow[] = [];

  for (const row of rows) {
    const category = (row[0] as string).trim();
    if (!category) continue;
    parsed.push({
      category,
      wrong: (row[1] ?? '').trim(),
      right: (row[2] ?? '').trim(),
      firstSeen: parseDate(row[3], now),
      lastSeen: parseDate(row[4], now),
      count: Math.max(1, Number(row[5] ?? '') || 1),
    });
  }
  return parsed;
}

function slug(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Match a hand-written category heading onto a pack's declared category id.
 *
 * This matters more than it looks. Categories are the join key between correction, drilling and
 * next-block generation — a backfilled row under an id the pack never declared would accumulate
 * quietly and never join anything, while new corrections (which *are* validated) piled up under the
 * real id. Two half-histories of the same mistake is worse than no history.
 *
 * A hand-maintained table writes "lidwoord (de/het)" where the manifest declares `lidwoord`, and
 * "onderwerp-werkwoord (congruentie)" where it declares `congruentie` — so the parenthetical is
 * tried both as decoration to strip and as the name itself.
 */
export function resolveCategory(raw: string, declared: string[]): string | null {
  const byId = new Map(declared.map((id) => [slug(id), id]));

  const withoutParenthetical = raw.replace(/\([^)]*\)/g, ' ');
  const parenthetical = raw.match(/\(([^)]*)\)/)?.[1] ?? '';

  for (const candidate of [raw, withoutParenthetical, parenthetical]) {
    const key = slug(candidate);
    if (!key) continue;
    const match = byId.get(key);
    if (match) return match;
  }
  return null;
}

export interface MappedRows {
  rows: (ParsedErrorRow & { category: string })[];
  /** Headings that matched no declared category — the caller must resolve these, not guess. */
  unresolved: { raw: string; count: number }[];
}

export function mapToDeclared(rows: ParsedErrorRow[], declared: string[]): MappedRows {
  const mapped: (ParsedErrorRow & { category: string })[] = [];
  const unresolved: { raw: string; count: number }[] = [];

  for (const row of rows) {
    const category = resolveCategory(row.category, declared);
    if (category) mapped.push({ ...row, category });
    else unresolved.push({ raw: row.category, count: row.count });
  }
  return { rows: mapped, unresolved };
}

/**
 * Turn parsed rows into error-log entries.
 *
 * Every entry lands with a clean run of zero and no closed blocks: a backfilled history has no
 * block structure to have been absent from, so a category earns its way to `mastered` through real
 * blocks in this system rather than arriving there.
 */
export function toEntries(rows: ParsedErrorRow[], learnerId: string, packId: string): ErrorLogEntry[] {
  return rows.map((row) => ({
    learnerId,
    packId,
    category: row.category,
    examples: row.wrong ? [{ wrong: row.wrong, right: row.right, at: row.lastSeen }] : [],
    count: row.count,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    lastBlockOrder: 0,
    closedThrough: 0,
    cleanBlocks: 0,
    status: deriveStatus(row.count, 0),
  }));
}
