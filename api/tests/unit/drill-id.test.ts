/**
 * Drill item identity. Deterministic by content, so republishing keeps a learner's streak attached
 * (`services/context.ts`), and namespaced by owner once a learner adds words of their own (ADR-0012).
 */

import { describe, expect, it } from 'vitest';
import { drillIdFor } from '../../src/services/context.js';

const word = { kind: 'term' as const, term: 'de begroting', translation: 'the budget' };

describe('drillIdFor', () => {
  it('is stable for the same content, so progress survives a republish', () => {
    expect(drillIdFor('pack.b1', word)).toBe(drillIdFor('pack.b1', { ...word, translation: 'the estimate' }));
  });

  it('changes when the side being asked for changes', () => {
    expect(drillIdFor('pack.b1', word)).not.toBe(drillIdFor('pack.b1', { ...word, term: 'de bezuiniging' }));
  });

  it('separates the same word in two blocks', () => {
    expect(drillIdFor('pack.b1', word)).not.toBe(drillIdFor('pack.b2', word));
  });

  it('gives two learners their own item for the same word', () => {
    expect(drillIdFor('pack.b1', word, 'learner-a')).not.toBe(drillIdFor('pack.b1', word, 'learner-b'));
  });

  it('gives one learner the same item for the same word, so adding it twice is not a duplicate', () => {
    expect(drillIdFor('pack.b1', word, 'learner-a')).toBe(drillIdFor('pack.b1', word, 'learner-a'));
  });

  it("never collides a learner's word with the pack's", () => {
    expect(drillIdFor('pack.b1', word, 'learner-a')).not.toBe(drillIdFor('pack.b1', word));
  });

  it('does not put the learner id in the URL', () => {
    expect(drillIdFor('pack.b1', word, 'learner-a')).not.toContain('learner-a');
  });
});
