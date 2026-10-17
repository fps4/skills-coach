/**
 * Topics, as the web sees them (ADR-0031, ADR-0032): the shape the api reports a deck's topics in,
 * where a topic opens, what it is called, and which topics a guide is practised in. Pure, so the
 * overview's tiles, the flashcards' picker and a guide's footer build the same links.
 */

import type { DeckSummary } from './types';

/** The topic of the cards that have none, as the api names it in a filter. */
export const NO_TOPIC = '_none';

export interface TopicSummary {
  /** What `?topic=` carries: the cards' `group` as written, or `NO_TOPIC`. */
  id: string;
  /** Absent only for `NO_TOPIC`, which the interface names itself. */
  title?: string;
  /** One line on what it covers — declared topics only. */
  description?: string;
  /** Slugs of the skill's guides it is practised from — declared topics only (ADR-0032). */
  guides?: string[];
  summary: DeckSummary;
}

/**
 * The flashcards for one topic of a deck — or the whole deck, without one.
 *
 * Learn mode is carried in the address because a tile offers both, and an address is what a learner
 * can come back to.
 */
export function topicHref(blockId: string, topic?: string, mode?: 'learn'): string {
  const params = new URLSearchParams({ blockId });
  if (topic) params.set('topic', topic);
  if (mode) params.set('mode', mode);
  return `/flashcards?${params.toString()}`;
}

/** A topic's name: its own title, or the interface's word for the cards without one. */
export function topicTitle(topic: Pick<TopicSummary, 'title'>, untitled: string): string {
  return topic.title ?? untitled;
}

/** A topic as a skill's manifest declares it (ADR-0032). */
export interface DeclaredTopic {
  id: string;
  title: string;
  description?: string;
  guides?: string[];
}

/**
 * What a card's `group` is called: the title the deck or the manifest gives it — a declared topic's
 * id reads as its title — or the label as written.
 */
export function cardTopicTitle(group: string, topics: readonly { id: string; title?: string }[]): string {
  return topics.find((topic) => topic.id === group)?.title ?? group;
}

/** The topics a guide is practised in, in the deck's order — what the foot of a guide links to. */
export function topicsOfGuide(topics: readonly TopicSummary[], slug: string): TopicSummary[] {
  return topics.filter((topic) => topic.guides?.includes(slug));
}

/**
 * The topic to store for what a learner typed into a topic box: a declared topic's id when they typed
 * its id or its title (in any case), or their own label as typed. Blank is no topic.
 */
export function topicIdFor(typed: string, declared: readonly DeclaredTopic[]): string | undefined {
  const label = typed.trim();
  if (!label) return undefined;
  const key = label.toLocaleLowerCase('en');
  return declared.find((topic) => topic.id === label || topic.title.toLocaleLowerCase('en') === key)?.id ?? label;
}

/**
 * What a topic box offers: the skill's declared topics by title, in its order, then the learner's own
 * labels already in use, alphabetically — each once.
 */
export function topicChoices(declared: readonly DeclaredTopic[], inUse: readonly (string | undefined)[]): string[] {
  const declaredIds = new Set(declared.map((topic) => topic.id));
  const own = [...new Set(inUse.filter((group): group is string => Boolean(group) && !declaredIds.has(group!)))].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  return [...declared.map((topic) => topic.title), ...own];
}
