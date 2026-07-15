import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MobileApiError, createMobileSuccessEnvelope, type MobileErrorCode } from './contract.js';
import type {
  PairingClaimResult,
  PairingPollResult,
  PairingRequestInput,
  PairingRequestResult,
} from './pairing-session.js';

export const MOBILE_PAIRING_START_ROUTE = '/api/mobile/v1/pairing/start' as const;
export const MOBILE_PAIRING_STATUS_ROUTE = '/api/mobile/v1/pairing/status' as const;
export const MOBILE_PAIRING_EXCHANGE_ROUTE = '/api/mobile/v1/pairing/exchange' as const;
export const MOBILE_PAIRING_BODY_LIMIT_BYTES = 2_048;
export const MOBILE_PAIRING_POLL_AFTER_SECONDS = 1 as const;

const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CLAIMANT_SECRET_PATTERN = TOKEN_PATTERN;

const pairingIdSchema = z.string().regex(OPAQUE_ID_PATTERN);

const pairingStartBodySchema = z
  .object({
    pairingId: pairingIdSchema,
    // Keep invalid-but-bounded values for the session manager so malformed
    // proof attempts participate in its per-session limiter.
    nonce: z.string().max(128),
    serverId: z.string().max(128),
    protocolVersion: z.number().int().min(1).max(2_147_483_647),
    deviceName: z.string().max(256),
  })
  .strict();

const pairingClaimantBodySchema = z
  .object({
    pairingId: pairingIdSchema,
    claimantSecret: z.string().regex(CLAIMANT_SECRET_PATTERN),
  })
  .strict();

const publicDeviceSchema = z
  .object({
    id: z.string().regex(OPAQUE_ID_PATTERN),
    name: z.string().trim().min(1).max(80),
    capabilities: z.array(z.literal('mobile.read')).length(1),
    protocolVersion: z.number().int().min(1),
    tokenVersion: z.number().int().min(1),
    createdAt: z.string().regex(UTC_INSTANT_PATTERN),
    lastUsedAt: z.string().regex(UTC_INSTANT_PATTERN).nullable(),
    expiresAt: z.string().regex(UTC_INSTANT_PATTERN).nullable(),
    rotatedAt: z.string().regex(UTC_INSTANT_PATTERN).nullable(),
    revokedAt: z.string().regex(UTC_INSTANT_PATTERN).nullable(),
  })
  .strict();

const pairingCredentialSchema = z
  .object({
    device: publicDeviceSchema,
    token: z.string().regex(TOKEN_PATTERN),
  })
  .strict();

export type MobilePairingCredential = z.infer<typeof pairingCredentialSchema>;

/**
 * Deliberately excludes approve/reject/create. Those operations belong to the
 * trusted Mac UI and cannot be reached through the public mobile listener.
 */
export interface MobilePairingPublicSessions {
  request(input: PairingRequestInput): PairingRequestResult;
  poll(pairingId: string, claimantSecret: string): PairingPollResult;
  claim(pairingId: string, claimantSecret: string): PairingClaimResult<unknown>;
}

export interface MobilePairingRouteDependencies {
  sessions: MobilePairingPublicSessions;
}

interface PairingPendingData {
  status: 'pending_approval';
  expiresAt: string;
  pollAfterSeconds: typeof MOBILE_PAIRING_POLL_AFTER_SECONDS;
  claimantSecret?: string;
}

interface PairingApprovedData {
  status: 'approved';
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new MobileApiError('validation_error');
  return parsed.data;
}

function pairingError(code: MobileErrorCode): never {
  throw new MobileApiError(code);
}

function pendingData(expiresAt: string | undefined, claimantSecret?: string): PairingPendingData {
  if (!expiresAt) pairingError('internal_server_error');
  return {
    status: 'pending_approval',
    expiresAt,
    pollAfterSeconds: MOBILE_PAIRING_POLL_AFTER_SECONDS,
    ...(claimantSecret ? { claimantSecret } : {}),
  };
}

function sendApproved(reply: FastifyReply, clock: () => Date) {
  const data: PairingApprovedData = { status: 'approved' };
  return reply.send(createMobileSuccessEnvelope(data, clock()));
}

function sendPending(
  reply: FastifyReply,
  clock: () => Date,
  expiresAt: string | undefined,
  statusCode: 200 | 202,
  claimantSecret?: string,
) {
  return reply
    .status(statusCode)
    .send(createMobileSuccessEnvelope(pendingData(expiresAt, claimantSecret), clock()));
}

function mapStartResult(result: PairingRequestResult, reply: FastifyReply, clock: () => Date) {
  switch (result.status) {
    case 'pending_approval': {
      return sendPending(reply, clock, result.request.expiresAt, 202, result.claimantSecret);
    }
    case 'already_requested':
    case 'already_approved':
    case 'already_claimed':
      return pairingError('pairing_replayed');
    case 'pairing_not_found':
    case 'invalid_nonce':
    case 'server_mismatch':
      return pairingError('pairing_invalid');
    case 'incompatible_protocol':
      return pairingError('upgrade_required');
    case 'invalid_device_name':
      return pairingError('validation_error');
    case 'pairing_expired':
      return pairingError('pairing_expired');
    case 'pairing_rejected':
      return pairingError('pairing_rejected');
    case 'credential_issue_failed':
      return pairingError('internal_server_error');
    case 'rate_limited':
      return pairingError('rate_limited');
  }
}

function mapPollResult(result: PairingPollResult, reply: FastifyReply, clock: () => Date) {
  if (result.status !== 'available') {
    return pairingError('pairing_invalid');
  }
  const { snapshot } = result;
  if (snapshot.status === 'awaiting_request') return pairingError('pairing_invalid');

  switch (snapshot.status) {
    case 'pending_approval':
      return sendPending(reply, clock, snapshot.approvalExpiresAt, 200);
    case 'approved':
      return sendApproved(reply, clock);
    case 'rejected':
      return pairingError('pairing_rejected');
    case 'expired':
      return pairingError('pairing_expired');
    case 'issuing_credential':
      return pairingError('pairing_exchange_in_progress');
    case 'claimed':
      return pairingError('pairing_replayed');
    case 'credential_issue_failed':
      return pairingError('internal_server_error');
  }
}

function mapClaimResult(
  result: PairingClaimResult<unknown>,
  reply: FastifyReply,
  clock: () => Date,
) {
  switch (result.status) {
    case 'claimed': {
      const credential = pairingCredentialSchema.safeParse(result.credential);
      if (!credential.success) return pairingError('internal_server_error');
      return reply.status(result.isRetry ? 200 : 201).send(
        createMobileSuccessEnvelope(
          {
            status: 'claimed' as const,
            credential: credential.data,
          },
          clock(),
        ),
      );
    }
    case 'pairing_not_found':
    case 'invalid_claimant':
      return pairingError('pairing_invalid');
    case 'pairing_expired':
      return pairingError('pairing_expired');
    case 'pairing_rejected':
      return pairingError('pairing_rejected');
    case 'approval_required':
      return pairingError('pairing_approval_required');
    case 'already_claimed':
      return pairingError('pairing_replayed');
    case 'claim_in_progress':
      return pairingError('pairing_exchange_in_progress');
    case 'credential_issue_failed':
      return pairingError('internal_server_error');
  }
}

export function registerMobilePairingRoutes(
  app: FastifyInstance,
  dependencies: MobilePairingRouteDependencies,
  clock: () => Date,
): void {
  const { sessions } = dependencies;
  const routeOptions = { bodyLimit: MOBILE_PAIRING_BODY_LIMIT_BYTES } as const;

  app.post(MOBILE_PAIRING_START_ROUTE, routeOptions, async (request, reply) => {
    const input = parseBody(pairingStartBodySchema, request.body);
    return mapStartResult(sessions.request(input), reply, clock);
  });

  app.post(MOBILE_PAIRING_STATUS_ROUTE, routeOptions, async (request, reply) => {
    const { pairingId, claimantSecret } = parseBody(pairingClaimantBodySchema, request.body);
    return mapPollResult(sessions.poll(pairingId, claimantSecret), reply, clock);
  });

  app.post(MOBILE_PAIRING_EXCHANGE_ROUTE, routeOptions, async (request, reply) => {
    const { pairingId, claimantSecret } = parseBody(pairingClaimantBodySchema, request.body);
    return mapClaimResult(sessions.claim(pairingId, claimantSecret), reply, clock);
  });
}
