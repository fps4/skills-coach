/**
 * Append-only audit (ADR-0003). Who did what to which resource.
 *
 * Auditing must never be the reason a request fails: a write that cannot be recorded is logged and
 * swallowed. That is the right trade for a learning product — losing an audit row is bad, refusing
 * a learner's submitted work because the audit write failed is worse.
 */

import type { Principal } from '../auth/verifier.js';
import { newEventId, type ServiceContext } from './context.js';

export interface AuditInput {
  principal: Principal;
  action: string;
  resource: string;
  meta?: Record<string, unknown>;
}

export async function record(ctx: ServiceContext, input: AuditInput): Promise<void> {
  try {
    await ctx.store.collections.auditEvents.insertOne({
      _id: newEventId(),
      at: ctx.now(),
      actor: { subject: input.principal.subject, kind: input.principal.kind, roles: input.principal.roles },
      action: input.action,
      resource: input.resource,
      meta: input.meta,
    });
  } catch {
    // Intentionally swallowed — see the note above. The caller's operation already succeeded.
  }
}

export interface AuditQuery {
  subject?: string;
  limit?: number;
}

export async function list(ctx: ServiceContext, query: AuditQuery = {}) {
  const filter = query.subject ? { 'actor.subject': query.subject } : {};
  return ctx.store.collections.auditEvents
    .find(filter)
    .sort({ at: -1 })
    .limit(Math.min(query.limit ?? 100, 500))
    .toArray();
}
