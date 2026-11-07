/** Fields owned by a review decision; bank data is never part of its Undo. */
export interface TransactionReviewState {
  category: string | null;
  effectiveDate: string | null;
  expenseOwnerType: string;
  expenseOwnerMemberId: number | null;
  ownerSource: string;
  ownerConfidence: number | null;
  ownerReviewReason: string | null;
  ignored: boolean;
  needsReview: boolean;
  reviewReason: string | null;
  confidence: number | null;
}

export const reviewFields = [
  'category',
  'effectiveDate',
  'expenseOwnerType',
  'expenseOwnerMemberId',
  'ownerSource',
  'ownerConfidence',
  'ownerReviewReason',
  'ignored',
  'needsReview',
  'reviewReason',
  'confidence',
] as const satisfies ReadonlyArray<keyof TransactionReviewState>;

export function reviewState(transaction: TransactionReviewState): TransactionReviewState {
  return Object.fromEntries(
    reviewFields.map((key) => [key, transaction[key]]),
  ) as unknown as TransactionReviewState;
}

export interface ReviewUndo {
  before: TransactionReviewState;
  after: TransactionReviewState;
}
