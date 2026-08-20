import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

/**
 * The complete mobile capability allowlist. Route registration remains
 * separate: defining a capability never exposes a route or mutation.
 */
export const MOBILE_CAPABILITIES = [
  'mobile.read',
  'mobile.review.write',
  'mobile.transaction.write',
  'mobile.budget.write',
  'mobile.category.write',
  'mobile.alert.write',
  'mobile.sync.start',
] as const;

export const MOBILE_READ_CAPABILITY = 'mobile.read' as const;
export const MOBILE_REVIEW_WRITE_CAPABILITY = 'mobile.review.write' as const;
export const MOBILE_TRANSACTION_WRITE_CAPABILITY = 'mobile.transaction.write' as const;
export const MOBILE_BUDGET_WRITE_CAPABILITY = 'mobile.budget.write' as const;
export const MOBILE_CATEGORY_WRITE_CAPABILITY = 'mobile.category.write' as const;
export const MOBILE_ALERT_WRITE_CAPABILITY = 'mobile.alert.write' as const;
export const MOBILE_SYNC_START_CAPABILITY = 'mobile.sync.start' as const;

export type MobileCapability = (typeof MOBILE_CAPABILITIES)[number];

export function isMobileCapability(value: string): value is MobileCapability {
  return (MOBILE_CAPABILITIES as readonly string[]).includes(value);
}

type Database = BetterSQLite3Database<typeof schema>;
type MobileDeviceRow = typeof schema.mobileDevices.$inferSelect;

export interface PublicMobileDevice {
  id: string;
  name: string;
  capabilities: string[];
  protocolVersion: number;
  tokenVersion: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
}

export type MobileAuthenticationResult =
  | { status: 'authenticated'; device: PublicMobileDevice }
  | { status: 'invalid' }
  | { status: 'revoked'; deviceId: string }
  | { status: 'expired'; deviceId: string }
  | { status: 'capability_required'; deviceId: string };

export interface IssueMobileDeviceInput {
  name: string;
  capabilities?: readonly MobileCapability[];
  protocolVersion?: number;
  expiresAt?: Date | null;
}

export interface MobileDeviceCredential {
  device: PublicMobileDevice;
  /** Returned exactly once to the caller and never stored by this registry. */
  token: string;
}

export interface MobileDeviceRegistryOptions {
  clock?: () => Date;
  tokenFactory?: () => string;
  idFactory?: () => string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_DEVICE_NAME_LENGTH = 80;

export function digestMobileToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function generateMobileToken(): string {
  return randomBytes(32).toString('base64url');
}

function normalizeDeviceName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > MAX_DEVICE_NAME_LENGTH) {
    throw new Error(`Device name must contain 1-${MAX_DEVICE_NAME_LENGTH} characters`);
  }
  return normalized;
}

function parseCapabilities(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return [];
    return [...new Set(parsed)].sort();
  } catch {
    return [];
  }
}

function publicDevice(row: MobileDeviceRow): PublicMobileDevice {
  return {
    id: row.id,
    name: row.name,
    capabilities: parseCapabilities(row.capabilities),
    protocolVersion: row.protocolVersion,
    tokenVersion: row.tokenVersion,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    rotatedAt: row.rotatedAt,
    revokedAt: row.revokedAt,
  };
}

function safeDigestMatch(storedDigest: string, candidateDigest: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(storedDigest) || !/^[a-f0-9]{64}$/.test(candidateDigest)) {
    return false;
  }

  const stored = Buffer.from(storedDigest, 'hex');
  const candidate = Buffer.from(candidateDigest, 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

export class MobileDeviceRegistry {
  private readonly clock: () => Date;
  private readonly tokenFactory: () => string;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: Database,
    options: MobileDeviceRegistryOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.tokenFactory = options.tokenFactory ?? generateMobileToken;
    this.idFactory = options.idFactory ?? randomUUID;
  }

  issue(input: IssueMobileDeviceInput): MobileDeviceCredential {
    const capabilities = input.capabilities ?? [MOBILE_READ_CAPABILITY];
    if (
      capabilities.length === 0 ||
      capabilities.some((capability) => !isMobileCapability(capability))
    ) {
      throw new Error('Only explicitly supported mobile capabilities may be issued');
    }

    const protocolVersion = input.protocolVersion ?? 1;
    if (!Number.isInteger(protocolVersion) || protocolVersion < 1) {
      throw new Error('Protocol version must be a positive integer');
    }

    // Validate the whole request before consuming randomness. This makes an
    // invalid issuance a true no-op for both production entropy and tests.
    const token = this.tokenFactory();
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error('Token factory must return a 256-bit base64url token');
    }

    const row = this.database
      .insert(schema.mobileDevices)
      .values({
        id: this.idFactory(),
        name: normalizeDeviceName(input.name),
        tokenDigest: digestMobileToken(token),
        capabilities: JSON.stringify([...new Set(capabilities)].sort()),
        protocolVersion,
        createdAt: this.clock().toISOString(),
        expiresAt: input.expiresAt?.toISOString() ?? null,
      })
      .returning()
      .get();

    return { device: publicDevice(row), token };
  }

  list(): PublicMobileDevice[] {
    return this.database
      .select()
      .from(schema.mobileDevices)
      .orderBy(desc(schema.mobileDevices.createdAt))
      .all()
      .map(publicDevice);
  }

  authenticate(
    token: string,
    requiredCapability: string = MOBILE_READ_CAPABILITY,
  ): MobileAuthenticationResult {
    if (!TOKEN_PATTERN.test(token)) return { status: 'invalid' };

    const candidateDigest = digestMobileToken(token);
    const row = this.database
      .select()
      .from(schema.mobileDevices)
      .where(eq(schema.mobileDevices.tokenDigest, candidateDigest))
      .get();

    if (!row || !safeDigestMatch(row.tokenDigest, candidateDigest)) return { status: 'invalid' };
    if (row.revokedAt) return { status: 'revoked', deviceId: row.id };
    if (row.expiresAt && Date.parse(row.expiresAt) <= this.clock().getTime()) {
      return { status: 'expired', deviceId: row.id };
    }

    // New mobile endpoints must opt into one of the explicitly classified
    // capabilities. An unclassified route cannot be authorized by a token
    // that happens to contain arbitrary persisted JSON.
    if (!isMobileCapability(requiredCapability)) {
      return { status: 'capability_required', deviceId: row.id };
    }

    const capabilities = parseCapabilities(row.capabilities);
    if (!capabilities.includes(requiredCapability)) {
      return { status: 'capability_required', deviceId: row.id };
    }

    const lastUsedAt = this.clock().toISOString();
    try {
      this.database
        .update(schema.mobileDevices)
        .set({ lastUsedAt })
        .where(eq(schema.mobileDevices.id, row.id))
        .run();
    } catch {
      // Authentication must not fail because the diagnostic last-used write did.
    }

    return {
      status: 'authenticated',
      device: publicDevice({ ...row, lastUsedAt }),
    };
  }

  revoke(deviceId: string): boolean {
    const result = this.database
      .update(schema.mobileDevices)
      .set({ revokedAt: this.clock().toISOString() })
      .where(eq(schema.mobileDevices.id, deviceId))
      .run();
    return result.changes === 1;
  }

  /**
   * Narrow, Mac-controlled permission change for the first mobile command
   * family. Pairing intentionally grants read access only; enabling review
   * actions never changes the device token or any other capability.
   */
  setReviewAccess(deviceId: string, enabled: boolean): PublicMobileDevice | null {
    const row = this.database
      .select()
      .from(schema.mobileDevices)
      .where(
        and(
          eq(schema.mobileDevices.id, deviceId),
          isNull(schema.mobileDevices.revokedAt),
        ),
      )
      .get();
    if (!row || (row.expiresAt && Date.parse(row.expiresAt) <= this.clock().getTime())) return null;

    const capabilities = new Set(parseCapabilities(row.capabilities));
    capabilities.add(MOBILE_READ_CAPABILITY);
    if (enabled) capabilities.add(MOBILE_REVIEW_WRITE_CAPABILITY);
    else capabilities.delete(MOBILE_REVIEW_WRITE_CAPABILITY);

    const updated = this.database
      .update(schema.mobileDevices)
      .set({ capabilities: JSON.stringify([...capabilities].sort()) })
      .where(eq(schema.mobileDevices.id, deviceId))
      .returning()
      .get();
    return updated ? publicDevice(updated) : null;
  }

  rotate(deviceId: string): MobileDeviceCredential | null {
    const token = this.tokenFactory();
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error('Token factory must return a 256-bit base64url token');
    }

    const rotatedAt = this.clock().toISOString();
    const row = this.database
      .update(schema.mobileDevices)
      .set({
        tokenDigest: digestMobileToken(token),
        tokenVersion: sql`${schema.mobileDevices.tokenVersion} + 1`,
        rotatedAt,
        lastUsedAt: null,
      })
      .where(
        and(
          eq(schema.mobileDevices.id, deviceId),
          isNull(schema.mobileDevices.revokedAt),
          or(isNull(schema.mobileDevices.expiresAt), gt(schema.mobileDevices.expiresAt, rotatedAt)),
        ),
      )
      .returning()
      .get();

    return row ? { device: publicDevice(row), token } : null;
  }
}
