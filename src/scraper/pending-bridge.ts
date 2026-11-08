import { randomUUID } from 'node:crypto';
interface PendingEntry<T> {
  challengeId: string;
  sessionId?: number;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
}
export interface Challenge {
  challengeId: string;
  sessionId?: number;
  accountId: number;
}
export function createPendingBridge<T>(timeoutMs: number, label: string) {
  const pending = new Map<number, PendingEntry<T>>();
  function settle(
    accountId: number,
    challengeId: string,
    outcome: { value: T } | { error: Error },
  ) {
    const entry = pending.get(accountId);
    if (!entry || entry.challengeId !== challengeId) return false;
    pending.delete(accountId);
    entry.cleanup();
    if ('error' in outcome) entry.reject(outcome.error);
    else entry.resolve(outcome.value);
    return true;
  }
  function cancel(accountId: number) {
    const entry = pending.get(accountId);
    if (entry) settle(accountId, entry.challengeId, { error: new Error(`${label} cancelled`) });
  }
  function waitFor(
    accountId: number,
    onRequested: (challenge: Challenge) => void,
    options: { sessionId?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    cancel(accountId);
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error(`${label} cancelled`));
        return;
      }
      const challengeId = randomUUID();
      const abort = () =>
        settle(accountId, challengeId, { error: new Error(`${label} cancelled`) });
      const timer = setTimeout(
        () =>
          settle(accountId, challengeId, {
            error: new Error(`${label} timeout: no response within ${timeoutMs / 1000}s`),
          }),
        timeoutMs,
      );
      pending.set(accountId, {
        challengeId,
        sessionId: options.sessionId,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
        },
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        onRequested({ accountId, challengeId, sessionId: options.sessionId });
      } catch (cause) {
        settle(accountId, challengeId, {
          error: cause instanceof Error ? cause : new Error(label + ' failed'),
        });
      }
    });
  }
  return {
    waitFor,
    cancel,
    confirm: (accountId: number, value: T, challengeId?: string) =>
      challengeId ? settle(accountId, challengeId, { value }) : false,
    challenges: () =>
      Array.from(pending, ([accountId, entry]) => ({
        accountId,
        challengeId: entry.challengeId,
        sessionId: entry.sessionId,
      })),
  };
}
