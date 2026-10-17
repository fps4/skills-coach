/**
 * Topics — a deck sorted by what its cards are about (ADR-0031).
 *
 * Pinned here: a card's topic is its `group`, one per card, so the topics partition the deck; the
 * list is read off the cards and ordered the way a numbered section list reads; a deck with no topics
 * offers none, and the cards without one in a deck that has some are a topic of their own, last.
 *
 * Fixtures are invented (ADR-0006).
 */

import { describe, expect, it } from 'vitest';
import { cardTopic, deckTopics, inTopic, NO_TOPIC } from '../../src/domain/topics.js';
import { initialProgress, type DrillProgress } from '../../src/domain/drill-progress.js';
import type { DrillItem } from '../../src/domain/types.js';

const card = (id: string, group?: string): DrillItem => ({
  drillItemId: id,
  packId: 'w',
  blockId: 'w.b1',
  payload: {
    kind: 'term',
    term: `term ${id}`,
    translation: `meaning ${id}`,
    ...(group === undefined ? {} : { group }),
  },
});

const sentence: DrillItem = {
  drillItemId: 's1',
  packId: 'w',
  blockId: 'w.b1',
  payload: { kind: 'word-order', sentence: 'Ik werk.', parts: ['Ik', 'werk.'], translation: 'I work.' },
};

const mastered: DrillProgress = { ...initialProgress(), stage: 2, stage1Cleared: true, mastered: true, attempts: 4 };
const cleared: DrillProgress = { ...initialProgress(), stage: 2, stage1Cleared: true, attempts: 2 };

describe('a card’s topic', () => {
  it('is its group, trimmed', () => {
    expect(cardTopic(card('1', '  Widgets  '))).toBe('Widgets');
  });

  it('is none when the group is missing or blank', () => {
    expect(cardTopic(card('1'))).toBeNull();
    expect(cardTopic(card('1', '   '))).toBeNull();
  });

  it('is none for anything that is not a card', () => {
    expect(cardTopic(sentence)).toBeNull();
  });
});

describe('filtering by topic', () => {
  it('keeps the cards of the topic named and no others', () => {
    expect(inTopic(card('1', 'Widgets'), 'Widgets')).toBe(true);
    expect(inTopic(card('2', 'Gadgets'), 'Widgets')).toBe(false);
    expect(inTopic(card('3'), 'Widgets')).toBe(false);
  });

  it('selects the cards without a topic by NO_TOPIC', () => {
    expect(inTopic(card('1'), NO_TOPIC)).toBe(true);
    expect(inTopic(card('2', 'Widgets'), NO_TOPIC)).toBe(false);
  });
});

describe('a deck’s topics', () => {
  it('partition the deck: every card counted once, the counts adding up to the deck', () => {
    const cards = [card('1', 'Widgets'), card('2', 'Widgets'), card('3', 'Gadgets')];
    const topics = deckTopics(cards, new Map([['1', mastered]]));
    expect(topics).toEqual([
      {
        id: 'Gadgets',
        title: 'Gadgets',
        summary: { total: 1, stage1Cleared: 0, stage2Unlocked: 0, mastered: 0, inProgress: 1 },
      },
      {
        id: 'Widgets',
        title: 'Widgets',
        summary: { total: 2, stage1Cleared: 1, stage2Unlocked: 0, mastered: 1, inProgress: 1 },
      },
    ]);
    expect(topics.reduce((sum, topic) => sum + topic.summary.total, 0)).toBe(cards.length);
  });

  it('count a learner’s progress only against the topic of the card it is for', () => {
    const topics = deckTopics([card('1', 'Widgets'), card('2', 'Gadgets')], new Map([['2', cleared]]));
    expect(topics.find((topic) => topic.id === 'Gadgets')?.summary).toMatchObject({
      stage1Cleared: 1,
      stage2Unlocked: 1,
    });
    expect(topics.find((topic) => topic.id === 'Widgets')?.summary).toMatchObject({ stage1Cleared: 0 });
  });

  it('are ordered as a numbered section list reads, 10 after 9', () => {
    const topics = deckTopics([card('a', '10 · Ten'), card('b', '2 · Two'), card('c', '1 · One')], new Map());
    expect(topics.map((topic) => topic.id)).toEqual(['1 · One', '2 · Two', '10 · Ten']);
  });

  it('list the cards without a topic last, untitled, when some cards have one', () => {
    const topics = deckTopics([card('1'), card('2', 'Widgets')], new Map());
    expect(topics.map((topic) => topic.id)).toEqual(['Widgets', NO_TOPIC]);
    expect(topics[1]).not.toHaveProperty('title');
  });

  it('are none at all for a deck whose cards have no topic', () => {
    expect(deckTopics([card('1'), card('2')], new Map())).toEqual([]);
    expect(deckTopics([], new Map())).toEqual([]);
  });

  it('ignore anything in scope that is not a card', () => {
    expect(deckTopics([sentence, card('1', 'Widgets')], new Map())).toEqual([
      expect.objectContaining({ id: 'Widgets', summary: expect.objectContaining({ total: 1 }) }),
    ]);
  });
});
