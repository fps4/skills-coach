import { describe, expect, it } from 'vitest';

import { cardTopicTitle, NO_TOPIC, topicHref, topicsOfGuide, topicTitle, type TopicSummary } from './topics';

describe('topicHref', () => {
  it('opens the whole deck without a topic', () => {
    expect(topicHref('kg.b1')).toBe('/flashcards?blockId=kg.b1');
  });

  it('carries the topic, encoded, so a title with spaces and symbols survives the address', () => {
    const href = topicHref('kg.b1', '3 · Data Vault & PIT');
    expect(new URL(href, 'https://x.invalid').searchParams.get('topic')).toBe('3 · Data Vault & PIT');
  });

  it('carries learn mode when a tile asks for it', () => {
    expect(topicHref('kg.b1', NO_TOPIC, 'learn')).toBe('/flashcards?blockId=kg.b1&topic=_none&mode=learn');
  });
});

describe('topicTitle', () => {
  it('is the topic’s own title, or the interface’s word for the cards without one', () => {
    expect(topicTitle({ title: 'Basics' }, 'No topic')).toBe('Basics');
    expect(topicTitle({}, 'No topic')).toBe('No topic');
  });
});

const summary = { total: 1, stage1Cleared: 0, stage2Unlocked: 0, mastered: 0, inProgress: 1 };
const TOPICS: TopicSummary[] = [
  { id: 'vault', title: 'Data Vault mechanics', guides: ['data-vault'], summary },
  { id: 'layers', title: 'Layers & history', guides: ['modelling', 'data-vault'], summary },
  { id: 'Mine', title: 'Mine', summary },
];

describe('cardTopicTitle', () => {
  it('reads a declared id as its title, and any other label as written', () => {
    expect(cardTopicTitle('vault', TOPICS)).toBe('Data Vault mechanics');
    expect(cardTopicTitle('3 · Old label', TOPICS)).toBe('3 · Old label');
  });
});

describe('topicsOfGuide', () => {
  it('finds the topics practised from a guide, in the deck’s order', () => {
    expect(topicsOfGuide(TOPICS, 'data-vault').map((topic) => topic.id)).toEqual(['vault', 'layers']);
    expect(topicsOfGuide(TOPICS, 'nothing')).toEqual([]);
  });
});
