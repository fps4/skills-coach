/**
 * Search, as the web sees it (ADR-0030): the shape the api answers with, where each result leads,
 * and which key presses reach for the bar. Pure, so the rules are tested without a browser.
 */

export type SearchKind = 'guide' | 'card';

export interface SnippetPart {
  text: string;
  /** A word the query matched — rendered marked. */
  match?: boolean;
}

export interface SearchHit {
  kind: SearchKind;
  skillId: string;
  skillTitle: string;
  title: string;
  context: string;
  snippet: SnippetPart[];
  slug?: string;
  anchor?: string;
  blockId?: string;
  drillItemId?: string;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  total: number;
  counts: Record<SearchKind, number>;
  skills: { skillId: string; title: string; count: number }[];
}

/** The bar asks from the second character: one letter matches half the corpus as a prefix. */
export const MIN_QUERY_LENGTH = 2;

/** What the bar's popover shows; the results page shows more. */
export const SUGGESTION_LIMIT = 8;

/**
 * Where a result leads. A guide section opens at its heading; a card opens its deck in learn mode,
 * where the back is meant to be on screen and nothing is recorded (ADR-0027, ADR-0030).
 */
export function hitHref(hit: SearchHit): string {
  if (hit.kind === 'guide') {
    return `/guides/${hit.skillId}/${hit.slug ?? ''}${hit.anchor ? `#${hit.anchor}` : ''}`;
  }
  return `/flashcards?blockId=${encodeURIComponent(hit.blockId ?? '')}&mode=learn`;
}

/** The results page for a query, with its filters; unset filters are left out of the address. */
export function searchHref(q: string, filters: { kind?: SearchKind; skill?: string } = {}): string {
  const params = new URLSearchParams({ q: q.trim() });
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.skill) params.set('skill', filters.skill);
  return `/search?${params.toString()}`;
}

/**
 * Results grouped by kind, the group holding the best result first — and within a group, rank kept.
 * The flattened groups are also the order the arrow keys walk.
 */
export function groupHits(hits: readonly SearchHit[]): { kind: SearchKind; hits: SearchHit[] }[] {
  const groups = new Map<SearchKind, SearchHit[]>();
  for (const hit of hits) {
    const group = groups.get(hit.kind) ?? [];
    group.push(hit);
    groups.set(hit.kind, group);
  }
  return [...groups].map(([kind, grouped]) => ({ kind, hits: grouped }));
}

/** The parts of a keyboard event `focusesSearch` reads. A real `KeyboardEvent` satisfies it. */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
  target: EventTarget | null;
}

function typingInto(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'SELECT') return true;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
  const field = element as HTMLInputElement | HTMLTextAreaElement;
  return !field.readOnly && !field.disabled;
}

/**
 * True when a key press means "go to search": ⌘K or Ctrl-K from anywhere, or `/` when the learner is
 * not typing into something. Neither is in the flashcards' key map (ADR-0027 §6), which ignores
 * modified keys and leaves `/` unbound, so the two never compete.
 */
export function focusesSearch(event: KeyInput): boolean {
  if (event.defaultPrevented || event.altKey) return false;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') return true;
  if (event.metaKey || event.ctrlKey) return false;
  return event.key === '/' && !typingInto(event.target);
}
