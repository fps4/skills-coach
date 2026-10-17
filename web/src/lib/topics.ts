/**
 * Topics, as the web sees them (ADR-0031): the shape the api reports a deck's topics in, where a
 * topic opens, and what it is called. Pure, so the overview's tiles and the flashcards' picker build
 * the same links.
 */

import type { DeckSummary } from './types';

/** The topic of the cards that have none, as the api names it in a filter. */
export const NO_TOPIC = '_none';

export interface TopicSummary {
  /** What `?topic=` carries: the cards' `group` as written, or `NO_TOPIC`. */
  id: string;
  /** Absent only for `NO_TOPIC`, which the interface names itself. */
  title?: string;
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
