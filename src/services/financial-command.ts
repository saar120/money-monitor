import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { db } from '../db/connection.js';
import { mutationReceipts } from '../db/schema.js';

export const financialCommandIdentitySchema = z.object({
  commandId: z.string().uuid(),
  expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export class FinancialCommandError extends Error {
  constructor(
    public readonly code:
      | 'mutation_conflict'
      | 'command_id_reused'
      | 'update_required'
      | 'validation_error'
      | 'not_found',
    public readonly status: number,
    public readonly current?: unknown,
  ) {
    super(code);
  }
}

// Normalize object order without changing array order or persisting the input.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

// The receipt and financial effect share the same SQLite transaction.
export function acceptFinancialCommand<T>(
  database: typeof db,
  clientId: string,
  commandId: string,
  payload: unknown,
  apply: () => T,
): T {
  const digest = createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');
  return database.transaction(() => {
    const receipt = database
      .select()
      .from(mutationReceipts)
      .where(
        and(eq(mutationReceipts.clientId, clientId), eq(mutationReceipts.commandId, commandId)),
      )
      .get();
    if (receipt) {
      if (receipt.payloadDigest !== digest)
        throw new FinancialCommandError('command_id_reused', 409);
      return JSON.parse(receipt.outcome) as T;
    }
    const outcome = apply();
    database
      .insert(mutationReceipts)
      .values({ clientId, commandId, payloadDigest: digest, outcome: JSON.stringify(outcome) })
      .run();
    return outcome;
  });
}
