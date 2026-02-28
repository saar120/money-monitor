interface PendingEntry<T> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingBridge<T> {
  waitFor(accountId: number, onRequested: () => void): Promise<T>;
  confirm(accountId: number, value: T): boolean;
  cancel(accountId: number): void;
}

export function createPendingBridge<T>(timeoutMs: number, label: string): PendingBridge<T> {
  const pending = new Map<number, PendingEntry<T>>();

  function cancel(accountId: number): void {
    const entry = pending.get(accountId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(accountId);
    entry.reject(new Error(`${label} cancelled`));
  }

  function waitFor(accountId: number, onRequested: () => void): Promise<T> {
    cancel(accountId);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(accountId);
        reject(new Error(`${label} timeout: no response within ${timeoutMs / 1000}s`));
      }, timeoutMs);

      pending.set(accountId, { resolve, reject, timer });
      onRequested();
    });
  }

  function confirm(accountId: number, value: T): boolean {
    const entry = pending.get(accountId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pending.delete(accountId);
    entry.resolve(value);
    return true;
  }

  return { waitFor, confirm, cancel };
}
