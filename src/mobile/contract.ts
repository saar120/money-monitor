import type { FastifyReply } from 'fastify';

export const MOBILE_API_VERSION = '1' as const;
export const MOBILE_PROTOCOL_VERSION = 1 as const;
export const MOBILE_RESPONSE_SOURCE = 'live' as const;

export interface MobileResponseMeta {
  apiVersion: typeof MOBILE_API_VERSION;
  generatedAt: string;
  source: typeof MOBILE_RESPONSE_SOURCE;
}

export interface MobileSuccessEnvelope<T> {
  data: T;
  meta: MobileResponseMeta;
}

export interface MobileErrorEnvelope {
  error: {
    code: MobileErrorCode;
    message: string;
  };
  meta: {
    apiVersion: typeof MOBILE_API_VERSION;
    requestId: string;
  };
}

export const MOBILE_ERROR_DEFINITIONS = {
  invalid_request: {
    statusCode: 400,
    message: 'The request could not be processed.',
  },
  validation_error: {
    statusCode: 400,
    message: 'The request contains invalid data.',
  },
  authentication_required: {
    statusCode: 401,
    message: 'Authentication is required.',
  },
  authentication_invalid: {
    statusCode: 401,
    message: 'The device credential is invalid.',
  },
  authentication_expired: {
    statusCode: 401,
    message: 'This device credential has expired.',
  },
  authentication_revoked: {
    statusCode: 401,
    message: 'This iPhone is no longer paired with the Mac.',
  },
  forbidden: {
    statusCode: 403,
    message: 'This device is not allowed to perform that action.',
  },
  capability_required: {
    statusCode: 403,
    message: 'This device does not have the required capability.',
  },
  upgrade_required: {
    statusCode: 426,
    message: 'Update Money Monitor on this iPhone and Mac to continue.',
  },
  pairing_invalid: {
    statusCode: 400,
    message: 'The pairing request could not be verified.',
  },
  pairing_rejected: {
    statusCode: 403,
    message: 'The pairing request was rejected on the Mac.',
  },
  pairing_approval_required: {
    statusCode: 409,
    message: 'Approve this iPhone on the Mac before continuing.',
  },
  pairing_replayed: {
    statusCode: 409,
    message: 'This pairing credential has already been claimed.',
  },
  pairing_exchange_in_progress: {
    statusCode: 409,
    message: 'The pairing credential is already being issued.',
  },
  pairing_expired: {
    statusCode: 410,
    message: 'The pairing request has expired. Create a new code on the Mac.',
  },
  route_not_found: {
    statusCode: 404,
    message: 'The requested mobile route does not exist.',
  },
  payload_too_large: {
    statusCode: 413,
    message: 'The request is too large.',
  },
  rate_limited: {
    statusCode: 429,
    message: 'Too many requests. Please try again later.',
  },
  internal_server_error: {
    statusCode: 500,
    message: 'An unexpected error occurred.',
  },
} as const;

export type MobileErrorCode = keyof typeof MOBILE_ERROR_DEFINITIONS;

/**
 * Creates the public response shape for a successful mobile request.
 * The caller supplies the server-side generation time so tests and coherent
 * multi-query snapshots can share one timestamp.
 */
export function createMobileSuccessEnvelope<T>(
  data: T,
  generatedAt: Date,
): MobileSuccessEnvelope<T> {
  return {
    data,
    meta: {
      apiVersion: MOBILE_API_VERSION,
      generatedAt: generatedAt.toISOString(),
      source: MOBILE_RESPONSE_SOURCE,
    },
  };
}

/**
 * Creates a safe, localizable error envelope from an allow-listed code.
 * Route handlers should never pass raw provider or exception messages to a
 * mobile client.
 */
export function createMobileErrorEnvelope(
  code: MobileErrorCode,
  requestId: string,
): MobileErrorEnvelope {
  return {
    error: {
      code,
      message: MOBILE_ERROR_DEFINITIONS[code].message,
    },
    meta: {
      apiVersion: MOBILE_API_VERSION,
      requestId,
    },
  };
}

export function sendMobileError(reply: FastifyReply, code: MobileErrorCode, requestId: string) {
  return reply
    .status(MOBILE_ERROR_DEFINITIONS[code].statusCode)
    .send(createMobileErrorEnvelope(code, requestId));
}

/** A controlled error that future mobile route/service adapters may throw. */
export class MobileApiError extends Error {
  constructor(readonly code: MobileErrorCode) {
    super(MOBILE_ERROR_DEFINITIONS[code].message);
    this.name = 'MobileApiError';
  }
}
