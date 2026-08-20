import type { FastifyReply } from 'fastify';
import {
  CANONICAL_ERROR_DEFINITIONS,
  CANONICAL_API_VERSION,
  canonicalErrorEnvelopeSchema,
  type CanonicalErrorCode,
} from './contract.js';

export interface CanonicalErrorDetails {
  resourceId?: number;
  expectedVersion?: number;
  currentVersion?: number;
  refreshHints?: Array<{ domain: string; resourceIds: number[] }>;
}

export class CanonicalApiError extends Error {
  constructor(
    readonly code: CanonicalErrorCode,
    readonly details: CanonicalErrorDetails = {},
  ) {
    super(CANONICAL_ERROR_DEFINITIONS[code].message);
    this.name = 'CanonicalApiError';
  }
}

export function createCanonicalErrorEnvelope(
  code: CanonicalErrorCode,
  requestId: string,
  details: CanonicalErrorDetails = {},
) {
  const candidate = {
    error: {
      code,
      message: CANONICAL_ERROR_DEFINITIONS[code].message,
      ...(details.resourceId === undefined ? {} : { resourceId: details.resourceId }),
      ...(details.expectedVersion === undefined
        ? {}
        : { expectedVersion: details.expectedVersion }),
      ...(details.currentVersion === undefined ? {} : { currentVersion: details.currentVersion }),
    },
    meta: {
      apiVersion: CANONICAL_API_VERSION,
      requestId,
      ...(details.refreshHints === undefined ? {} : { refreshHints: details.refreshHints }),
    },
  };

  const parsed = canonicalErrorEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    // This is an implementation defect, not a caller input error.  Keep the
    // fallback safe and stable instead of allowing diagnostics to cross the
    // transport seam.
    return {
      error: {
        code: 'internal_server_error' as const,
        message: CANONICAL_ERROR_DEFINITIONS.internal_server_error.message,
      },
      meta: { apiVersion: CANONICAL_API_VERSION, requestId },
    };
  }
  return parsed.data;
}

export function sendCanonicalError(
  reply: FastifyReply,
  code: CanonicalErrorCode,
  requestId: string,
  details: CanonicalErrorDetails = {},
) {
  return reply
    .status(CANONICAL_ERROR_DEFINITIONS[code].statusCode)
    .send(createCanonicalErrorEnvelope(code, requestId, details));
}
