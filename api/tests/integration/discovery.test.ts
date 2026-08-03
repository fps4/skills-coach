/**
 * Protected-resource discovery (RFC 9728).
 *
 * The property under test is that this document is reachable **without a token**. It is the one
 * place where "everything needs authentication" has to give way — a client cannot present a token it
 * has no way to obtain — and the exemption is an exact-match path list, so a typo there fails closed
 * and silently breaks every client's bootstrap.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, mongoAvailable, type Harness } from './helpers.js';

const RESOURCE = 'https://coach-mcp.example.invalid/mcp';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

describeIfMongo('discovery, when an MCP resource is configured', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness(undefined, { MCP_RESOURCE_URL: RESOURCE });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('serves the metadata to a caller with no token at all', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      resource: RESOURCE,
      bearer_methods_supported: ['header'],
    });
  });

  it('serves it at the resource-path form too, which is what the RFC specifies', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });

    expect(response.statusCode).toBe(200);
    expect(response.json().resource).toBe(RESOURCE);
  });

  it('points at the authorization server rather than pretending to be one', async () => {
    // Skills Coach verifies tokens and issues none (ADR-0002).
    const response = await harness.app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });

    expect(response.json().authorization_servers).toEqual([harness.config.auth.issuer].filter(Boolean));
  });

  it('leaves everything else needing a token', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/coach/v1/packs' });

    expect(response.statusCode).toBe(401);
  });
});

describeIfMongo('discovery, when no MCP resource is configured', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('advertises nothing — a deployment without the endpoint has no resource to describe', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });

    // 401 rather than 404: the auth hook runs before routing, so an unlisted path is refused before
    // anyone discovers whether it exists. What matters here is that no document comes back.
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('authorization_servers');
  });
});
