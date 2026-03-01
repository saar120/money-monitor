import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { eq, gte, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { transactions } from '../db/schema.js';
import { accountTypeCondition } from './validation.js';

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

// ─── Transaction filter builder ───

export interface TransactionFilterParams {
  accountType?: string;
  accountId?: number;
  startDate?: string;
  endDate?: string;
}

export interface TransactionFilterResult {
  conditions: SQL[];
  /** True if accountType was specified but had no matching accounts (empty result). */
  empty: boolean;
}

/**
 * Build Drizzle conditions for common transaction filters
 * (accountType, accountId, startDate, endDate).
 *
 * Returns `{ conditions, empty }`. When `empty` is true the caller should
 * return an empty result set immediately.
 */
export function buildTransactionFilters(
  params: TransactionFilterParams,
): TransactionFilterResult {
  const conditions: SQL[] = [];

  if (params.accountType) {
    const cond = accountTypeCondition(params.accountType);
    if (!cond) return { conditions: [], empty: true };
    conditions.push(cond);
  }

  if (params.accountId !== undefined) {
    conditions.push(eq(transactions.accountId, params.accountId));
  }
  if (params.startDate) {
    conditions.push(gte(transactions.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(transactions.date, params.endDate));
  }

  return { conditions, empty: false };
}
