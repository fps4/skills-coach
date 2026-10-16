/**
 * What search finds, and how it shows why (ADR-0030).
 *
 * The index itself is a library held in the api's memory (`services/search.ts`). Everything that
 * decides something lives here, pure: how a guide becomes sections and a card becomes a document,
 * how text is cut into terms, who may see a result, how many sections of one guide a result list
 * carries, and which words of a snippet are marked. The engine and the snippet use the same
 * tokenizer and the same normalisation, so a highlighted word is always one that matched.
 */

import GithubSlugger from 'github-slugger';
import type { DrillItem } from './types.js';

export type SearchKind = 'guide' | 'card';

/**
 * One thing a search can return. Guides are split into sections so a result lands where the
 * phrase is; a card is one document. Fields are what the engine indexes, weighted by `SEARCH_BOOSTS`.
 */
export interface SearchDocument {
  /** `g:<skill>/<slug>#<anchor>` or `c:<drillItemId>` — unique across both kinds. */
  id: string;
  kind: SearchKind;
  skillId: string;
  /** A section's heading, or a card's front. */
  title: string;
  /** The guide a section is in, or the card's group. */
  context: string;
  /** A section's text, or a card's back. */
  body: string;
  /** What else a card carries — its cue, example, analogy, note. Empty for a guide. */
  extra: string;
  /** Guide sections: the guide's slug, and the heading anchor the page renders (none for the top). */
  slug?: string;
  anchor?: string;
  /** Cards: the deck it is in, and who may see it — absent means everyone. */
  blockId?: string;
  drillItemId?: string;
  learnerId?: string;
}

export const SEARCH_FIELDS = ['title', 'context', 'body', 'extra'] as const;

/** A heading or a card's front outranks the guide it is in, which outranks running text. */
export const SEARCH_BOOSTS: Record<(typeof SEARCH_FIELDS)[number], number> = {
  title: 3,
  context: 1.5,
  body: 1,
  extra: 0.75,
};

/** How many sections of one guide a result list shows before the rest are folded away. */
export const SECTIONS_PER_GUIDE = 3;

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/** A run of letters, digits and combining marks. Punctuation and symbols separate terms. */
const TOKEN = /[\p{L}\p{N}\p{M}]+/gu;

/**
 * Words too common to search on, in the two languages skills are written in today (ADR-0026).
 * Dropped from the index and from the query alike, so "what is a watermark" asks for `watermark`.
 */
const STOP_WORDS = new Set([
  // English
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  // Dutch
  'aan',
  'dat',
  'de',
  'die',
  'een',
  'en',
  'er',
  'het',
  'met',
  'op',
  'te',
  'van',
  'voor',
]);

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Lower-cased, accents folded — `Café` and `cafe` are one term, and so are `één` and `een`. */
export function foldTerm(term: string): string {
  return term.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** A term as the engine stores and looks it up, or `null` when it is too common to search on. */
export function normalizeTerm(term: string): string | null {
  const folded = foldTerm(term);
  if (folded.length === 0 || STOP_WORDS.has(folded)) return null;
  return folded;
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

export interface GuideSource {
  skillId: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
}

/**
 * A guide file: `title` and `summary` between `---` fences, then markdown.
 *
 * The same contract `web/src/lib/guides.ts` reads, parsed the same dependency-free way; the two
 * packages share no code (CODEBASE.md), and `tests/unit/search.test.ts` holds this parser to every
 * committed guide. `null` when either key is missing — such a file is not a guide.
 */
export function parseGuideSource(skillId: string, slug: string, source: string): GuideSource | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) fields[key] = value.replace(/^["']|["']$/g, '');
  }
  if (!fields.title || !fields.summary) return null;
  return {
    skillId,
    slug,
    title: fields.title,
    summary: fields.summary,
    body: source.slice(match[0].length).trimStart(),
  };
}

/** Inline markdown reduced to the text a reader sees: links to their label, emphasis and code ticks gone. */
function inlineText(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/(^|\s)\*(\S)/g, '$1$2')
    .replace(/(\S)\*(\s|$)/g, '$1$2');
}

/**
 * Markdown as plain running text: what a snippet can show and what is worth indexing.
 *
 * Code inside fences is kept — a learner searches for `join_asof` as often as for a sentence — but
 * the fence lines go, and so do list markers, quote markers and table rules.
 */
export function plainText(markdown: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push(raw.trim());
      continue;
    }
    if (/^\s*\|?\s*:?-{3,}/.test(raw)) continue; // a table's rule row
    const line = inlineText(raw)
      .replace(/^\s*>+\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/\|/g, ' ');
    out.push(line.trim());
  }
  return out.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * A guide as search documents: one for the guide as a whole (its title, summary and whatever
 * precedes the first heading), then one per `#`–`###` section.
 *
 * Anchors are what `rehype-slug` gives the rendered page: `github-slugger` over the visible text of
 * **every** heading, in order, one slugger per page — deeper headings included, because they take
 * their slugs from the same counter even though they do not start a section here. Headings inside
 * code fences are not headings (a shell comment is not a section).
 */
export function guideDocuments(guide: GuideSource): SearchDocument[] {
  const slugger = new GithubSlugger();
  const base = `g:${guide.skillId}/${guide.slug}`;
  const common = { kind: 'guide' as const, skillId: guide.skillId, slug: guide.slug, extra: '' };

  const sections: { heading?: string; anchor?: string; lines: string[] }[] = [{ lines: [] }];
  let fenced = false;
  for (const line of guide.body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(line);
    if (!heading) {
      sections[sections.length - 1]!.lines.push(line);
      continue;
    }
    const text = inlineText(heading[2] ?? '').trim();
    const anchor = slugger.slug(text);
    if ((heading[1] ?? '').length <= 3) sections.push({ heading: text, anchor, lines: [] });
    else sections[sections.length - 1]!.lines.push(text);
  }

  const [top, ...rest] = sections;
  const documents: SearchDocument[] = [
    {
      ...common,
      id: base,
      title: guide.title,
      context: '',
      body: [guide.summary, plainText(top!.lines.join('\n'))].filter(Boolean).join(' '),
    },
  ];
  for (const section of rest) {
    documents.push({
      ...common,
      id: `${base}#${section.anchor}`,
      title: section.heading ?? '',
      context: guide.title,
      body: plainText(section.lines.join('\n')),
      anchor: section.anchor,
    });
  }
  return documents;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * A card as a search document, or `null` for anything that is not a card.
 *
 * Only `term` items are reference material; a sentence puzzle or a multiple-choice key is an
 * exercise, and finding one by its answer would be finding the answer. `owner` is the block's, for
 * an item written before visibility was stamped onto items (ADR-0015).
 */
export function cardDocument(item: DrillItem, owner?: string): SearchDocument | null {
  const payload = item.payload;
  if (payload.kind !== 'term') return null;
  const details = payload.details ?? {};
  const learnerId = item.learnerId ?? owner;

  const extra = [
    payload.hint,
    payload.example,
    details.exampleTranslation,
    details.analogy,
    details.note,
    details.synonyms?.join(', '),
    details.code,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' — ');

  return {
    id: `c:${item.drillItemId}`,
    kind: 'card',
    skillId: item.packId,
    title: payload.term,
    context: payload.group ?? '',
    body: payload.translation,
    extra,
    blockId: item.blockId,
    drillItemId: item.drillItemId,
    ...(learnerId ? { learnerId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Who sees what, and how much
// ---------------------------------------------------------------------------

/**
 * A guide is everyone's; a card is everyone's unless it carries a learner, and then it is only
 * theirs (ADR-0012, ADR-0015). Search must not be the one surface where somebody's own words show.
 */
export const visibleTo = (document: Pick<SearchDocument, 'learnerId'>, learnerId: string): boolean =>
  document.learnerId === undefined || document.learnerId === learnerId;

/**
 * Ranked results, with each guide folded to its best few sections.
 *
 * Without this a query naming a guide's subject returns that guide thirty times and nothing else.
 * Order is kept: a folded section simply does not appear.
 */
export function foldGuides<T extends Pick<SearchDocument, 'kind' | 'skillId' | 'slug'>>(
  ranked: readonly T[],
  perGuide = SECTIONS_PER_GUIDE,
): T[] {
  const seen = new Map<string, number>();
  return ranked.filter((hit) => {
    if (hit.kind !== 'guide') return true;
    const key = `${hit.skillId}/${hit.slug}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count < perGuide;
  });
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

export interface SnippetPart {
  text: string;
  /** True on a word the query matched. */
  match?: boolean;
}

export const SNIPPET_LENGTH = 180;

/** The first term in `text` the query matched, by character offset — or -1. */
function firstMatch(text: string, matched: ReadonlySet<string>): number {
  for (const token of text.matchAll(TOKEN)) {
    if (matched.has(foldTerm(token[0]))) return token.index ?? 0;
  }
  return -1;
}

/**
 * A window of `text` around the first matched term, split into marked and unmarked runs.
 *
 * `matched` holds terms as the engine stores them (folded), so a word is marked when it folds to one
 * of them — `Café` is marked for a query that matched `cafe`. The window starts a little before the
 * first match so the word has context, and both ends fall on a space; an ellipsis says where text was
 * cut. With no match the window is the start of the text, unmarked.
 */
export function snippet(text: string, matched: ReadonlySet<string>, length = SNIPPET_LENGTH): SnippetPart[] {
  if (!text) return [];
  const at = firstMatch(text, matched);

  let start = at <= 0 ? 0 : Math.max(0, at - Math.floor(length / 3));
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space === -1 || space >= at ? start : space + 1;
  }
  let end = Math.min(text.length, start + length);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start) end = space;
  }

  const window = text.slice(start, end);
  const parts: SnippetPart[] = [];
  const push = (part: string, match: boolean) => {
    if (!part) return;
    const last = parts[parts.length - 1];
    if (last && Boolean(last.match) === match) last.text += part;
    else parts.push(match ? { text: part, match: true } : { text: part });
  };

  if (start > 0) push('… ', false);
  let cursor = 0;
  for (const token of window.matchAll(TOKEN)) {
    const index = token.index ?? 0;
    if (!matched.has(foldTerm(token[0]))) continue;
    push(window.slice(cursor, index), false);
    push(token[0], true);
    cursor = index + token[0].length;
  }
  push(window.slice(cursor), false);
  if (end < text.length) push(' …', false);
  return parts;
}

/**
 * The snippet for a result: from the first field, body then extra, that holds a matched term — a
 * card found by its analogy shows the analogy — and from the body when none does.
 */
export function snippetFor(
  document: Pick<SearchDocument, 'body' | 'extra'>,
  matched: ReadonlySet<string>,
): SnippetPart[] {
  for (const field of [document.body, document.extra]) {
    if (field && firstMatch(field, matched) !== -1) return snippet(field, matched);
  }
  return snippet(document.body || document.extra, matched);
}
