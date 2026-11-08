import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { db } from '../db/connection.js';
import { categories, members, transactions } from '../db/schema.js';
import { automaticOwnershipValues } from './ownership-resolution.js';
import {
  acceptFinancialCommand,
  financialCommandIdentitySchema,
  FinancialCommandError,
} from './financial-command.js';
export const transactionCommandSchema = financialCommandIdentitySchema
  .extend({
    patch: z
      .object({
        category: z.string().trim().min(1).max(80).nullable().optional(),
        ignored: z.boolean().optional(),
        effectiveDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((v) => {
            const date = new Date(v + 'T00:00:00.000Z');
            return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
          })
          .nullable()
          .optional(),
        reviewed: z.literal(true).optional(),
        confidence: z.number().min(0).max(1).optional(),
        reviewReason: z.string().trim().min(1).max(500).optional(),
        owner: z
          .object({
            type: z.enum(['member', 'shared', 'unassigned']),
            memberId: z.number().int().positive().nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0),
  })
  .strict();

export function commandTransaction(
  id: number,
  input: unknown,
  clientId: string,
  database: typeof db,
) {
  const command = transactionCommandSchema.parse(input);
  return acceptFinancialCommand(
    database,
    clientId,
    command.commandId,
    { kind: 'transaction', id, ...command },
    () => applyTransactionCommand(id, command, database),
  );
}

/** Version-checked effect; callers commit it and their accepted projection with a receipt. */
export function applyTransactionCommand(
  id: number,
  command: z.infer<typeof transactionCommandSchema>,
  database: typeof db,
) {
  const current = database.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!current) throw new FinancialCommandError('not_found', 404);
  if (current.resourceVersion !== command.expectedVersion)
    throw new FinancialCommandError('mutation_conflict', 409, current);
  const patch = command.patch;
  const values: Partial<typeof transactions.$inferInsert> = {};
  if (patch.category !== undefined) {
    const category =
      patch.category === null
        ? null
        : database.select().from(categories).where(eq(categories.name, patch.category)).get();
    if (patch.category !== null && !category)
      throw new FinancialCommandError('validation_error', 400);
    values.category = patch.category;
    values.needsReview = patch.confidence !== undefined && patch.confidence < 0.8;
    values.reviewReason = values.needsReview
      ? (patch.reviewReason ?? 'Low confidence categorization')
      : null;
    values.confidence = patch.confidence ?? null;
    if (current.inclusionSource === 'category')
      values.ignored = category?.ignoredFromStats ?? false;
    Object.assign(
      values,
      automaticOwnershipValues({ ...current, category: patch.category }, database),
    );
  }
  if (patch.owner) {
    const { type, memberId } = patch.owner;
    if (
      type === 'member' &&
      (!memberId ||
        !database
          .select()
          .from(members)
          .where(and(eq(members.id, memberId), eq(members.isActive, true)))
          .get())
    ) {
      throw new FinancialCommandError('validation_error', 400);
    }
    if (type !== 'member' && memberId != null)
      throw new FinancialCommandError('validation_error', 400);
    Object.assign(values, {
      expenseOwnerType: type,
      expenseOwnerMemberId: type === 'member' ? memberId : null,
      ownerSource: 'manual',
      ownerConfidence: 1,
      ownerReviewReason: null,
    });
  }
  if (patch.ignored !== undefined)
    Object.assign(values, { ignored: patch.ignored, inclusionSource: 'manual' });
  if (patch.effectiveDate !== undefined) values.effectiveDate = patch.effectiveDate;
  if (patch.reviewed) Object.assign(values, { needsReview: false, reviewReason: null });
  database.update(transactions).set(values).where(eq(transactions.id, id)).run();
  const transaction = database.select().from(transactions).where(eq(transactions.id, id)).get()!;
  return { commandId: command.commandId, transaction };
}
