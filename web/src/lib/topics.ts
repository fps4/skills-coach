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

/**
 * What a card's `group` is called on its front: the deck's title for it when the deck knows it — a
 * declared topic's id reads as its title — or the label as written.
 */
export function cardTopicTitle(group: string, topics: readonly TopicSummary[]): string {
  return topics.find((topic) => topic.id === group)?.title ?? group;
}

/** The topics a guide is practised in, in the deck's order — what the foot of a guide links to. */
export function topicsOfGuide(topics: readonly TopicSummary[], slug: string): TopicSummary[] {
  return topics.filter((topic) => topic.guides?.includes(slug));
}
