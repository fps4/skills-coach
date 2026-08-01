/**
 * A single error vocabulary for both API surfaces.
 *
 * Every failure leaves the system as `{ error: { code, message, details? } }` with a matching
 * status, so a client can branch on `code` rather than parsing prose.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { TokenError } from '../auth/verifier.js';

export type ErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid_request' | 'conflict' | 'internal';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (what: string) => new ApiError('not_found', `${what} not found`);
export const invalid = (message: string, details?: unknown) => new ApiError('invalid_request', message, details);
export const conflict = (message: string) => new ApiError('conflict', message);
export const forbidden = (message: string) => new ApiError('forbidden', message);

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      return reply
        .status(error.status)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }

    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
      return reply
        .status(400)
        .send({ error: { code: 'invalid_request', message: 'request body failed validation', details } });
    }

    if (error instanceof TokenError) {
      return reply
        .status(401)
        .send({ error: { code: 'unauthenticated', message: error.message, details: { reason: error.reason } } });
    }

    // Fastify's own validation and body-parse failures.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: { code: status === 401 ? 'unauthenticated' : 'invalid_request', message: (error as Error).message },
      });
    }

    // Anything unrecognised is a bug: log it in full, tell the caller nothing about internals.
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'internal error' } });
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) =>
    reply.status(404).send({ error: { code: 'not_found', message: `no route for ${request.method} ${request.url}` } }),
  );
}
