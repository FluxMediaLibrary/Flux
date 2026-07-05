/**
 * Central error handling. `ApiError` is thrown by services/routes and rendered
 * into the `ApiError` wire shape (@flux/shared) by the Fastify error handler.
 */
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { ZodError } from 'zod';
import type { ApiError as ApiErrorDTO } from '@flux/shared';

export class ApiError extends Error {
  readonly statusCode: number;
  /** Short machine-readable code, e.g. "UNAUTHORIZED". */
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  static badRequest(message: string, code = 'BAD_REQUEST') {
    return new ApiError(400, code, message);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }
  static conflict(message: string, code = 'CONFLICT') {
    return new ApiError(409, code, message);
  }
  static internal(message = 'Internal server error', code = 'INTERNAL') {
    return new ApiError(500, code, message);
  }
}

/** Register the Fastify error handler that emits the ApiError DTO shape. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      // Our own domain errors.
      if (error instanceof ApiError) {
        const body: ApiErrorDTO = {
          error: error.code,
          message: error.message,
          statusCode: error.statusCode,
        };
        return reply.status(error.statusCode).send(body);
      }

      // Zod validation errors (from manual .parse in handlers).
      if (error instanceof ZodError) {
        const body: ApiErrorDTO = {
          error: 'VALIDATION_ERROR',
          message: error.issues
            .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
            .join('; '),
          statusCode: 400,
        };
        return reply.status(400).send(body);
      }

      // Fastify's built-in validation / known HTTP errors carry statusCode.
      const statusCode =
        typeof error.statusCode === 'number' ? error.statusCode : 500;

      if (statusCode >= 500) {
        request.log.error(error);
      }

      const body: ApiErrorDTO = {
        error: error.code ?? 'INTERNAL',
        message:
          statusCode >= 500 ? 'Internal server error' : error.message,
        statusCode,
      };
      return reply.status(statusCode).send(body);
    },
  );

  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorDTO = {
      error: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
    };
    return reply.status(404).send(body);
  });
}
