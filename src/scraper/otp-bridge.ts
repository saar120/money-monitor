const OTP_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

interface PendingOtp {
  resolve: (code: string) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingOtp>();

export function waitForOtp(
  accountId: number,
  onRequested: () => void,
): Promise<string> {
  cancelOtp(accountId);

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(accountId);
      reject(new Error('OTP timeout: no code submitted within 2 minutes'));
    }, OTP_TIMEOUT_MS);

    pending.set(accountId, { resolve, reject, timer });
    onRequested();
  });
}

export function submitOtp(accountId: number, code: string): boolean {
  const entry = pending.get(accountId);
  if (!entry) return false;

  clearTimeout(entry.timer);
  pending.delete(accountId);
  entry.resolve(code);
  return true;
}

export function cancelOtp(accountId: number): void {
  const entry = pending.get(accountId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pending.delete(accountId);
  entry.reject(new Error('OTP cancelled'));
}
