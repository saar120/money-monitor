export function activityRequestState({
  source,
  loading,
  resultKey,
  requestKey,
  error,
}: {
  source: 'fixture' | 'live';
  loading: boolean;
  resultKey: string;
  requestKey: string;
  error: string | null;
}): 'error' | 'loading' | 'ready' {
  if (source === 'live' && error) return 'error';
  return source === 'live' && (loading || resultKey !== requestKey) ? 'loading' : 'ready';
}
