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
