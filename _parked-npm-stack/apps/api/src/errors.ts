/**
 * Application error types + a Fastify error handler that renders a consistent ApiError shape.
 * Zod validation errors become 400s; AppError carries an explicit status; everything else is a
 * 500 (details hidden in production).
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ApiError } from '@mdp/shared';

/** Explicit, thrown-by-us HTTP error. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const unauthorized = (msg = 'Not authenticated') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Not permitted') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (msg = 'Conflict', details?: unknown) =>
  new AppError(409, 'CONFLICT', msg, details);
export const badRequest = (msg = 'Bad request', details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);

export function registerErrorHandler(
  err: FastifyError | AppError | ZodError,
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod validation failures -> 400 with field details
  if (err instanceof ZodError) {
    const body: ApiError = {
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: err.flatten(),
    };
    reply.status(400).send(body);
    return;
  }

  if (err instanceof AppError) {
    const body: ApiError = { error: err.code, message: err.message, details: err.details };
    reply.status(err.statusCode).send(body);
    return;
  }

  // Unknown error -> 500. Log server-side; don't leak internals to the client.
  req.log.error(err);
  const body: ApiError = {
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
  reply.status(500).send(body);
}
