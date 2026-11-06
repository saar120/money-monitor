export type ReviewViewState = 'loading' | 'error' | 'complete' | 'transaction';

export function getReviewViewState({
  loading,
  saving,
  hasCurrent,
  hasError,
  remaining,
}: {
  loading: boolean;
  saving: boolean;
  hasCurrent: boolean;
  hasError: boolean;
  remaining: number;
}): ReviewViewState {
  if (!hasCurrent && (loading || saving || (!hasError && remaining > 0))) return 'loading';
  if (!hasCurrent && hasError && remaining > 0) return 'error';
  if (!hasCurrent) return 'complete';
  return 'transaction';
}

// The picked category is the only signal of a change: a card held after a failed save already shows it.
// The Mac sets inclusion from a new category, so an exclusion shown on the card goes with it.
export function reviewConfirmation(
  category?: string,
  included?: boolean,
): { category?: string; included?: boolean; reviewed: true } {
  if (!category) return { reviewed: true };
  return included === undefined
    ? { category, reviewed: true }
    : { category, included, reviewed: true };
}
