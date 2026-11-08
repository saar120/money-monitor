import type { Transaction } from './fixtures.ts';
export type RequestFailureKind = 'api' | 'timeout' | 'cancelled' | 'network-unknown';
export class MobileRequestError extends Error {
  current?: Transaction;
  readonly kind: RequestFailureKind;
  readonly code?: string;
  readonly status?: number;
  constructor(
    kind: RequestFailureKind,
    message: string,
    code?: string,
    status?: number,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}
export function terminalAuthenticationError(error: unknown): boolean {
  return (
    error instanceof MobileRequestError &&
    ['authentication_invalid', 'authentication_expired', 'authentication_revoked'].includes(
      error.code ?? '',
    )
  );
}
type AuthenticationInvalidation = { authorization: string; url: string; code: string };
const listeners = new Set<(event: AuthenticationInvalidation) => void>();
export function observeAuthenticationInvalidation(
  listener: (event: AuthenticationInvalidation) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function invalidateAuthentication(event: AuthenticationInvalidation) {
  listeners.forEach((listener) => listener(event));
}
