/**
 * The MCP core: JSON-RPC in, JSON-RPC out, no transport in sight.
 *
 * Everything except how bytes reach us lives here — the tool catalogue, the capability gate, the
 * audit write, the error mapping. A transport is then just "parse a message, hand it over with the
 * verified caller, write back what comes out", which is what keeps a second transport from
 * duplicating any of it.
 *
 * Written by hand rather than on an SDK (ADR-0010). The protocol surface an authoring agent needs is
 * three methods, the identity-service MCP is a working precedent for exactly this shape, and
 * bridging an SDK transport to fastify would mean taking over the raw response and losing both the
 * shared error envelope and `app.inject` in tests.
 */

import { ZodError, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { requireCapabilityOn, type RequestAuth } from '../auth/plugin.js';
import { ApiError } from '../http/errors.js';
import * as audit from '../services/audit.js';
import type { ServiceContext } from '../services/context.js';
import { TOOLS, TOOLS_BY_NAME } from './tools.js';

export const SERVER_INFO = { name: 'skills-coach', version: '0.1.0' } as const;

/**
 * Protocol versions we know how to speak, newest first.
 *
 * A client's requested version is echoed when we know it, per the spec; anything else gets our
 * newest, and the client decides whether it can live with that.
 */
export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const ok = (id: JsonRpcResponse['id'], result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
const fail = (id: JsonRpcResponse['id'], code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

/** A tool failure the model should read and react to, as opposed to a protocol error. */
const toolError = (id: JsonRpcResponse['id'], message: string, details?: unknown): JsonRpcResponse =>
  ok(id, {
    isError: true,
    content: [
      { type: 'text', text: details === undefined ? message : `${message}\n${JSON.stringify(details, null, 2)}` },
    ],
  });

function describe(tool: { name: string; description: string; input: ZodTypeAny; readOnly: boolean }) {
  return {
    name: tool.name,
    description: tool.description,
    // Inlined rather than `$ref`-linked: a model reads this to build its arguments, and indirection
    // through `$defs` is one more thing for it to get wrong.
    inputSchema: zodToJsonSchema(tool.input, { $refStrategy: 'none', target: 'jsonSchema7' }),
    annotations: { readOnlyHint: tool.readOnly, destructiveHint: false },
  };
}

/**
 * Dispatch one message.
 *
 * Returns null for a notification, which by JSON-RPC has no reply. Capability failures come back as
 * *tool* errors rather than HTTP status codes — a model can read "this needs the pack:publish
 * capability" and stop, where a 403 would just look like the transport broke. Authentication is the
 * exception and is handled a layer up, because a 401 is what starts a client's OAuth flow.
 */
export async function handleRpc(
  message: JsonRpcRequest,
  context: {
    ctx: ServiceContext;
    auth: RequestAuth;
    /** The transport's logger. Nothing here writes to stdout on its own (ADR-0003). */
    log?: (error: unknown, message: string) => void;
  },
): Promise<JsonRpcResponse | null> {
  const { ctx, auth } = context;
  const id = message.id ?? null;
  const isNotification = message.id === undefined;

  if (message.jsonrpc && message.jsonrpc !== '2.0') {
    return isNotification ? null : fail(id, INVALID_REQUEST, 'jsonrpc must be "2.0"');
  }
  if (!message.method) {
    return isNotification ? null : fail(id, INVALID_REQUEST, 'a request needs a method');
  }

  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.['protocolVersion'];
      const version =
        typeof requested === 'string' && (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested)
          ? requested
          : DEFAULT_PROTOCOL;

      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'The coach surface of Skills Coach. Read a brief before authoring a block, and correct submissions by ' +
          'naming the pack’s declared error categories — the runtime derives every counter from those.',
      });
    }

    // Lifecycle notifications: acknowledged by having nothing to say about them.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return ok(id, {});

    case 'tools/list': {
      // Filtered by capability, so a learner token sees an empty toolbox rather than a wall of
      // tools that all refuse. What you can see is what you can do.
      const visible = TOOLS.filter((tool) => auth.capabilities.has(tool.capability));
      return ok(id, { tools: visible.map(describe) });
    }

    case 'tools/call': {
      const name = message.params?.['name'];
      if (typeof name !== 'string') return fail(id, INVALID_PARAMS, 'tools/call needs a tool name');

      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return fail(id, INVALID_PARAMS, `no such tool: ${name}`);

      try {
        requireCapabilityOn(auth, tool.capability);
      } catch (error) {
        return toolError(id, error instanceof ApiError ? error.message : `refused: ${name}`);
      }

      let args: unknown;
      try {
        args = tool.input.parse(message.params?.['arguments'] ?? {});
      } catch (error) {
        if (error instanceof ZodError) {
          return toolError(
            id,
            `invalid arguments for ${name}`,
            error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          );
        }
        throw error;
      }

      try {
        const { result, audit: entry } = await tool.run(ctx, args, auth);

        // Written from here rather than from the service, exactly as the routes do it — and tagged,
        // so the trail says which door a write came through instead of forking by transport.
        if (entry) {
          await audit.record(ctx, {
            principal: auth.principal,
            action: entry.action,
            resource: entry.resource,
            meta: { transport: 'mcp', ...entry.meta },
          });
        }

        return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (error) {
        // A domain refusal — an undeclared category, a double correction, a missing block — is
        // information the model needs, not a broken transport.
        if (error instanceof ApiError) return toolError(id, error.message, error.details);
        context.log?.(error, `mcp tool ${name} failed`);
        return fail(id, INTERNAL_ERROR, 'internal error');
      }
    }

    default:
      return isNotification ? null : fail(id, METHOD_NOT_FOUND, `unsupported method: ${message.method}`);
  }
}

export const JSON_RPC_ERRORS = { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR };
