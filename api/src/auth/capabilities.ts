/**
 * The role → capability map (ADR-0002).
 *
 * identity-service says *who* you are and what roles you hold in this application. What a role may
 * do is decided here, in the product, and nowhere else. Roles arrive as opaque strings; an
 * unrecognised one grants nothing and is logged rather than guessed at.
 *
 * Adding a role to a person is operator configuration in identity-service. Adding a *capability* to
 * a role is a code change here — deliberately, because it changes what the product permits.
 */

export const CAPABILITIES = [
  'lesson:read',
  'drill:practice',
  // Adding words to your *own* deck. Separate from `drill:practice` because it writes content, and
  // a capability that permits writing should never be implied by one that permits reading (ADR-0012).
  'drill:curate',
  'submission:write',
  'progress:read',
  'pack:publish',
  'submission:read-all',
  'correction:write',
  'review:write',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Two disjoint sets: a learner works through material, a coach authors it and corrects it. Neither
 * can do the other's job — a learner cannot read another learner's submissions, and a coach's
 * machine credential cannot practise.
 */
export const ROLE_CAPABILITIES: Record<string, readonly Capability[]> = {
  learner: ['lesson:read', 'drill:practice', 'drill:curate', 'submission:write', 'progress:read'],
  coach: ['lesson:read', 'pack:publish', 'submission:read-all', 'correction:write', 'review:write'],
};

/**
 * The role assumed when a token carries no `roles` claim. Per the integration guide, an absent
 * claim means "entitled to this app, granted nothing specific" — so we pick a documented baseline
 * rather than failing closed silently.
 */
export const DEFAULT_ROLE = 'learner';

export interface CapabilityResolution {
  capabilities: Set<Capability>;
  /** Roles on the token that this product does not recognise. Logged by the caller. */
  unknownRoles: string[];
  /** True when the baseline role was applied because the token carried none. */
  usedDefault: boolean;
}

export function resolveCapabilities(roles: string[] | undefined): CapabilityResolution {
  const usedDefault = !roles || roles.length === 0;
  const effective = usedDefault ? [DEFAULT_ROLE] : (roles as string[]);

  const capabilities = new Set<Capability>();
  const unknownRoles: string[] = [];

  for (const role of effective) {
    const granted = ROLE_CAPABILITIES[role];
    if (!granted) {
      unknownRoles.push(role);
      continue;
    }
    for (const capability of granted) capabilities.add(capability);
  }

  return { capabilities, unknownRoles, usedDefault };
}

export function hasCapability(capabilities: Set<Capability>, required: Capability): boolean {
  return capabilities.has(required);
}
