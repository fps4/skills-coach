/**
 * The MCP core, with no transport under it.
 *
 * Being able to test it this way is the reason it is written this way: a capability set is just an
 * argument here, so the per-tool gate can be exercised with a caller who holds *some* of what the
 * tools need — which no token can express over HTTP, because the product ships two roles and one of
 * them holds every coach capability at once.
 *
 * The gate is what matters. A tool must refuse before it runs, and say what it needed.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Capability } from '../../src/auth/capabilities.js';
import type { RequestAuth } from '../../src/auth/plugin.js';
import { DEFAULT_PROTOCOL, handleRpc } from '../../src/mcp/handler.js';
import { TOOLS } from '../../src/mcp/tools.js';
import type { ServiceContext } from '../../src/services/context.js';

const caller = (...capabilities: Capability[]): RequestAuth => ({
  principal: { subject: 'someone', roles: ['coach'], kind: 'client' },
  capabilities: new Set(capabilities),
});

/** No tool that gets past the gate is reached in these tests, so the store is never touched. */
const ctx = {} as ServiceContext;

const send = (message: object, auth: RequestAuth) => handleRpc(message, { ctx, auth });

describe('handshake', () => {
  it('echoes a protocol version it knows', async () => {
    const response = await send(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      caller(),
    );

    expect((response?.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05');
  });

  it('answers with its own when asked for one it does not speak', async () => {
    const response = await send(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      caller(),
    );

    expect((response?.result as { protocolVersion: string }).protocolVersion).toBe(DEFAULT_PROTOCOL);
  });

  it('says nothing back to a notification', async () => {
    expect(await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, caller())).toBeNull();
  });

  it('refuses a method it does not implement', async () => {
    const response = await send({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, caller());

    expect(response?.error?.code).toBe(-32601);
  });
});

describe('the tool list is what the caller can actually run', () => {
  it('shows only the tools a capability set reaches', async () => {
    const response = await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, caller('pack:publish'));
    const names = (response?.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);

    expect(names.sort()).toEqual(['archive_block', 'publish_block', 'set_learner_profile', 'upsert_pack']);
  });

  it('shows nothing to a caller with nothing', async () => {
    const response = await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, caller());

    expect((response?.result as { tools: unknown[] }).tools).toEqual([]);
  });
});

describe('the gate', () => {
  it('refuses a tool the caller lacks the capability for, and names it', async () => {
    const response = await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'publish_block', arguments: {} } },
      caller('submission:read-all'),
    );

    const result = response?.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('pack:publish');
  });

  it('refuses before the tool runs, not after', async () => {
    const publish = TOOLS.find((tool) => tool.name === 'publish_block');
    const run = vi.spyOn(publish as { run: unknown } as never, 'run' as never);

    await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'publish_block', arguments: {} } },
      caller('review:write'),
    );

    expect(run).not.toHaveBeenCalled();
    run.mockRestore();
  });

  it('checks the capability before the arguments, so a refusal never leaks the shape', async () => {
    const response = await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'publish_block', arguments: { nonsense: true } } },
      caller('lesson:read'),
    );

    const result = response?.result as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain('pack:publish');
    expect(result.content[0]?.text).not.toContain('packId');
  });

  it('rejects a tool that does not exist as a protocol error, not a tool error', async () => {
    const response = await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } },
      caller('pack:publish'),
    );

    expect(response?.error?.code).toBe(-32602);
  });
});

describe('the catalogue', () => {
  it('never exposes a learner capability', async () => {
    // A coach credential cannot practise, and the MCP must not become the way around that.
    const learnerOnly: Capability[] = ['drill:practice', 'submission:write', 'progress:read'];

    for (const tool of TOOLS) {
      expect(learnerOnly).not.toContain(tool.capability);
    }
  });

  it('describes every tool it lists', async () => {
    const response = await send(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      caller('lesson:read', 'pack:publish', 'submission:read-all', 'correction:write', 'review:write'),
    );
    const tools = (response?.result as { tools: { name: string; description: string; inputSchema: unknown }[] }).tools;

    expect(tools).toHaveLength(TOOLS.length);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
  });
});
