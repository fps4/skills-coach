/**
 * Topics: a deck sorted by what its cards are about (ADR-0031, ADR-0032).
 *
 * A card's topic is its `group` — the section label it already carried on its front (ADR-0027). One
 * per card, so a deck's topics partition it: every card is in exactly one, the topics' counts add up
 * to the deck's, and a topic's progress bar means the same thing the deck's does.
 *
 * A skill may **declare** its topics in its manifest (ADR-0032): a stable id the cards carry, a title,
 * a line saying what is in it, and the guides it is practised from. Declared topics come first, in the
 * order the manifest lists them — the order the skill is meant to be learned in. A card whose group a
 * manifest does not declare — a learner's own label, or a deck published before its skill declared
 * any — is still a topic, titled by its label, after the declared ones. A deck none of whose cards has
 * a topic has no topics at all, rather than one called "none"; where only some do, the rest are listed
 * last, as `NO_TOPIC`.
 *
 * Pure: no I/O.
 */

import { summarize, type DeckSummary, type DrillProgress } from './drill-progress.js';
import type { DrillItem } from './types.js';

/**
 * The topic of the cards that have none, as a filter names it.
 *
 * Starts with an underscore so it can never be a label someone wrote or an id a manifest declares:
 * a declared id starts with a letter or digit (`TOPIC_ID`), and section titles do not begin that way.
 */
export const NO_TOPIC = '_none';

/** What a declared topic's id looks like: what cards carry in `group`, and what a link names. */
export const TOPIC_ID = /^[a-z0-9][a-z0-9-]*$/;

/** A topic as a skill's manifest declares it (`flashcards.topics`, ADR-0032). */
export interface TopicDeclaration {
  /** What the cards carry in `group`. Stable: renaming the title never moves a card or breaks a link. */
  id: string;
  title: string;
  /** One line on what the topic covers — shown on its tile. */
  description?: string;
  /** Slugs of the skill's guides this topic is practised from (`skills/<id>/guides/<slug>.md`). */
  guides?: string[];
}

/** One topic of a deck, with the same counts the deck itself reports. */
export interface TopicSummary {
  /** What a filter passes to select it: the cards' `group` as written, or `NO_TOPIC`. */
  id: string;
  /** What it is called. Absent for `NO_TOPIC`, which the interface names in its own words. */
  title?: string;
  /** Declared topics only. */
  description?: string;
  /** Declared topics only, and only when the manifest names some. */
  guides?: string[];
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

/** What a card's topic is called: its declared title, or the label itself when undeclared. */
export function topicTitle(group: string, declared: readonly TopicDeclaration[] = []): string {
  return declared.find((topic) => topic.id === group)?.title ?? group;
}

/**
 * The groups among `groups` that a skill declaring topics does not declare.
 *
 * Empty when the skill declares none: an undeclared skill's labels are free. Where it declares some,
 * a published card naming anything else is a typo that would quietly become a topic of its own, so
 * publishing refuses it, as it refuses an undeclared error category (ADR-0032).
 */
export function undeclaredTopics(
  groups: readonly (string | undefined)[],
  declared: readonly TopicDeclaration[] = [],
): string[] {
  if (declared.length === 0) return [];
  const known = new Set(declared.map((topic) => topic.id));
  return [...new Set(groups.map((group) => group?.trim()).filter((group): group is string => Boolean(group)))].filter(
    (group) => !known.has(group),
  );
}

// "3 · Data Vault mechanics", "3. …", "3) …", "3 - …": the numbering authors put in front of a section.
const ORDINAL = /^\d+\s*[·.:)\-–]\s*/;

/**
 * The declared topic a free label stands for, when it is one: its id, or its title with or without a
 * leading section number, compared without regard to case. Null when it matches none.
 *
 * This is how a deck labelled before its skill declared topics is moved onto their ids (ADR-0032) —
 * a one-off, run by `retopic:cards`, never a rule the runtime applies on read.
 */
export function declaredTopicFor(label: string, declared: readonly TopicDeclaration[]): string | null {
  const trimmed = label.trim();
  if (declared.some((topic) => topic.id === trimmed)) return trimmed;
  const bare = (text: string) => text.replace(ORDINAL, '').trim().toLocaleLowerCase('en');
  return declared.find((topic) => bare(topic.title) === bare(trimmed))?.id ?? null;
}

// Numeric, so "10 · Observability" follows "9 · Hybrid governance" rather than "1 · React…".
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * A deck's topics, each with its own summary: the declared ones in manifest order, then any other
 * label in title order, then the cards without a topic. A declared topic no card is in yet is left
 * out — a tile with nothing to practise is not a topic of this deck.
 *
 * `cards` is the whole deck in scope, practised or not; `progress` holds what the learner has done
 * with any of them, keyed by item id. A card missing from it simply has not been practised.
 */
export function deckTopics(
  cards: DrillItem[],
  progress: ReadonlyMap<string, DrillProgress>,
  declared: readonly TopicDeclaration[] = [],
): TopicSummary[] {
  const byTopic = new Map<string, DrillItem[]>();
  for (const card of cards) {
    if (card.payload.kind !== 'term') continue;
    const id = cardTopic(card) ?? NO_TOPIC;
    byTopic.set(id, [...(byTopic.get(id) ?? []), card]);
  }
  if (byTopic.size === 0 || (byTopic.size === 1 && byTopic.has(NO_TOPIC))) return [];

  const summaryOf = (id: string): DeckSummary => {
    const members = byTopic.get(id) ?? [];
    const done = members.flatMap((member) => progress.get(member.drillItemId) ?? []);
    return summarize(done, members.length);
  };

  const declaredIds = new Set(declared.map((topic) => topic.id));
  const first = declared
    .filter((topic) => byTopic.has(topic.id))
    .map((topic): TopicSummary => ({
      id: topic.id,
      title: topic.title,
      ...(topic.description ? { description: topic.description } : {}),
      ...(topic.guides?.length ? { guides: topic.guides } : {}),
      summary: summaryOf(topic.id),
    }));
  const rest = [...byTopic.keys()]
    .filter((id) => id !== NO_TOPIC && !declaredIds.has(id))
    .sort((a, b) => collator.compare(a, b))
    .map((id): TopicSummary => ({ id, title: id, summary: summaryOf(id) }));
  const none = byTopic.has(NO_TOPIC) ? [{ id: NO_TOPIC, summary: summaryOf(NO_TOPIC) }] : [];

  return [...first, ...rest, ...none];
}
