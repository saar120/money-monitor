import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const DEFAULT_PAIRING_EXPIRY_MS = 5 * 60 * 1000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
export const PAIRING_INVALID_ATTEMPT_WINDOW_MS = 60 * 1000;
export const PAIRING_INVALID_ATTEMPT_LIMIT = 5;
export const PAIRING_QR_PAYLOAD_VERSION = 1 as const;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NONCE_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_DEVICE_NAME_LENGTH = 80;

export interface PairingQrPayload {
  kind: 'money-monitor-pairing';
  version: typeof PAIRING_QR_PAYLOAD_VERSION;
  pairingId: string;
  nonce: string;
  serverId: string;
  baseURL: string;
  protocolVersion: number;
  expiresAt: string;
}

export interface CreatedPairingSession {
  status: 'created';
  /** The only API that exposes the raw nonce. Do not persist this payload. */
  qrPayload: PairingQrPayload;
}

/**
 * Trusted-Mac-only input. `replacementDeviceId` is retained in memory for the
 * credential issuer and is deliberately absent from QR and public snapshots.
 */
export interface PairingSessionCreationInput {
  replacementDeviceId?: string;
}

export interface PairingRequestInput {
  pairingId: string;
  nonce: string;
  serverId: string;
  protocolVersion: number;
  deviceName: string;
}

export interface PairingApprovalRequest {
  pairingId: string;
  deviceName: string;
  requestedAt: string;
  expiresAt: string;
}

export type PairingRequestResult =
  | { status: 'pending_approval'; request: PairingApprovalRequest; claimantSecret: string }
  | { status: 'pairing_not_found' }
  | { status: 'pairing_expired' }
  | { status: 'pairing_rejected' }
  | { status: 'already_requested' }
  | { status: 'already_approved' }
  | { status: 'already_claimed' }
  | { status: 'credential_issue_failed' }
  | { status: 'invalid_nonce' }
  | { status: 'server_mismatch' }
  | { status: 'incompatible_protocol' }
  | { status: 'invalid_device_name' }
  | { status: 'rate_limited' };

export type PairingApprovalResult =
  | { status: 'approved' }
  | { status: 'pairing_not_found' }
  | { status: 'pairing_expired' }
  | { status: 'pairing_rejected' }
  | { status: 'already_approved' }
  | { status: 'already_claimed' }
  | { status: 'credential_issue_failed' }
  | { status: 'approval_required' }
  | { status: 'claim_in_progress' };

export type PairingRejectionResult =
  | { status: 'rejected' }
  | { status: 'pairing_not_found' }
  | { status: 'pairing_expired' }
  | { status: 'already_rejected' }
  | { status: 'already_claimed' }
  | { status: 'credential_issue_failed' }
  | { status: 'approval_required' }
  | { status: 'claim_in_progress' };

export type PairingClaimResult<Credential> =
  | { status: 'claimed'; credential: Credential; isRetry: boolean }
  | { status: 'pairing_not_found' }
  | { status: 'invalid_claimant' }
  | { status: 'pairing_expired' }
  | { status: 'pairing_rejected' }
  | { status: 'approval_required' }
  | { status: 'already_claimed' }
  | { status: 'credential_issue_failed' }
  | { status: 'claim_in_progress' };

export type PairingPollResult =
  | { status: 'available'; snapshot: PairingSessionSnapshot }
  | { status: 'pairing_not_found' }
  | { status: 'invalid_claimant' };

export interface PairingCredentialIssuerInput {
  pairingId: string;
  deviceName: string;
  serverId: string;
  protocolVersion: number;
  replacementDeviceId?: string;
}

export type PairingCredentialIssuer<Credential> = (
  input: PairingCredentialIssuerInput,
) => Credential;

export type PairingSessionPublicStatus =
  | 'awaiting_request'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'issuing_credential'
  | 'claimed'
  | 'credential_issue_failed'
  | 'expired';

export interface PairingSessionSnapshot {
  pairingId: string;
  status: PairingSessionPublicStatus;
  serverId: string;
  baseURL: string;
  protocolVersion: number;
  createdAt: string;
  qrExpiresAt: string;
  deviceName?: string;
  requestedAt?: string;
  approvalExpiresAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  claimedAt?: string;
}

export interface MobilePairingSessionManagerOptions<Credential> {
  serverId: string;
  baseURL: string;
  protocolVersion: number;
  credentialIssuer: PairingCredentialIssuer<Credential>;
  clock?: () => Date;
  idFactory?: () => string;
  nonceFactory?: () => string;
  claimantSecretFactory?: () => string;
  pairingExpiryMs?: number;
  approvalTimeoutMs?: number;
}

type InternalPairingStatus =
  | 'awaiting_request'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'issuing_credential'
  | 'claimed'
  | 'credential_issue_failed'
  | 'expired';

interface InternalPairingSession<Credential> {
  pairingId: string;
  nonceDigest: string | null;
  claimantSecretDigest: string | null;
  status: InternalPairingStatus;
  createdAtMs: number;
  qrExpiresAtMs: number;
  invalidAttemptTimestamps: number[];
  replacementDeviceId?: string;
  deviceName?: string;
  requestedAtMs?: number;
  approvalExpiresAtMs?: number;
  approvedAtMs?: number;
  rejectedAtMs?: number;
  claimedAtMs?: number;
  credential?: Credential;
}

function defaultNonceFactory(): string {
  return randomBytes(32).toString('base64url');
}

function digestNonce(nonce: string): string {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

function safeDigestMatch(storedDigest: string | null, candidateDigest: string): boolean {
  if (
    storedDigest === null ||
    !NONCE_DIGEST_PATTERN.test(storedDigest) ||
    !NONCE_DIGEST_PATTERN.test(candidateDigest)
  ) {
    return false;
  }

  const stored = Buffer.from(storedDigest, 'hex');
  const candidate = Buffer.from(candidateDigest, 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

function normalizeDeviceName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > MAX_DEVICE_NAME_LENGTH) return null;
  return normalized;
}

function validatePositiveDuration(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive duration`);
  }
  return value;
}

function validateBaseURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Pairing base URL must be an absolute URL');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.includes('..')
  ) {
    throw new Error(
      'Pairing base URL must be HTTPS without credentials, traversal, query, or fragment data',
    );
  }

  return url.toString().replace(/\/$/, '');
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export class MobilePairingSessionManager<Credential> {
  readonly serverId: string;
  readonly baseURL: string;
  readonly protocolVersion: number;

  private readonly credentialIssuer: PairingCredentialIssuer<Credential>;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly nonceFactory: () => string;
  private readonly claimantSecretFactory: () => string;
  private readonly pairingExpiryMs: number;
  private readonly approvalTimeoutMs: number;
  private readonly sessions = new Map<string, InternalPairingSession<Credential>>();

  constructor(options: MobilePairingSessionManagerOptions<Credential>) {
    const serverId = options.serverId.trim().toLowerCase();
    if (!UUID_PATTERN.test(serverId)) {
      throw new Error('Server ID must be a stable UUID');
    }
    if (!Number.isInteger(options.protocolVersion) || options.protocolVersion < 1) {
      throw new Error('Protocol version must be a positive integer');
    }

    this.serverId = serverId;
    this.baseURL = validateBaseURL(options.baseURL);
    this.protocolVersion = options.protocolVersion;
    this.credentialIssuer = options.credentialIssuer;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.nonceFactory = options.nonceFactory ?? defaultNonceFactory;
    this.claimantSecretFactory = options.claimantSecretFactory ?? defaultNonceFactory;
    this.pairingExpiryMs = validatePositiveDuration(
      options.pairingExpiryMs ?? DEFAULT_PAIRING_EXPIRY_MS,
      'Pairing expiry',
    );
    this.approvalTimeoutMs = validatePositiveDuration(
      options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
      'Approval timeout',
    );
  }

  create(input: PairingSessionCreationInput = {}): CreatedPairingSession {
    const replacementDeviceId = input.replacementDeviceId;
    if (
      replacementDeviceId !== undefined &&
      (typeof replacementDeviceId !== 'string' || !OPAQUE_ID_PATTERN.test(replacementDeviceId))
    ) {
      throw new Error('Replacement device ID must be a valid opaque identifier');
    }

    const pairingId = this.idFactory();
    if (!pairingId || this.sessions.has(pairingId)) {
      throw new Error('Pairing ID factory must return a unique non-empty identifier');
    }

    const nonce = this.nonceFactory();
    if (!NONCE_PATTERN.test(nonce)) {
      throw new Error('Nonce factory must return a 256-bit base64url nonce');
    }

    const createdAtMs = this.nowMs();
    const qrExpiresAtMs = createdAtMs + this.pairingExpiryMs;
    this.sessions.set(pairingId, {
      pairingId,
      nonceDigest: digestNonce(nonce),
      claimantSecretDigest: null,
      status: 'awaiting_request',
      createdAtMs,
      qrExpiresAtMs,
      invalidAttemptTimestamps: [],
      ...(replacementDeviceId ? { replacementDeviceId } : {}),
    });

    return {
      status: 'created',
      qrPayload: {
        kind: 'money-monitor-pairing',
        version: PAIRING_QR_PAYLOAD_VERSION,
        pairingId,
        nonce,
        serverId: this.serverId,
        baseURL: this.baseURL,
        protocolVersion: this.protocolVersion,
        expiresAt: iso(qrExpiresAtMs),
      },
    };
  }

  request(input: PairingRequestInput): PairingRequestResult {
    const session = this.sessions.get(input.pairingId);
    if (!session) return { status: 'pairing_not_found' };

    const now = this.nowMs();
    this.expireIfNeeded(session, now);
    const terminalResult = this.requestStateResult(session.status);
    if (terminalResult) return terminalResult;

    this.pruneInvalidAttempts(session, now);
    if (session.invalidAttemptTimestamps.length >= PAIRING_INVALID_ATTEMPT_LIMIT) {
      return { status: 'rate_limited' };
    }

    if (input.serverId.trim().toLowerCase() !== this.serverId) {
      this.recordInvalidAttempt(session, now);
      return { status: 'server_mismatch' };
    }
    if (input.protocolVersion !== this.protocolVersion) {
      this.recordInvalidAttempt(session, now);
      return { status: 'incompatible_protocol' };
    }

    const deviceName = normalizeDeviceName(input.deviceName);
    if (!deviceName) {
      this.recordInvalidAttempt(session, now);
      return { status: 'invalid_device_name' };
    }

    const candidateNonce = typeof input.nonce === 'string' ? input.nonce : '';
    const candidateDigest = digestNonce(candidateNonce);
    if (
      !NONCE_PATTERN.test(candidateNonce) ||
      !safeDigestMatch(session.nonceDigest, candidateDigest)
    ) {
      this.recordInvalidAttempt(session, now);
      return { status: 'invalid_nonce' };
    }

    const claimantSecret = this.claimantSecretFactory();
    if (!NONCE_PATTERN.test(claimantSecret)) {
      throw new Error('Claimant secret factory must return a 256-bit base64url secret');
    }

    const approvalExpiresAtMs = Math.min(now + this.approvalTimeoutMs, session.qrExpiresAtMs);
    session.status = 'pending_approval';
    session.nonceDigest = null;
    session.claimantSecretDigest = digestNonce(claimantSecret);
    session.invalidAttemptTimestamps = [];
    session.deviceName = deviceName;
    session.requestedAtMs = now;
    session.approvalExpiresAtMs = approvalExpiresAtMs;

    return {
      status: 'pending_approval',
      claimantSecret,
      request: {
        pairingId: session.pairingId,
        deviceName,
        requestedAt: iso(now),
        expiresAt: iso(approvalExpiresAtMs),
      },
    };
  }

  approve(pairingId: string): PairingApprovalResult {
    const session = this.sessions.get(pairingId);
    if (!session) return { status: 'pairing_not_found' };

    const now = this.nowMs();
    this.expireIfNeeded(session, now);

    switch (session.status) {
      case 'pending_approval':
        session.status = 'approved';
        session.approvedAtMs = now;
        return { status: 'approved' };
      case 'awaiting_request':
        return { status: 'approval_required' };
      case 'approved':
        return { status: 'already_approved' };
      case 'rejected':
        return { status: 'pairing_rejected' };
      case 'issuing_credential':
        return { status: 'claim_in_progress' };
      case 'claimed':
        return { status: 'already_claimed' };
      case 'credential_issue_failed':
        return { status: 'credential_issue_failed' };
      case 'expired':
        return { status: 'pairing_expired' };
    }
  }

  reject(pairingId: string): PairingRejectionResult {
    const session = this.sessions.get(pairingId);
    if (!session) return { status: 'pairing_not_found' };

    const now = this.nowMs();
    this.expireIfNeeded(session, now);

    switch (session.status) {
      case 'pending_approval':
      case 'approved':
        session.status = 'rejected';
        session.rejectedAtMs = now;
        return { status: 'rejected' };
      case 'awaiting_request':
        return { status: 'approval_required' };
      case 'rejected':
        return { status: 'already_rejected' };
      case 'issuing_credential':
        return { status: 'claim_in_progress' };
      case 'claimed':
        return { status: 'already_claimed' };
      case 'credential_issue_failed':
        return { status: 'credential_issue_failed' };
      case 'expired':
        return { status: 'pairing_expired' };
    }
  }

  poll(pairingId: string, claimantSecret: string): PairingPollResult {
    const session = this.sessions.get(pairingId);
    if (!session) return { status: 'pairing_not_found' };
    if (!this.isValidClaimant(session, claimantSecret)) {
      return { status: 'invalid_claimant' };
    }

    this.expireIfNeeded(session, this.nowMs());
    return { status: 'available', snapshot: this.snapshot(session) };
  }

  claim(pairingId: string, claimantSecret: string): PairingClaimResult<Credential> {
    const session = this.sessions.get(pairingId);
    if (!session) return { status: 'pairing_not_found' };
    if (!this.isValidClaimant(session, claimantSecret)) {
      return { status: 'invalid_claimant' };
    }

    const now = this.nowMs();
    this.expireIfNeeded(session, now);

    switch (session.status) {
      case 'awaiting_request':
      case 'pending_approval':
        return { status: 'approval_required' };
      case 'rejected':
        return { status: 'pairing_rejected' };
      case 'expired':
        return { status: 'pairing_expired' };
      case 'issuing_credential':
        return { status: 'claim_in_progress' };
      case 'claimed': {
        const credential = session.credential;
        return credential === undefined
          ? { status: 'credential_issue_failed' }
          : { status: 'claimed', credential, isRetry: true };
      }
      case 'credential_issue_failed':
        return { status: 'credential_issue_failed' };
      case 'approved':
        break;
    }

    session.status = 'issuing_credential';
    try {
      const credential = this.credentialIssuer({
        pairingId: session.pairingId,
        deviceName: session.deviceName as string,
        serverId: this.serverId,
        protocolVersion: this.protocolVersion,
        ...(session.replacementDeviceId
          ? { replacementDeviceId: session.replacementDeviceId }
          : {}),
      });
      session.status = 'claimed';
      session.claimedAtMs = now;
      session.credential = credential;
      return { status: 'claimed', credential, isRetry: false };
    } catch {
      session.status = 'credential_issue_failed';
      return { status: 'credential_issue_failed' };
    }
  }

  inspect(pairingId: string): PairingSessionSnapshot | null {
    const session = this.sessions.get(pairingId);
    if (!session) return null;
    this.expireIfNeeded(session, this.nowMs());
    return this.snapshot(session);
  }

  inspectAll(): PairingSessionSnapshot[] {
    const now = this.nowMs();
    return [...this.sessions.values()].map((session) => {
      this.expireIfNeeded(session, now);
      return this.snapshot(session);
    });
  }

  private nowMs(): number {
    const timestamp = this.clock().getTime();
    if (!Number.isFinite(timestamp)) throw new Error('Pairing clock returned an invalid date');
    return timestamp;
  }

  private expireIfNeeded(session: InternalPairingSession<Credential>, now: number): void {
    if (session.status === 'expired' || session.status === 'issuing_credential') {
      return;
    }

    const expiresAt =
      session.status === 'awaiting_request'
        ? session.qrExpiresAtMs
        : (session.approvalExpiresAtMs ?? session.qrExpiresAtMs);
    if (now >= expiresAt) {
      session.status = 'expired';
      session.nonceDigest = null;
      session.credential = undefined;
      session.invalidAttemptTimestamps = [];
    }
  }

  private requestStateResult(status: InternalPairingStatus): PairingRequestResult | null {
    switch (status) {
      case 'awaiting_request':
        return null;
      case 'pending_approval':
        return { status: 'already_requested' };
      case 'approved':
        return { status: 'already_approved' };
      case 'rejected':
        return { status: 'pairing_rejected' };
      case 'issuing_credential':
      case 'claimed':
        return { status: 'already_claimed' };
      case 'credential_issue_failed':
        return { status: 'credential_issue_failed' };
      case 'expired':
        return { status: 'pairing_expired' };
    }
  }

  private isValidClaimant(
    session: InternalPairingSession<Credential>,
    claimantSecret: string,
  ): boolean {
    const candidate = typeof claimantSecret === 'string' ? claimantSecret : '';
    return (
      NONCE_PATTERN.test(candidate) &&
      safeDigestMatch(session.claimantSecretDigest, digestNonce(candidate))
    );
  }

  private pruneInvalidAttempts(session: InternalPairingSession<Credential>, now: number): void {
    const cutoff = now - PAIRING_INVALID_ATTEMPT_WINDOW_MS;
    session.invalidAttemptTimestamps = session.invalidAttemptTimestamps.filter(
      (timestamp) => timestamp > cutoff,
    );
  }

  private recordInvalidAttempt(session: InternalPairingSession<Credential>, now: number): void {
    session.invalidAttemptTimestamps.push(now);
  }

  private snapshot(session: InternalPairingSession<Credential>): PairingSessionSnapshot {
    return {
      pairingId: session.pairingId,
      status: session.status,
      serverId: this.serverId,
      baseURL: this.baseURL,
      protocolVersion: this.protocolVersion,
      createdAt: iso(session.createdAtMs),
      qrExpiresAt: iso(session.qrExpiresAtMs),
      ...(session.deviceName ? { deviceName: session.deviceName } : {}),
      ...(session.requestedAtMs !== undefined ? { requestedAt: iso(session.requestedAtMs) } : {}),
      ...(session.approvalExpiresAtMs !== undefined
        ? { approvalExpiresAt: iso(session.approvalExpiresAtMs) }
        : {}),
      ...(session.approvedAtMs !== undefined ? { approvedAt: iso(session.approvedAtMs) } : {}),
      ...(session.rejectedAtMs !== undefined ? { rejectedAt: iso(session.rejectedAtMs) } : {}),
      ...(session.claimedAtMs !== undefined ? { claimedAt: iso(session.claimedAtMs) } : {}),
    };
  }
}
