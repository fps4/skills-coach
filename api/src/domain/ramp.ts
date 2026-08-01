/**
 * Where a block sits on its pack's difficulty ramp.
 *
 * A pack declares an ordered list of levels and, optionally, which block ranges sit at which level
 * along with the authoring dials for that stretch (text length, sentence complexity, grammar load).
 * The runtime never interprets a dial — it carries them into the brief so whoever authors the next
 * block knows which rung they are aiming at.
 *
 * Pure: no I/O.
 */

import type { Framework, RampStep } from './types.js';

/** The ramp step covering a block, or null when the pack declares no ramp for it. */
export function rampStepFor(framework: Framework, blockOrder: number): RampStep | null {
  const steps = framework.ramp ?? [];
  return steps.find((step) => blockOrder >= step.fromBlock && blockOrder <= step.toBlock) ?? null;
}

/** The next level up, or null at the top of the ladder. */
export function nextLevel(framework: Framework, level: string | undefined): string | null {
  if (!level) return framework.levels[0] ?? null;
  const index = framework.levels.indexOf(level);
  if (index < 0) return null;
  return framework.levels[index + 1] ?? null;
}

export interface RampPosition {
  blockOrder: number;
  level: string | null;
  phase: string | null;
  dials: Record<string, string>;
  /** The level the block after this one should aim at — the rung being climbed toward. */
  nextLevel: string | null;
  /** How far through the declared ramp this block sits, 0–1, or null when there is no ramp. */
  fraction: number | null;
}

export function rampPosition(framework: Framework, blockOrder: number): RampPosition {
  const step = rampStepFor(framework, blockOrder);
  const nextStep = rampStepFor(framework, blockOrder + 1);
  const lastBlock = (framework.ramp ?? []).reduce((max, entry) => Math.max(max, entry.toBlock), 0);

  return {
    blockOrder,
    level: step?.level ?? null,
    phase: step?.phase ?? null,
    dials: step?.dials ?? {},
    // Within a stretch the level holds; at its edge it steps up.
    nextLevel: nextStep ? nextStep.level : nextLevel(framework, step?.level),
    fraction: lastBlock > 0 ? Math.min(1, blockOrder / lastBlock) : null,
  };
}
