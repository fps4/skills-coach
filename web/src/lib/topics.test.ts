import { describe, expect, it } from 'vitest';

import { NO_TOPIC, topicHref, topicTitle } from './topics';

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
