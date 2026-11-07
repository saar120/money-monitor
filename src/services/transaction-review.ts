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
import { isCategoryIgnored } from './categories.js';
import { setTransactionOwner, validateOwnerTarget } from './ownership.js';
import {
  getTransactionById,
  resolveReview,
  setTransactionIgnored,
  updateTransactionEffectiveDate,
} from './transactions.js';

function matches(current: TransactionReviewState, expected: TransactionReviewState) {
  return reviewFields.every((key) => current[key] === expected[key]);
}
const conflict = () => ({
  ok: false as const,
  status: 409,
  error: 'Transaction changed. Reload it and review the latest values.',
});
const missing = () => ({ ok: false as const, status: 404, error: 'Transaction not found' });

export function saveReviewDecision(
  id: number,
  input: {
    expected: TransactionReviewState;
    category: string;
    ownerType: OwnerType;
    ownerMemberId?: number | null;
    included?: boolean;
    effectiveDate?: string | null;
  },
) {
  const owner = validateOwnerTarget({ type: input.ownerType, memberId: input.ownerMemberId });
  if (!owner.ok) return owner;
  // A decision either saves every field or leaves the pending transaction untouched.
  return db.transaction(() => {
    const before = getTransactionById(id);
    if (!before) return missing();
    if (!before.needsReview || !matches(before, input.expected)) return conflict();
    const snapshot = reviewState(before);
    let updated = resolveReview(id, input.category)!;
    if (
      updated.expenseOwnerType !== owner.target.type ||
      updated.expenseOwnerMemberId !== owner.target.memberId
    ) {
      const result = setTransactionOwner(id, owner.target);
      if (!result.ok) throw new Error(result.error);
      updated = result.transaction;
    }
    const excludedByHand = before.ignored && !isCategoryIgnored(before.category);
    const ignored =
      input.included === undefined ? excludedByHand || updated.ignored : !input.included;
    if (ignored !== updated.ignored) updated = setTransactionIgnored(id, ignored)!;
    if (input.effectiveDate !== undefined && input.effectiveDate !== updated.effectiveDate)
      updated = updateTransactionEffectiveDate(id, input.effectiveDate)!;
    return {
      ok: true as const,
      transaction: updated,
      undo: { before: snapshot, after: reviewState(updated) },
    };
  });
}

export function undoReviewDecision(id: number, undo: ReviewUndo) {
  return db.transaction(() => {
    const current = getTransactionById(id);
    if (!current) return missing();
    if (!undo.before.needsReview || undo.after.needsReview || !matches(current, undo.after))
      return conflict();
    // Comparing and restoring happen inside the same transaction, so Undo cannot overwrite a later edit.
    const [transaction] = db
      .update(transactions)
      .set(undo.before)
      .where(eq(transactions.id, id))
      .returning()
      .all();
    return { ok: true as const, transaction: transaction! };
  });
}
