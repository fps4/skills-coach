/**
 * Configuration, which is the one module whose bugs are only visible in production.
 *
 * Two things are pinned. The production guards, because their whole purpose is to fail a deployment
 * that would otherwise run with the stub principal. And audience handling, because one service now
 * answers to more than one OAuth resource — the application and the MCP endpoint — and a token
 * bound to either must verify.
 */

import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const jwks = {
  AUTH_MODE: 'jwks',
  AUTH_JWKS_URL: 'https://auth.example.invalid/.well-known/jwks.json',
  AUTH_ISSUER: 'https://auth.example.invalid',
  AUTH_AUDIENCE: 'skills-coach',
};

describe('defaults', () => {
  it('runs locally with no environment at all', () => {
    const config = loadConfig({});

    expect(config.env).toBe('local');
    expect(config.auth.mode).toBe('dev');
    expect(config.mcp.resourceUrl).toBeUndefined();
  });

  it('treats an empty variable as an unset one, because compose interpolates it that way', () => {
    const config = loadConfig({ AUTH_JWKS_URL: '', MCP_RESOURCE_URL: '' });

    expect(config.auth.jwksUrl).toBeUndefined();
    expect(config.mcp.resourceUrl).toBeUndefined();
  });
});

describe('audiences', () => {
  it('reads one', () => {
    expect(loadConfig(jwks).auth.audiences).toEqual(['skills-coach']);
  });

  it('reads several, trimmed', () => {
    const config = loadConfig({ ...jwks, AUTH_AUDIENCE: 'skills-coach , coach-workspace' });

    expect(config.auth.audiences).toEqual(['skills-coach', 'coach-workspace']);
  });

  it('accepts the MCP resource without it being configured twice', () => {
    const config = loadConfig({ ...jwks, MCP_RESOURCE_URL: 'https://coach-mcp.example.invalid/mcp' });

    // The document published at /.well-known and the audience accepted from a token are the same
    // fact; deriving one from the other is what stops them drifting.
    expect(config.auth.audiences).toEqual(['skills-coach', 'https://coach-mcp.example.invalid/mcp']);
    expect(config.mcp.resourceUrl).toBe('https://coach-mcp.example.invalid/mcp');
  });

  it('refuses jwks mode with no audience at all', () => {
    expect(() => loadConfig({ ...jwks, AUTH_AUDIENCE: undefined })).toThrow(ConfigError);
  });
});

describe('production guards', () => {
  it('refuses the stub principal', () => {
    expect(() => loadConfig({ COACH_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(/AUTH_MODE=dev is refused/);
  });

  it('names every missing verifier setting at once', () => {
    expect(() => loadConfig({ AUTH_MODE: 'jwks' })).toThrow(/AUTH_JWKS_URL, AUTH_ISSUER, AUTH_AUDIENCE/);
  });

  it('refuses an MCP resource that nothing would verify tokens for', () => {
    expect(() =>
      loadConfig({ COACH_ENV: 'production', AUTH_MODE: 'jwks', MCP_RESOURCE_URL: 'https://x.example.invalid/mcp' }),
    ).toThrow(/AUTH_JWKS_URL/);
  });

  it('ignores NODE_ENV, which the runtime image always sets to production', () => {
    const config = loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev' });

    expect(config.auth.mode).toBe('dev');
  });
});
