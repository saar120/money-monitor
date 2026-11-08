/** React Native's AbortSignal does not provide throwIfAborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error('Cancelled');
  error.name = 'AbortError';
  throw error;
}
