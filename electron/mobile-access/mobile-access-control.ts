import type {
  MobileAccessRuntimeState,
  MobileAccessRuntimeStatus,
} from './mobile-access-runtime.js';

const PAIRING_STATUSES = new Set([
  'awaiting_request',
  'pending_approval',
  'approved',
  'rejected',
  'issuing_credential',
  'claimed',
  'credential_issue_failed',
  'expired',
]);

const PAIRING_ACTION_STATUSES = new Set([
  'approved',
  'rejected',
  'pairing_not_found',
  'pairing_expired',
  'pairing_rejected',
  'already_approved',
  'already_rejected',
  'already_claimed',
  'credential_issue_failed',
  'approval_required',
  'claim_in_progress',
]);

export type MobileAccessControlError =
  | 'invalid_request'
  | 'settings_write_failed'
  | 'pairing_unavailable'
  | 'pairing_operation_failed'
  | 'device_operation_failed';

export interface MobileAccessRuntimeControl {
  start(enabled: boolean): Promise<MobileAccessRuntimeState>;
  resume(): Promise<MobileAccessRuntimeState>;
  shutdown(): Promise<MobileAccessRuntimeState>;
  disable(): Promise<MobileAccessRuntimeState>;
}

export interface MobileAccessPairingQrPayload {
  kind: 'money-monitor-pairing';
  version: 1;
  pairingId: string;
  nonce: string;
  serverId: string;
  baseURL: string;
  protocolVersion: number;
  expiresAt: string;
}

export interface MobileAccessPairingSession {
  pairingId: string;
  status: string;
  deviceName?: string;
  createdAt: string;
  qrExpiresAt: string;
  approvalExpiresAt?: string;
}

export interface MobileAccessPairingCreationInput {
  replacementDeviceId?: string;
}

export interface MobileAccessPairingManager {
  create(input?: MobileAccessPairingCreationInput): {
    status: 'created';
    qrPayload: MobileAccessPairingQrPayload;
  };
  inspectAll(): MobileAccessPairingSession[];
  approve(pairingId: string): { status: string };
  reject(pairingId: string): { status: string };
}

export interface MobileAccessPublicDevice {
  id: string;
  name: string;
  capabilities: string[];
  protocolVersion: number;
  tokenVersion: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface MobileAccessRegistryDevice extends MobileAccessPublicDevice {
  expiresAt: string | null;
}

export interface MobileAccessDeviceRegistry {
  list(): MobileAccessRegistryDevice[];
  revoke(deviceId: string): boolean;
  setReviewAccess(deviceId: string, enabled: boolean): MobileAccessRegistryDevice | null;
}

export interface MobileAccessControlSnapshot {
  enabled: boolean;
  transport: {
    status: MobileAccessRuntimeStatus;
    diagnostic: string;
    publicUrl?: string;
  };
  pairingAvailable: boolean;
  pendingRequests: Array<{
    pairingId: string;
    status: string;
    deviceName?: string;
    createdAt: string;
    expiresAt: string;
  }>;
  devices: MobileAccessPublicDevice[];
  lastActionError?: MobileAccessControlError;
}

export type MobileAccessPairingCreationResult =
  | { status: 'created'; encodedPayload: string; expiresAt: string }
  | { status: 'unavailable'; reason: MobileAccessControlError };

export type MobileAccessPairingActionResult =
  | { status: string }
  | { status: 'operation_failed'; reason: MobileAccessControlError };

export interface MobileAccessControlOptions {
  runtime: MobileAccessRuntimeControl;
  persistEnabled(enabled: boolean): void | Promise<void>;
  createPairingManager(publicUrl: string): MobileAccessPairingManager;
  deviceRegistry: MobileAccessDeviceRegistry;
  onPairingManagerChanged?(manager: MobileAccessPairingManager | null): void;
}

const INITIAL_RUNTIME_STATE: MobileAccessRuntimeState = {
  status: 'stopped',
  diagnostic: 'runtimeNotStarted',
};

/**
 * Renderer-safe control surface for Mobile Access. It owns no Electron APIs and
 * returns only allow-listed status metadata. Pairing nonces leave this class
 * solely inside the one-time QR payload returned by createPairing().
 */
export class MobileAccessControl {
  private readonly runtime: MobileAccessRuntimeControl;
  private readonly persistEnabled: MobileAccessControlOptions['persistEnabled'];
  private readonly createPairingManager: MobileAccessControlOptions['createPairingManager'];
  private readonly deviceRegistry: MobileAccessDeviceRegistry;
  private readonly onPairingManagerChanged?: MobileAccessControlOptions['onPairingManagerChanged'];
  private enabled = false;
  private runtimeState: MobileAccessRuntimeState = INITIAL_RUNTIME_STATE;
  private pairingManager: MobileAccessPairingManager | null = null;
  private pairingPublicUrl: string | null = null;
  private lastActionError: MobileAccessControlError | undefined;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(options: MobileAccessControlOptions) {
    this.runtime = options.runtime;
    this.persistEnabled = options.persistEnabled;
    this.createPairingManager = options.createPairingManager;
    this.deviceRegistry = options.deviceRegistry;
    this.onPairingManagerChanged = options.onPairingManagerChanged;
  }

  startFromConfiguration(enabled: boolean): Promise<MobileAccessControlSnapshot> {
    return this.serialize(async () => {
      this.enabled = enabled;
      this.runtimeState = await this.runtime.start(enabled);
      this.reconcilePairingManager();
      return this.snapshot();
    });
  }

  setEnabled(enabled: boolean): Promise<MobileAccessControlSnapshot> {
    return this.serialize(async () => {
      this.lastActionError = undefined;
      try {
        // Persist first: disabling must remain disabled after a crash, while an
        // unavailable Tailnet should be retried automatically after restart.
        await this.persistEnabled(enabled);
      } catch {
        this.lastActionError = 'settings_write_failed';
        return this.snapshot();
      }

      this.enabled = enabled;
      this.runtimeState = enabled ? await this.runtime.start(true) : await this.runtime.disable();
      this.reconcilePairingManager();
      return this.snapshot();
    });
  }

  resume(): Promise<MobileAccessControlSnapshot> {
    return this.serialize(async () => {
      this.runtimeState = await this.runtime.resume();
      this.reconcilePairingManager();
      return this.snapshot();
    });
  }

  shutdown(): Promise<MobileAccessControlSnapshot> {
    return this.serialize(async () => {
      this.runtimeState = await this.runtime.shutdown();
      this.setPairingManager(null, null);
      return this.snapshot();
    });
  }

  getSnapshot(): MobileAccessControlSnapshot {
    return this.snapshot();
  }

  createPairing(replacementDeviceId?: string): MobileAccessPairingCreationResult {
    if (!this.enabled || !this.pairingManager) {
      return { status: 'unavailable', reason: 'pairing_unavailable' };
    }

    let creationInput: MobileAccessPairingCreationInput | undefined;
    if (replacementDeviceId !== undefined) {
      if (!isSafeIdentifier(replacementDeviceId)) {
        return { status: 'unavailable', reason: 'invalid_request' };
      }

      try {
        const candidate = this.deviceRegistry
          .list()
          .find((device) => device.id === replacementDeviceId);
        const safeDevice = candidate ? sanitizeDevice(candidate) : null;
        if (
          !candidate ||
          !safeDevice ||
          safeDevice.revokedAt !== null ||
          !isOptionalIsoDate(candidate.expiresAt) ||
          (candidate.expiresAt !== null && Date.parse(candidate.expiresAt) <= Date.now())
        ) {
          return { status: 'unavailable', reason: 'device_operation_failed' };
        }
      } catch {
        return { status: 'unavailable', reason: 'device_operation_failed' };
      }

      creationInput = { replacementDeviceId };
    }

    try {
      const created = this.pairingManager.create(creationInput);
      const payload = sanitizePairingPayload(created.qrPayload, this.pairingPublicUrl);
      if (!payload) {
        return { status: 'unavailable', reason: 'pairing_operation_failed' };
      }
      return {
        status: 'created',
        encodedPayload: JSON.stringify(payload),
        expiresAt: payload.expiresAt,
      };
    } catch {
      return { status: 'unavailable', reason: 'pairing_operation_failed' };
    }
  }

  approve(pairingId: string): MobileAccessPairingActionResult {
    return this.performPairingAction(pairingId, 'approve');
  }

  reject(pairingId: string): MobileAccessPairingActionResult {
    return this.performPairingAction(pairingId, 'reject');
  }

  revoke(deviceId: string): MobileAccessControlSnapshot {
    this.lastActionError = undefined;
    if (!isSafeIdentifier(deviceId)) {
      this.lastActionError = 'device_operation_failed';
      return this.snapshot();
    }

    try {
      if (!this.deviceRegistry.revoke(deviceId)) {
        this.lastActionError = 'device_operation_failed';
      }
    } catch {
      this.lastActionError = 'device_operation_failed';
    }
    return this.snapshot();
  }

  setReviewAccess(deviceId: string, enabled: boolean): MobileAccessControlSnapshot {
    this.lastActionError = undefined;
    if (!isSafeIdentifier(deviceId) || typeof enabled !== 'boolean') {
      this.lastActionError = 'device_operation_failed';
      return this.snapshot();
    }

    try {
      if (!this.deviceRegistry.setReviewAccess(deviceId, enabled)) {
        this.lastActionError = 'device_operation_failed';
      }
    } catch {
      this.lastActionError = 'device_operation_failed';
    }
    return this.snapshot();
  }

  private performPairingAction(
    pairingId: string,
    action: 'approve' | 'reject',
  ): MobileAccessPairingActionResult {
    if (!this.pairingManager || !isSafeIdentifier(pairingId)) {
      return { status: 'operation_failed', reason: 'pairing_unavailable' };
    }

    try {
      const result = this.pairingManager[action](pairingId);
      if (!PAIRING_ACTION_STATUSES.has(result.status)) {
        return { status: 'operation_failed', reason: 'pairing_operation_failed' };
      }
      return { status: result.status };
    } catch {
      return { status: 'operation_failed', reason: 'pairing_operation_failed' };
    }
  }

  private reconcilePairingManager(): void {
    const publicUrl = sanitizedPublicUrl(this.runtimeState);
    if (!this.enabled || this.runtimeState.status !== 'running' || !publicUrl) {
      this.setPairingManager(null, null);
      return;
    }

    if (this.pairingManager && this.pairingPublicUrl === publicUrl) return;

    try {
      this.setPairingManager(this.createPairingManager(publicUrl), publicUrl);
    } catch {
      this.setPairingManager(null, null);
      this.lastActionError = 'pairing_operation_failed';
    }
  }

  private setPairingManager(
    manager: MobileAccessPairingManager | null,
    publicUrl: string | null,
  ): void {
    if (this.pairingManager === manager && this.pairingPublicUrl === publicUrl) return;
    this.pairingManager = manager;
    this.pairingPublicUrl = publicUrl;
    try {
      this.onPairingManagerChanged?.(manager);
    } catch {
      // Integration observers are optional and cannot weaken the control plane.
    }
  }

  private snapshot(): MobileAccessControlSnapshot {
    const pendingRequests = this.safePairingSessions();
    const devices = this.safeDevices();
    const publicUrl = sanitizedPublicUrl(this.runtimeState);

    return {
      enabled: this.enabled,
      transport: {
        status: this.runtimeState.status,
        diagnostic: this.runtimeState.diagnostic,
        ...(publicUrl ? { publicUrl } : {}),
      },
      pairingAvailable: this.pairingManager !== null,
      pendingRequests,
      devices,
      ...(this.lastActionError ? { lastActionError: this.lastActionError } : {}),
    };
  }

  private safePairingSessions(): MobileAccessControlSnapshot['pendingRequests'] {
    if (!this.pairingManager) return [];
    try {
      return this.pairingManager
        .inspectAll()
        .map(sanitizePairingSession)
        .filter((session): session is NonNullable<typeof session> => session !== null)
        .filter((session) =>
          ['awaiting_request', 'pending_approval', 'approved'].includes(session.status),
        );
    } catch {
      return [];
    }
  }

  private safeDevices(): MobileAccessPublicDevice[] {
    try {
      return this.deviceRegistry
        .list()
        .map(sanitizeDevice)
        .filter((device): device is MobileAccessPublicDevice => device !== null);
    } catch {
      return [];
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function sanitizedPublicUrl(state: MobileAccessRuntimeState): string | null {
  if (!state.publicUrl) return null;
  try {
    const url = new URL(state.publicUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function sanitizePairingPayload(
  value: MobileAccessPairingQrPayload,
  expectedPublicUrl: string | null,
): MobileAccessPairingQrPayload | null {
  if (
    value.kind !== 'money-monitor-pairing' ||
    value.version !== 1 ||
    !isSafeIdentifier(value.pairingId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) ||
    !isSafeIdentifier(value.serverId) ||
    !Number.isInteger(value.protocolVersion) ||
    value.protocolVersion < 1 ||
    !isIsoDate(value.expiresAt)
  ) {
    return null;
  }

  const baseURL = sanitizedPublicUrl({
    status: 'running',
    diagnostic: 'routeVerified',
    publicUrl: value.baseURL,
  });
  if (!baseURL || baseURL !== expectedPublicUrl) return null;
  // Project each field explicitly so an integration cannot accidentally add
  // trusted-Mac-only metadata (such as a replacement device ID) to the QR.
  return {
    kind: value.kind,
    version: value.version,
    pairingId: value.pairingId,
    nonce: value.nonce,
    serverId: value.serverId,
    baseURL,
    protocolVersion: value.protocolVersion,
    expiresAt: value.expiresAt,
  };
}

function sanitizePairingSession(
  value: MobileAccessPairingSession,
): MobileAccessControlSnapshot['pendingRequests'][number] | null {
  if (
    !isSafeIdentifier(value.pairingId) ||
    !PAIRING_STATUSES.has(value.status) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.qrExpiresAt)
  ) {
    return null;
  }

  const expiresAt = value.approvalExpiresAt ?? value.qrExpiresAt;
  if (!isIsoDate(expiresAt)) return null;
  const deviceName = sanitizeDeviceName(value.deviceName);
  if (value.deviceName !== undefined && !deviceName) return null;

  return {
    pairingId: value.pairingId,
    status: value.status,
    ...(deviceName ? { deviceName } : {}),
    createdAt: value.createdAt,
    expiresAt,
  };
}

function sanitizeDevice(value: MobileAccessPublicDevice): MobileAccessPublicDevice | null {
  const name = sanitizeDeviceName(value.name);
  if (
    !isSafeIdentifier(value.id) ||
    !name ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.includes('mobile.read') ||
    !value.capabilities.every(
      (capability) => capability === 'mobile.read' || capability === 'mobile.review.write',
    ) ||
    !Number.isInteger(value.protocolVersion) ||
    value.protocolVersion < 1 ||
    !Number.isInteger(value.tokenVersion) ||
    value.tokenVersion < 1 ||
    !isIsoDate(value.createdAt) ||
    !isOptionalIsoDate(value.lastUsedAt) ||
    !isOptionalIsoDate(value.revokedAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    name,
    capabilities: [...new Set(value.capabilities)],
    protocolVersion: value.protocolVersion,
    tokenVersion: value.tokenVersion,
    createdAt: value.createdAt,
    lastUsedAt: value.lastUsedAt,
    revokedAt: value.revokedAt,
  };
}

function sanitizeDeviceName(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized && normalized.length <= 80 ? normalized : null;
}

function isSafeIdentifier(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isOptionalIsoDate(value: string | null): boolean {
  return value === null || isIsoDate(value);
}
