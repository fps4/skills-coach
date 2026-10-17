/**
 * Topics: a deck sorted by what its cards are about (ADR-0031).
 *
 * A card's topic is its `group` — the section label it already carried on its front (ADR-0027). One
 * per card, so a deck's topics partition it: every card is in exactly one, the topics' counts add up
 * to the deck's, and a topic's progress bar means the same thing the deck's does.
 *
 * The list of topics is read off the cards, not declared anywhere: what a deck's cards say they are
 * about is what the deck offers. A deck none of whose cards has a topic has no topics at all, rather
 * than one topic called "none". A deck where only some do lists the rest last, as `NO_TOPIC`.
 *
 * Pure: no I/O.
 */

import { summarize, type DeckSummary, type DrillProgress } from './drill-progress.js';
import type { DrillItem } from './types.js';

/**
 * The topic of the cards that have none, as a filter names it.
 *
 * Starts with an underscore so it can never be a label someone wrote: a topic is a section title,
 * and titles do not begin that way.
 */
export const NO_TOPIC = '_none';

/** One topic of a deck, with the same counts the deck itself reports. */
export interface TopicSummary {
  /** What a filter passes to select it: the card's `group` as written, or `NO_TOPIC`. */
  id: string;
  /** What it is called. Absent for `NO_TOPIC`, which the interface names in its own words. */
  title?: string;
  summary: DeckSummary;
}

/** A card's topic, or null when it has none. Only a card has one; a question or a sentence never does. */
export function cardTopic(item: DrillItem): string | null {
  if (item.payload.kind !== 'term') return null;
  const group = item.payload.group?.trim();
  return group ? group : null;
}

/** Whether a card belongs to the topic a filter names. */
export function inTopic(item: DrillItem, topic: string): boolean {
  const own = cardTopic(item);
  return topic === NO_TOPIC ? own === null : own === topic;
}

// Numeric, so "10 · Observability" follows "9 · Hybrid governance" rather than "1 · React…".
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * A deck's topics, each with its own summary — in title order, cards without a topic last.
 *
 * `cards` is the whole deck in scope, practised or not; `progress` holds what the learner has done
 * with any of them, keyed by item id. A card missing from it simply has not been practised.
 */
export function deckTopics(cards: DrillItem[], progress: ReadonlyMap<string, DrillProgress>): TopicSummary[] {
  const byTopic = new Map<string, DrillItem[]>();
  for (const card of cards) {
    if (card.payload.kind !== 'term') continue;
    const id = cardTopic(card) ?? NO_TOPIC;
    byTopic.set(id, [...(byTopic.get(id) ?? []), card]);
  }
  if (byTopic.size === 0 || (byTopic.size === 1 && byTopic.has(NO_TOPIC))) return [];

  const summaries = [...byTopic].map(([id, members]): TopicSummary => {
    const done = members.flatMap((member) => progress.get(member.drillItemId) ?? []);
    return { id, ...(id === NO_TOPIC ? {} : { title: id }), summary: summarize(done, members.length) };
  });
  return summaries.sort((a, b) => {
    if (a.id === NO_TOPIC) return 1;
    if (b.id === NO_TOPIC) return -1;
    return collator.compare(a.id, b.id);
  });
}
