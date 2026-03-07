import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

// ─── Param parsing ───

/**
 * Parse a string param to a positive integer.
 * Returns the parsed number on success, or sends a 400 response and returns null.
 */
export function parseIntParam(
  value: string,
  paramName: string,
  reply: FastifyReply,
): number | null {
  const num = parseInt(value, 10);
  if (isNaN(num) || !Number.isInteger(num) || num <= 0) {
    reply.status(400).send({ error: `Invalid ${paramName}` });
    return null;
  }
  return num;
}

// ─── Body validation ───

/**
 * Validate a request body against a Zod schema.
 * Returns parsed data on success, or sends a 400 response and returns null.
 */
export function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  reply: FastifyReply,
): z.infer<T> | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    reply.status(400).send({
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return null;
  }
  return parsed.data;
}

// ─── Service error forwarding ───

/**
 * Forward a service-layer error result as an HTTP response.
 * Use: `if (!result.ok) return sendServiceError(reply, result);`
 */
export function sendServiceError(
  reply: FastifyReply,
  result: { error: string; status: number },
) {
  return reply.status(result.status).send({ error: result.error });
}

// ─── Query validation ───

/**
 * Validate a request query against a Zod schema.
 * Returns parsed data on success, or sends a 400 response and returns null.
 */
export function validateQuery<T extends z.ZodTypeAny>(
  schema: T,
  query: unknown,
  reply: FastifyReply,
): z.infer<T> | null {
  return validateBody(schema, query, reply);
}
