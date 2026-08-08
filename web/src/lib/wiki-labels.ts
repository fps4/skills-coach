/**
 * The wiki's label contract, and the one function that filters on it.
 *
 * Pure and React-free on purpose, the same way `pack-scope.ts` is: the index page filters on the
 * server and the chip row renders on the client, and both have to agree about what a label means.
 * One derivation, two callers, no chance of the two disagreeing.
 *
 * **Label ids are content; their display names are chrome (ADR-0005).** A guide's frontmatter names
 * `topic: streaming`, and that slug is stable and language-free. What a learner reads on the chip
 * comes from the dictionary, so adding a third interface language never touches a guide.
 *
 * A guide declaring an id that is not here is a build failure, not a silently unfiltered tile —
 * see `wiki.test.ts`. That mirrors what `validate-manifests.ts` does for a pack.
 */

/**
 * What a guide is about. One per guide: this is the primary axis, so a guide that could plausibly
 * sit in two topics picks the one a reader would look under first, and reaches the other through
 * `tags`.
 */
export const TOPICS = [
  'data-engineering',
  'streaming',
  'ml-ai',
  'governance',
  'architecture',
  'integration',
  'enterprise',
  'app-development',
] as const;

export type WikiTopic = (typeof TOPICS)[number];

/**
 * How deep the guide goes, which is the question a reader actually asks second.
 *
 * These are a promise about depth, not a rating of the reader: `awareness` means "enough to hold a
 * conversation and know what you do not know", `deep-dive` means the mechanics with runnable
 * examples.
 */
export const FORMATS = ['refresher', 'primer', 'guide', 'deep-dive', 'awareness'] as const;

export type WikiFormat = (typeof FORMATS)[number];

/** The frontmatter every guide carries, after parsing. */
export interface WikiMeta {
  /** The filename without `.md`, and the URL segment. */
  slug: string;
  title: string;
  /** One line, for the tile. Distinct from the title — it says what you get, not what it is called. */
  summary: string;
  topic: WikiTopic;
  format: WikiFormat;
  /** Free secondary labels. Searched, never turned into chips — the chip rows stay two. */
  tags: string[];
  /** ISO date the guide was last revised. */
  updated: string;
}

/** A parsed guide: its labels, plus the markdown body with the frontmatter removed. */
export interface WikiGuide extends WikiMeta {
  body: string;
}

export function isTopic(value: unknown): value is WikiTopic {
  return typeof value === 'string' && (TOPICS as readonly string[]).includes(value);
}

export function isFormat(value: unknown): value is WikiFormat {
  return typeof value === 'string' && (FORMATS as readonly string[]).includes(value);
}

/** What the index page filters by, straight off the query string. */
export interface WikiFilter {
  topic?: string | null;
  format?: string | null;
  /** Free text. Every whitespace-separated term has to match somewhere. */
  q?: string | null;
}

/**
 * Does this guide survive the filter?
 *
 * An unrecognised topic or format in the *query string* narrows to nothing rather than being
 * ignored: a URL someone shared should either show what they saw or show that it is empty, never
 * silently show everything.
 */
export function matches(guide: WikiMeta, filter: WikiFilter): boolean {
  if (filter.topic && guide.topic !== filter.topic) return false;
  if (filter.format && guide.format !== filter.format) return false;

  const terms = (filter.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = [guide.title, guide.summary, ...guide.tags].join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * How many guides each value of one axis would leave, given everything *else* in the filter.
 *
 * Counting against the rest of the filter rather than the whole corpus is what makes the chips
 * honest: with `streaming` selected, the format row shows how many streaming guides are refreshers,
 * so a chip reading `0` is a real dead end and can be shown as one.
 */
export function counts<T extends string>(
  guides: WikiMeta[],
  values: readonly T[],
  axis: 'topic' | 'format',
  filter: WikiFilter,
): Record<T, number> {
  const rest: WikiFilter = { ...filter, [axis]: null };
  const tally = Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;

  for (const guide of guides) {
    if (!matches(guide, rest)) continue;
    const value = guide[axis] as T;
    if (value in tally) tally[value] += 1;
  }
  return tally;
}

/** The filter as a query string, with empty values dropped so a cleared filter is a clean URL. */
export function toQuery(filter: WikiFilter): string {
  const params = new URLSearchParams();
  if (filter.topic) params.set('topic', filter.topic);
  if (filter.format) params.set('format', filter.format);
  if (filter.q) params.set('q', filter.q);
  const query = params.toString();
  return query ? `?${query}` : '';
}
