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
  inclusionSource: 'category' | 'manual' | 'legacy';
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
  'inclusionSource',
  'needsReview',
  'reviewReason',
  'confidence',
] as const satisfies ReadonlyArray<keyof TransactionReviewState>;

export function reviewState(
  transaction: Omit<TransactionReviewState, 'inclusionSource'> & {
    inclusionSource?: TransactionReviewState['inclusionSource'];
  },
): TransactionReviewState {
  return Object.fromEntries(
    reviewFields.map((key) => [
      key,
      key === 'inclusionSource' ? (transaction.inclusionSource ?? 'legacy') : transaction[key],
    ]),
  ) as unknown as TransactionReviewState;
}

export interface ReviewUndo {
  before: TransactionReviewState;
  after: TransactionReviewState;
  afterVersion: number;
}
