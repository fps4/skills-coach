/**
 * The role → capability map (ADR-0002). The rules being pinned are "an unknown role grants
 * nothing" and "learner and coach cannot do each other's job".
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE, resolveCapabilities } from '../../src/auth/capabilities.js';
import { loadConfig, ConfigError } from '../../src/config.js';

describe('resolveCapabilities', () => {
  it('grants a learner practice and submission, but nothing authoring', () => {
    const { capabilities } = resolveCapabilities(['learner']);
    expect(capabilities.has('drill:practice')).toBe(true);
    expect(capabilities.has('submission:write')).toBe(true);
    expect(capabilities.has('pack:publish')).toBe(false);
    expect(capabilities.has('correction:write')).toBe(false);
  });

  it('grants a coach authoring and correction, but not another learner’s practice', () => {
    const { capabilities } = resolveCapabilities(['coach']);
    expect(capabilities.has('pack:publish')).toBe(true);
    expect(capabilities.has('correction:write')).toBe(true);
    expect(capabilities.has('drill:practice')).toBe(false);
    expect(capabilities.has('submission:write')).toBe(false);
  });

  it('keeps a learner out of the coach’s queue of everyone’s submissions', () => {
    expect(resolveCapabilities(['learner']).capabilities.has('submission:read-all')).toBe(false);
  });

  it('grants nothing for an unrecognised role, and reports it for logging', () => {
    const { capabilities, unknownRoles } = resolveCapabilities(['administrator']);
    expect(capabilities.size).toBe(0);
    expect(unknownRoles).toEqual(['administrator']);
  });

  it('still honours the roles it does recognise alongside one it does not', () => {
    const { capabilities, unknownRoles } = resolveCapabilities(['learner', 'wizard']);
    expect(capabilities.has('drill:practice')).toBe(true);
    expect(unknownRoles).toEqual(['wizard']);
  });

  it('unions capabilities when a caller holds both roles', () => {
    const { capabilities } = resolveCapabilities(['learner', 'coach']);
    expect(capabilities.has('drill:practice')).toBe(true);
    expect(capabilities.has('correction:write')).toBe(true);
  });

  it('falls back to the documented baseline when the token carries no roles', () => {
    for (const roles of [undefined, []]) {
      const resolution = resolveCapabilities(roles);
      expect(resolution.usedDefault).toBe(true);
      expect(resolution.capabilities).toEqual(resolveCapabilities([DEFAULT_ROLE]).capabilities);
    }
  });
});

describe('configuration safety', () => {
  const base = { MONGO_URI: 'mongodb://localhost:27018', AUTH_MODE: 'dev' };

  it('allows the stub principal locally', () => {
    expect(loadConfig({ ...base, COACH_ENV: 'local' } as NodeJS.ProcessEnv).auth.mode).toBe('dev');
  });

  it('refuses the stub principal when COACH_ENV says production', () => {
    expect(() => loadConfig({ ...base, COACH_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('still allows the stub principal when only NODE_ENV says production', () => {
    // The runtime image always sets NODE_ENV=production — that is what it means to Node, not a
    // statement that this is a deployment. COACH_ENV is the deployment signal.
    expect(loadConfig({ ...base, COACH_ENV: 'local', NODE_ENV: 'production' } as NodeJS.ProcessEnv).auth.mode).toBe(
      'dev',
    );
  });

  it('refuses jwks mode without a verifier configured', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'jwks' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('accepts jwks mode when fully configured', () => {
    const config = loadConfig({
      ...base,
      COACH_ENV: 'production',
      AUTH_MODE: 'jwks',
      AUTH_JWKS_URL: 'https://auth.example.com/.well-known/jwks.json',
      AUTH_ISSUER: 'https://auth.example.com',
      AUTH_AUDIENCE: 'skills-coach',
    } as NodeJS.ProcessEnv);
    expect(config.auth.mode).toBe('jwks');
    expect(config.auth.audience).toBe('skills-coach');
  });
});

describe('environment quirks', () => {
  it('treats an empty variable as unset — compose interpolates unset vars to empty strings', () => {
    const config = loadConfig({
      COACH_ENV: 'local',
      MONGO_URI: 'mongodb://localhost:27018',
      AUTH_MODE: 'dev',
      AUTH_JWKS_URL: '',
      AUTH_ISSUER: '   ',
      AUTH_AUDIENCE: '',
      CORS_ORIGINS: '',
    } as NodeJS.ProcessEnv);
    expect(config.auth.jwksUrl).toBeUndefined();
    expect(config.auth.issuer).toBeUndefined();
    expect(config.corsOrigins).toEqual([]);
  });
});
