const MANUAL_ACTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface PendingAction {
  resolve: () => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingAction>();

export function waitForManualAction(
  accountId: number,
  onRequested: () => void,
): Promise<void> {
  cancelManualAction(accountId);

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(accountId);
      reject(new Error('Manual action timeout: no confirmation within 5 minutes'));
    }, MANUAL_ACTION_TIMEOUT_MS);

    pending.set(accountId, { resolve, reject, timer });
    onRequested();
  });
}

export function confirmManualAction(accountId: number): boolean {
  const entry = pending.get(accountId);
  if (!entry) return false;

  clearTimeout(entry.timer);
  pending.delete(accountId);
  entry.resolve();
  return true;
}

export function cancelManualAction(accountId: number): void {
  const entry = pending.get(accountId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pending.delete(accountId);
  entry.reject(new Error('Manual action cancelled'));
}
