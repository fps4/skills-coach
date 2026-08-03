/**
 * The MCP transport (ADR-0010).
 *
 * What matters here is not that JSON-RPC works — it is that the *second door opens onto the same
 * room*. The same capability decides, the same service writes, the same store answers. So the
 * publish test asserts its result back through the HTTP route: one store, two doors.
 *
 * The fake verifier ignores audiences entirely, which is what lets this run without minting a JWT;
 * audience handling is pinned in `tests/unit/config.test.ts`.
 */

import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TOOLS } from '../../src/mcp/tools.js';
import { auth, createHarness, mongoAvailable, seed, TEST_BLOCK, type Harness } from './helpers.js';

const RESOURCE = 'https://coach-mcp.example.invalid/mcp';

const available = await mongoAvailable();
const describeIfMongo = available ? describe : describe.skip;

let nextId = 0;
const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: (nextId += 1), method, params });

describeIfMongo('mcp', () => {
  let harness: Harness;

  const call = async (token: string, body: unknown) =>
    harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...auth(token), accept: 'application/json, text/event-stream' },
      payload: body as object,
    });

  /** The text payload of a tool result, parsed back into the object the service returned. */
  const resultOf = (response: { json: () => unknown }) => {
    const body = response.json() as { result: { content: { text: string }[] } };
    return JSON.parse(body.result.content[0]?.text ?? 'null');
  };

  beforeAll(async () => {
    harness = await createHarness(undefined, { MCP_RESOURCE_URL: RESOURCE });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  describe('handshake', () => {
    it('introduces itself and echoes a protocol version it knows', async () => {
      const response = await call('coach-token', rpc('initialize', { protocolVersion: '2024-11-05' }));

      expect(response.statusCode).toBe(200);
      expect(response.json().result).toMatchObject({
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'skills-coach' },
        capabilities: { tools: {} },
      });
    });

    it('answers a notification with 202 and no body, because JSON-RPC has no reply for one', async () => {
      const response = await call('coach-token', { jsonrpc: '2.0', method: 'notifications/initialized' });

      expect(response.statusCode).toBe(202);
      expect(response.body).toBe('');
    });
  });

  describe('who can see what', () => {
    it('shows a coach the authoring tools', async () => {
      const response = await call('coach-token', rpc('tools/list'));
      const names = response.json().result.tools.map((tool: { name: string }) => tool.name);

      expect(names).toContain('publish_block');
      expect(names).toContain('post_correction');
      expect(names).toContain('get_brief');
    });

    it('does not let a learner in at all — this endpoint is the coach surface', async () => {
      const response = await call('learner-token', rpc('tools/list'));

      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toContain('coach');
    });

    it('lists only what the caller could actually run', async () => {
      // The inner gate: what you can see is what you can do, so a token is never shown a toolbox
      // where half the calls would refuse.
      const response = await call('coach-token', rpc('tools/list'));
      const names: string[] = response.json().result.tools.map((tool: { name: string }) => tool.name);

      expect(names).toHaveLength(TOOLS.length);
    });

    it('describes each tool with a schema a model can build arguments from', async () => {
      const response = await call('coach-token', rpc('tools/list'));
      const publish = response.json().result.tools.find((tool: { name: string }) => tool.name === 'publish_block');

      expect(publish.inputSchema.type).toBe('object');
      expect(Object.keys(publish.inputSchema.properties)).toEqual(['packId', 'block']);
      // Inlined rather than $ref-linked, so nothing has to resolve indirection to use it.
      expect(JSON.stringify(publish.inputSchema)).not.toContain('$ref');
    });
  });

  describe('one store, two doors', () => {
    it('publishes a block that the HTTP surface then serves', async () => {
      const { packId } = await seed(harness);

      const published = await call(
        'coach-token',
        rpc('tools/call', {
          name: 'publish_block',
          arguments: { packId, block: { ...TEST_BLOCK, order: 2, slug: 'second' } },
        }),
      );

      expect(published.statusCode).toBe(200);
      expect(resultOf(published).block.order).toBe(2);

      const overHttp = await harness.app.inject({
        method: 'GET',
        url: `/coach/v1/blocks/${packId}.b2`,
        headers: auth('coach-token'),
      });

      expect(overHttp.statusCode).toBe(200);
      expect(overHttp.json().block.slug).toBe('second');
    });

    it('records the write in the same audit trail, saying which door it came through', async () => {
      const { packId } = await seed(harness);

      await call(
        'coach-token',
        rpc('tools/call', {
          name: 'publish_block',
          arguments: { packId, block: { ...TEST_BLOCK, order: 3, slug: 'third' } },
        }),
      );

      const event = await harness.store.collections.auditEvents.findOne({ resource: `block/${packId}.b3` });

      expect(event?.action).toBe('block.publish');
      expect(event?.meta).toMatchObject({ transport: 'mcp' });
      expect(event?.actor.subject).toBeTruthy();
    });
  });

  describe('refusals', () => {
    it('reports invalid arguments as something to fix, with the path', async () => {
      const response = await call(
        'coach-token',
        rpc('tools/call', { name: 'publish_block', arguments: { packId: 'x' } }),
      );

      expect(response.json().result.isError).toBe(true);
      expect(response.json().result.content[0].text).toContain('block');
    });

    it('passes a domain refusal through in the model’s words', async () => {
      const response = await call(
        'coach-token',
        rpc('tools/call', { name: 'get_block', arguments: { blockId: 'nope' } }),
      );

      expect(response.json().result.isError).toBe(true);
      expect(response.json().result.content[0].text).toContain('not found');
    });

    it('rejects an unknown tool as a protocol error', async () => {
      const response = await call('coach-token', rpc('tools/call', { name: 'drop_database', arguments: {} }));

      expect(response.json().error.code).toBe(-32602);
    });

    it('has no learner tools to reach in the first place', () => {
      const capabilities = new Set(TOOLS.map((tool) => tool.capability));

      expect(capabilities.has('drill:practice')).toBe(false);
      expect(capabilities.has('submission:write')).toBe(false);
      expect(capabilities.has('progress:read')).toBe(false);
    });
  });

  describe('bootstrapping a client', () => {
    it('carries the discovery pointer on a 401, which is what starts the OAuth flow', async () => {
      const response = await harness.app.inject({ method: 'POST', url: '/mcp', payload: rpc('tools/list') });

      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toContain('resource_metadata=');
      expect(response.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/mcp');
    });

    it('refuses a browser origin it does not already trust', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...auth('coach-token'), origin: 'https://evil.example.invalid' },
        payload: rpc('tools/list'),
      });

      expect(response.statusCode).toBe(403);
    });

    it('says plainly that it does not stream', async () => {
      const response = await harness.app.inject({ method: 'GET', url: '/mcp', headers: auth('coach-token') });

      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe('POST');
    });
  });

  describe('drift', () => {
    /**
     * Two tables — the routes and the tools — have to stay in step, and nothing but this notices
     * when they stop. It reads the route file rather than a shared registry on purpose: unifying
     * them is a refactor worth doing on its own, and until then this is what fails the build.
     */
    it('offers a tool for every coach route', async () => {
      const source = await readFile(new URL('../../src/http/coach.ts', import.meta.url), 'utf8');
      const routes = [...source.matchAll(/app\.(get|post)\('(\/coach\/v1[^']*)'/g)].map(
        (match) => `${match[1]?.toUpperCase()} ${match[2]}`,
      );

      const covered: Record<string, string> = {
        'GET /coach/v1/packs': 'list_packs',
        'POST /coach/v1/packs': 'upsert_pack',
        'POST /coach/v1/packs/:packId/blocks': 'publish_block',
        'POST /coach/v1/blocks/:blockId/archive': 'archive_block',
        'GET /coach/v1/blocks/:blockId': 'get_block',
        'GET /coach/v1/submissions': 'list_submissions',
        'GET /coach/v1/submissions/:submissionId': 'get_submission',
        'POST /coach/v1/submissions/:submissionId/correction': 'post_correction',
        'POST /coach/v1/blocks/:blockId/review': 'post_block_review',
        'GET /coach/v1/blocks/:blockId/brief': 'get_brief',
        'GET /coach/v1/blocks/:blockId/review': 'get_block_review',
        'GET /coach/v1/learners': 'list_learners',
      };

      expect(routes.length).toBeGreaterThan(0);
      const names = new Set(TOOLS.map((tool) => tool.name));
      for (const route of routes) {
        expect(covered[route], `no MCP tool declared for ${route}`).toBeTruthy();
        expect(names.has(covered[route] as string)).toBe(true);
      }
    });

    it('gates each tool with the capability its route uses', async () => {
      const source = await readFile(new URL('../../src/http/coach.ts', import.meta.url), 'utf8');

      for (const tool of TOOLS) {
        expect(source).toContain(`'${tool.capability}'`);
      }
    });
  });
});

describeIfMongo('mcp, when no resource url is configured', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('is not mounted at all', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: auth('coach-token'),
      payload: rpc('tools/list'),
    });

    expect(response.statusCode).toBe(404);
  });
});
