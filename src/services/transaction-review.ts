import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions } from '../db/schema.js';
import {
  reviewFields,
  reviewState,
  type ReviewUndo,
  type TransactionReviewState,
} from '../shared/transaction-review.js';
import type { OwnerType } from '../shared/types.js';
import { getTransactionById } from './transactions.js';
import { applyTransactionCommand } from './transaction-command.js';
import { acceptFinancialCommand, FinancialCommandError } from './financial-command.js';

function currentReview(id: number, expectedVersion: number, expected: TransactionReviewState) {
  const current = getTransactionById(id);
  if (!current) throw new FinancialCommandError('not_found', 404);
  if (
    current.resourceVersion !== expectedVersion ||
    !reviewFields.every((key) => current[key] === expected[key])
  )
    throw new FinancialCommandError('mutation_conflict', 409, current);
  return current;
}
export function saveReviewDecision(
  id: number,
  input: {
    commandId: string;
    expectedVersion: number;
    expected: TransactionReviewState;
    category: string;
    ownerType: OwnerType;
    ownerMemberId?: number | null;
    included?: boolean;
    effectiveDate?: string | null;
  },
) {
  return acceptFinancialCommand(
    db,
    'desktop',
    input.commandId,
    { kind: 'review', id, ...input },
    () => {
      const before = currentReview(id, input.expectedVersion, input.expected);
      if (!before.needsReview) throw new FinancialCommandError('mutation_conflict', 409, before);
      const result = applyTransactionCommand(
        id,
        {
          commandId: input.commandId,
          expectedVersion: input.expectedVersion,
          patch: {
            category: input.category,
            reviewed: true,
            owner: { type: input.ownerType, memberId: input.ownerMemberId },
            ...(input.included !== undefined ? { ignored: !input.included } : {}),
            ...(input.effectiveDate !== undefined ? { effectiveDate: input.effectiveDate } : {}),
          },
        },
        db,
      );
      return {
        transaction: result.transaction,
        undo: {
          before: reviewState(before),
          after: reviewState(result.transaction),
          afterVersion: result.transaction.resourceVersion,
        },
      };
    },
  );
}
export function undoReviewDecision(
  id: number,
  input: ReviewUndo & { commandId: string; expectedVersion: number },
) {
  return acceptFinancialCommand(
    db,
    'desktop',
    input.commandId,
    { kind: 'review-undo', id, ...input },
    () => {
      const current = currentReview(id, input.expectedVersion, input.after);
      if (
        !input.before.needsReview ||
        input.after.needsReview ||
        input.afterVersion !== current.resourceVersion
      )
        throw new FinancialCommandError('mutation_conflict', 409, current);
      db.update(transactions).set(input.before).where(eq(transactions.id, id)).run();
      const transaction = getTransactionById(id);
      return { transaction: transaction! };
    },
  );
}
