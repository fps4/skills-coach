/**
 * Block identity. Derived from position, and namespaced by owner once blocks are written per
 * learner (ADR-0015) — the same device `drillIdFor` uses, and load-bearing for the same reason:
 * every lesson, drill item, submission and review id hangs off a block id.
 */

import { describe, expect, it } from 'vitest';
import { blockIdFor, drillIdFor, lessonIdFor } from '../../src/services/context.js';

const word = { kind: 'term' as const, term: 'de winkelvloer', translation: 'the shop floor' };

describe('blockIdFor', () => {
  it('keeps the unnamespaced form when the pack owns the block', () => {
    expect(blockIdFor('pack', 1)).toBe('pack.b1');
  });

  it('is unchanged by passing no owner, so blocks published before ownership keep their ids', () => {
    expect(blockIdFor('pack', 3, undefined)).toBe('pack.b3');
  });

  it('gives two learners their own block at the same position', () => {
    expect(blockIdFor('pack', 1, 'learner-a')).not.toBe(blockIdFor('pack', 1, 'learner-b'));
  });

  it('is stable for one learner, so republishing updates in place', () => {
    expect(blockIdFor('pack', 1, 'learner-a')).toBe(blockIdFor('pack', 1, 'learner-a'));
  });

  it("never collides a learner's block with the pack's", () => {
    expect(blockIdFor('pack', 1, 'learner-a')).not.toBe(blockIdFor('pack', 1));
  });

  it('separates positions within one learner', () => {
    expect(blockIdFor('pack', 1, 'learner-a')).not.toBe(blockIdFor('pack', 2, 'learner-a'));
  });

  it('does not put the learner id in the URL', () => {
    expect(blockIdFor('pack', 1, 'learner-a')).not.toContain('learner-a');
  });
});

describe('what hangs off a block id', () => {
  /**
   * The reason `publishBlock` reuses a stored `_id` rather than recomputing it. If ownership were
   * ever backfilled by re-deriving the id, every one of these would move with it and the progress
   * attached to them would be orphaned in place.
   */
  it('moves lesson and drill ids with the block, which is why ownership is never backfilled by id', () => {
    const packWide = blockIdFor('pack', 1);
    const owned = blockIdFor('pack', 1, 'learner-a');

    expect(lessonIdFor(owned, 2)).not.toBe(lessonIdFor(packWide, 2));
    expect(drillIdFor(owned, word)).not.toBe(drillIdFor(packWide, word));
  });

  it("nests a learner's own word inside an owned block without a second namespace collision", () => {
    const owned = blockIdFor('pack', 1, 'learner-a');

    // The block id already carries the owner, so published content needs no second tag — but a word
    // the learner adds themselves still gets one, and the two must not land on the same document.
    expect(drillIdFor(owned, word)).not.toBe(drillIdFor(owned, word, 'learner-a'));
  });
});
