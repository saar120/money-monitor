import type { onRequestHookHandler } from 'fastify';
import { sendMobileError, type MobileErrorCode } from './contract.js';
import type { MobileAuthenticationResult, PublicMobileDevice } from './device-registry.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only after a protected mobile route's authentication hook succeeds. */
    mobileDevice?: PublicMobileDevice;
  }
}

export interface MobileCredentialAuthenticator {
  authenticate(token: string, requiredCapability?: string): MobileAuthenticationResult;
}

const BEARER_CREDENTIAL_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/i;

function tokenFromAuthorizationHeader(header: string | undefined): string | null | undefined {
  if (header === undefined) return undefined;
  return BEARER_CREDENTIAL_PATTERN.exec(header)?.[1] ?? null;
}

function errorCodeForAuthenticationResult(
  result: Exclude<MobileAuthenticationResult, { status: 'authenticated' }>,
): MobileErrorCode {
  switch (result.status) {
    case 'invalid':
      return 'authentication_invalid';
    case 'expired':
      return 'authentication_expired';
    case 'revoked':
      return 'authentication_revoked';
    case 'capability_required':
      return 'capability_required';
  }
}

/**
 * Creates an explicit per-route authorization hook. Protected routes must name
 * their required capability instead of inheriting broad desktop authority.
 */
export function createMobileAuthenticationHook(
  authenticator: MobileCredentialAuthenticator,
  requiredCapability: string,
): onRequestHookHandler {
  return async (request, reply) => {
    const token = tokenFromAuthorizationHeader(request.headers.authorization);
    if (token === undefined) {
      return sendMobileError(reply, 'authentication_required', request.id);
    }
    if (token === null) {
      return sendMobileError(reply, 'authentication_invalid', request.id);
    }

    const result = authenticator.authenticate(token, requiredCapability);
    if (result.status !== 'authenticated') {
      return sendMobileError(reply, errorCodeForAuthenticationResult(result), request.id);
    }

    request.mobileDevice = result.device;
  };
}
