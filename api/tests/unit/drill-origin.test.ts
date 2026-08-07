/**
 * Where a drill item came from, which is a different question from who sees it.
 *
 * The two were one field until a whole block could belong to one learner (ADR-0015): inside an owned
 * block, published content carries a `learnerId` too, so `learnerId` alone can no longer say whether
 * a republish may sweep an item away — or whether a learner may delete it.
 */

import { describe, expect, it } from 'vitest';
import { drillOrigin } from '../../src/domain/types.js';

describe('drillOrigin', () => {
  it('reads what a new write states', () => {
    expect(drillOrigin({ origin: 'pack', learnerId: 'learner-a' })).toBe('pack');
    expect(drillOrigin({ origin: 'learner', learnerId: 'learner-a' })).toBe('learner');
  });

  it("keeps a pack's own item a pack item when it predates the field", () => {
    expect(drillOrigin({})).toBe('pack');
  });

  it("keeps a learner's own word theirs when it predates the field", () => {
    // Back then only a learner's own words carried an owner, so the old field answers the old
    // question exactly — which is what makes the migration a no-op for existing documents.
    expect(drillOrigin({ learnerId: 'learner-a' })).toBe('learner');
  });

  it('lets a stated origin win over what the old rule would have guessed', () => {
    // The case the whole distinction exists for: published content inside a block written for one
    // learner. The old rule would call this the learner's word and stop a republish from touching it.
    expect(drillOrigin({ origin: 'pack', learnerId: 'learner-a' })).not.toBe(drillOrigin({ learnerId: 'learner-a' }));
  });
});
