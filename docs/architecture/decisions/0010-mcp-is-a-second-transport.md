---
title: MCP is a second transport over the same services, hand-written
status: accepted
date: 2026-08-03
---

# ADR-0010 — MCP as a second transport

## Context

[ADR-0001](0001-runtime-not-agent.md) put generation outside the runtime: lessons are authored and
submissions corrected on the other side of `/coach/v1`, today by a person driving a language model.
That person is currently a shell — `curl` for the brief, a model in a chat window, `curl` again to
publish. The evidence goes out as pasted JSON and the block comes back the same way.

The service layer was written transport-agnostic from the start for this reason, and both the map
and the PRD have named the MCP server as the second caller since the first commit.

Two things had to be true first, and now are: the coach services no longer hide rules in the route
file, and the API can answer to more than one OAuth audience.

## Decision

**An MCP server inside the api service, at `/mcp`, over the same `ServiceContext`, the same
capability gate and the same audit trail.** One tool per `/coach/v1` route, calling the same service
functions.

### Hand-written, not on the SDK

`@modelcontextprotocol/sdk` exists and was rejected for this codebase:

- its `StreamableHTTPServerTransport` writes to the raw Node response, so a fastify route must
  `reply.hijack()` — surrendering the shared `{error:{code,message}}` envelope and, more painfully,
  `app.inject()`, which is the entire integration test harness;
- the protocol surface an authoring agent needs is three methods, and identity-service already runs a
  hand-written MCP in production that real clients connect to — the shape is proven in-house;
- this repository carries six runtime dependencies on purpose.

`handler.ts` is transport-agnostic, exactly as identity-service's is, so if a client one day needs
streaming or a protocol revision we do not implement, the transport is replaceable without touching
the tools. That is the revisit trigger.

The one dependency added is `zod-to-json-schema`, so a tool's advertised `inputSchema` is *generated*
from the same zod object that validates the call. A model builds its arguments from that schema; two
hand-maintained copies of it would eventually disagree, and the symptom would be a model that
constructs valid-looking calls the runtime rejects.

### Two gates, not one

The endpoint is the **coach** surface: a token holding no coach capability is refused at the door,
even though two of the tools behind it are content reads a learner may make elsewhere. Then each
tool checks its own capability. `tools/list` is filtered the same way, so a caller is never shown a
toolbox where half the calls would refuse.

There are **no learner tools**. A coach credential cannot practise (ADR-0002), and a second transport
must not become the way around that.

### What is an error, and to whom

- **No token, or a bad one → HTTP 401** with `WWW-Authenticate: Bearer resource_metadata=…`. That is
  what starts a client's OAuth flow; burying it in a JSON-RPC body would strand the client.
- **A missing capability, invalid arguments, or a domain refusal → a tool result with
  `isError: true`.** A model can read "this needs `pack:publish`" or "that category is not declared"
  and act on it. A transport-level failure just looks like the connection broke.

### Writes are audited from the transport, and say so

The routes write their own audit entries rather than the services doing it, so the MCP does too —
with the same `action` and `resource` strings, plus `transport: 'mcp'`. The trail must not fork by
door, but it must be able to tell you which door.

## Consequences

**Good.** The authoring loop becomes one conversation: read the brief, write the block, publish it,
without a human shuttling JSON between windows. Everything that made the HTTP surface safe still
applies, because it is the same code — one capability map, one audit trail, one store. And the tools
are self-describing, so a model does not need the API reference to use them correctly.

**Costs.** Two tables — routes and tools — must stay in step, and only a test notices when they stop;
unifying them behind one operation registry is the obvious next refactor and was deliberately not
bundled with an unproven transport. The protocol is ours to keep current, which is a real if small
maintenance commitment. And the endpoint needs a public hostname and a pre-registered OAuth client
before it is reachable at all, neither of which lives in this repository.

**Found on the way.** Mapping routes onto tools forced the question "what does this one actually
need?" for each route in turn, which is how a learner token was discovered to be able to read another
learner's brief. Fixed separately, before this landed.
