/**
 * The portable archive's rules.
 *
 * Two things are being pinned here, and they are the two things that decide whether a learner can
 * actually move systems:
 *
 * - **A reference outlives the learner id it was made under.** Everything owner-scoped is rebuilt
 *   from its parts on the way in, so the digest must be computed the same way on both sides.
 * - **An import never demotes.** Mastery is a floor in the trainer; it stays a floor here, which is
 *   what makes importing the wrong file by accident cost nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_KIND,
  ARCHIVE_VERSION,
  READABLE_VERSIONS,
  contentDigest,
  contentKey,
  furtherPosition,
  itemRefKey,
  mergeProgress,
} from '../../src/domain/portable.js';
import { initialProgress, type DrillProgress } from '../../src/domain/drill-progress.js';
import { drillIdFor } from '../../src/services/context.js';

const word = { kind: 'term' as const, term: 'de doorlooptijd', translation: 'the lead time' };
const sentence = {
  kind: 'word-order' as const,
  sentence: 'Ik begin morgen met de cursus.',
  parts: ['Ik', 'begin', 'morgen', 'met de cursus'],
  translation: 'I start the course tomorrow.',
};
const question = {
  kind: 'mcq' as const,
  stem: 'Which service fronts the origin?',
  options: [{ ref: 'a', text: 'CloudFront' }],
  correct: ['a'],
  explanation: 'It is the CDN.',
  categories: ['edge'],
};

const progress = (over: Partial<DrillProgress> = {}): DrillProgress => ({ ...initialProgress(), ...over });

describe('the envelope', () => {
  it('names itself, so an import can refuse a file that is not one', () => {
    expect(ARCHIVE_KIND).toBe('skills-coach.learner-archive');
  });

  it('can read the version it writes', () => {
    expect(READABLE_VERSIONS).toContain(ARCHIVE_VERSION);
  });
});

describe('the content digest', () => {
  it('asks for the side the learner produces first', () => {
    expect(contentKey(word)).toBe('de doorlooptijd');
    expect(contentKey(sentence)).toBe('Ik begin morgen met de cursus.');
    expect(contentKey(question)).toBe('Which service fronts the origin?');
  });

  it('is what the live identifier is built from, so the two cannot drift', () => {
    // The archive carries the digest; `drillIdFor` builds the id. If these ever disagreed, every
    // streak in an archive would silently detach on the way back in.
    expect(drillIdFor('pack.b1', word)).toBe(`pack.b1.d.${contentDigest(word)}`);
  });

  it('survives an edit to the side that is not asked for', () => {
    expect(contentDigest(word)).toBe(contentDigest({ ...word, translation: 'the throughput time' }));
  });

  it('names no owner, which is the whole reason it travels', () => {
    expect(contentDigest(word)).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('a reference key', () => {
  it("separates a learner's own word from the pack's identical one", () => {
    const base = { pack: 'demo', block: 1, owned: false, kind: 'term' as const, digest: 'abc123abc123' };
    expect(itemRefKey({ ...base, own: true })).not.toBe(itemRefKey({ ...base, own: false }));
  });

  it("separates the pack's block 1 from a block written for one learner", () => {
    const base = { pack: 'demo', block: 1, kind: 'term' as const, digest: 'abc123abc123', own: false };
    expect(itemRefKey({ ...base, owned: true })).not.toBe(itemRefKey({ ...base, owned: false }));
  });
});

describe('merging an archive into live progress', () => {
  it('takes the further-along side', () => {
    const live = progress({ streak: 1 });
    const incoming = progress({ stage: 2, stage1Cleared: true });
    expect(mergeProgress(live, incoming)).toMatchObject({ stage: 2, stage1Cleared: true });
  });

  it('never demotes: a stale archive cannot un-master a word', () => {
    const live = progress({ stage: 2, stage1Cleared: true, stage2Cleared: true, mastered: true });
    expect(mergeProgress(live, progress())).toMatchObject({ mastered: true, stage2Cleared: true });
  });

  it('leaves an equal state exactly as it was', () => {
    const live = progress({ stage: 2, stage1Cleared: true, streak: 1, attempts: 4, correct: 3 });
    expect(mergeProgress(live, { ...live })).toEqual(live);
  });

  it('lets a cleared stage beat a partial streak at the stage below', () => {
    const live = progress({ streak: 1 });
    const incoming = progress({ stage: 2, stage1Cleared: true, streak: 0 });
    expect(mergeProgress(live, incoming).stage).toBe(2);
  });

  it('takes the whole winning state, never half of each', () => {
    // A field-by-field merge could produce "mastered at stage 1" — a state the streak machine has
    // no path to, and which every reader downstream would then have to cope with.
    const live = progress({ streak: 1 });
    const incoming = progress({ stage: 2, stage1Cleared: true, stage2Cleared: true, mastered: true });
    const merged = mergeProgress(live, incoming);
    expect(merged).toEqual({ ...incoming, attempts: 0, correct: 0 });
  });

  it('maxes the counters rather than summing them, so a backup cannot inflate a history', () => {
    const live = progress({ attempts: 10, correct: 3 });
    const incoming = progress({ attempts: 4, correct: 4 });
    expect(mergeProgress(live, incoming)).toMatchObject({ attempts: 10, correct: 4 });
  });

  it('keeps the counters coherent: correct never exceeds attempts', () => {
    const merged = mergeProgress(progress({ attempts: 10, correct: 3 }), progress({ attempts: 4, correct: 4 }));
    expect(merged.correct).toBeLessThanOrEqual(merged.attempts);
  });
});

describe('merging a position in a pack', () => {
  it('takes the later block', () => {
    expect(furtherPosition({ blockOrder: 1, lessonOrder: 8 }, { blockOrder: 2, lessonOrder: 1 })).toEqual({
      blockOrder: 2,
      lessonOrder: 1,
    });
  });

  it('takes the later lesson within the same block', () => {
    expect(furtherPosition({ blockOrder: 2, lessonOrder: 1 }, { blockOrder: 2, lessonOrder: 4 })).toEqual({
      blockOrder: 2,
      lessonOrder: 4,
    });
  });

  it('never sends a learner backwards', () => {
    expect(furtherPosition({ blockOrder: 3, lessonOrder: 2 }, { blockOrder: 1, lessonOrder: 9 })).toEqual({
      blockOrder: 3,
      lessonOrder: 2,
    });
  });
});
