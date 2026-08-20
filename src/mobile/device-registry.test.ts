import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import * as schema from '../db/schema.js';
import {
  MOBILE_CAPABILITIES,
  MOBILE_BUDGET_WRITE_CAPABILITY,
  MOBILE_READ_CAPABILITY,
  MOBILE_REVIEW_WRITE_CAPABILITY,
  MOBILE_SYNC_START_CAPABILITY,
  MobileDeviceRegistry,
  digestMobileToken,
} from './device-registry.js';

const NOW = new Date('2026-07-15T10:00:00.000Z');
const TOKEN_ONE = 'A'.repeat(43);
const TOKEN_TWO = 'B'.repeat(43);

describe('MobileDeviceRegistry', () => {
  let testDb: TestDb;
  let tokens: string[];
  let registry: MobileDeviceRegistry;

  beforeEach(() => {
    testDb = createTestDb();
    tokens = [TOKEN_ONE, TOKEN_TWO];
    let nextId = 1;
    registry = new MobileDeviceRegistry(testDb.db, {
      clock: () => NOW,
      tokenFactory: () => tokens.shift() ?? 'C'.repeat(43),
      idFactory: () => `device-${nextId++}`,
    });
  });

  afterEach(() => testDb.close());

  it('issues one credential while persisting only its digest', () => {
    const credential = registry.issue({ name: '  Personal   iPhone  ' });
    const stored = testDb.db.select().from(schema.mobileDevices).get();

    expect(credential).toMatchObject({
      token: TOKEN_ONE,
      device: {
        id: 'device-1',
        name: 'Personal iPhone',
        capabilities: [MOBILE_READ_CAPABILITY],
        tokenVersion: 1,
      },
    });
    expect(stored?.tokenDigest).toBe(digestMobileToken(TOKEN_ONE));
    expect(stored?.tokenDigest).not.toContain(TOKEN_ONE);
    expect(Object.keys(stored ?? {})).not.toContain('token');
    expect(Object.keys(credential.device)).not.toContain('tokenDigest');
  });

  it('authenticates an active device and updates last-used metadata', () => {
    registry.issue({ name: 'iPhone' });

    const result = registry.authenticate(TOKEN_ONE);

    expect(result).toMatchObject({
      status: 'authenticated',
      device: { id: 'device-1', lastUsedAt: NOW.toISOString() },
    });
    expect(testDb.db.select().from(schema.mobileDevices).get()?.lastUsedAt).toBe(NOW.toISOString());
  });

  it('issues only the explicit Phase 4 capability allowlist', () => {
    const credential = registry.issue({
      name: 'Command-capable iPhone',
      capabilities: [MOBILE_SYNC_START_CAPABILITY, MOBILE_REVIEW_WRITE_CAPABILITY],
    });

    expect(credential.device.capabilities).toEqual([
      MOBILE_REVIEW_WRITE_CAPABILITY,
      MOBILE_SYNC_START_CAPABILITY,
    ]);
    expect(registry.authenticate(TOKEN_ONE, MOBILE_REVIEW_WRITE_CAPABILITY).status).toBe(
      'authenticated',
    );
    expect(registry.authenticate(TOKEN_ONE, MOBILE_SYNC_START_CAPABILITY).status).toBe(
      'authenticated',
    );
    expect(registry.authenticate(TOKEN_ONE, MOBILE_READ_CAPABILITY)).toEqual({
      status: 'capability_required',
      deviceId: 'device-1',
    });
    expect(registry.authenticate(TOKEN_ONE, MOBILE_BUDGET_WRITE_CAPABILITY)).toEqual({
      status: 'capability_required',
      deviceId: 'device-1',
    });
  });

  it('allows every declared mobile capability to be issued and authorized', () => {
    const credential = registry.issue({
      name: 'Fully capable iPhone',
      capabilities: MOBILE_CAPABILITIES,
    });

    expect(credential.device.capabilities).toEqual([...MOBILE_CAPABILITIES].sort());
    for (const capability of MOBILE_CAPABILITIES) {
      expect(registry.authenticate(TOKEN_ONE, capability).status).toBe('authenticated');
    }
  });

  it('rejects unclassified capabilities at issuance and authentication', () => {
    expect(() =>
      registry.issue({
        name: 'Unexpected capability',
        capabilities: ['mobile.write' as never],
      }),
    ).toThrow('Only explicitly supported mobile capabilities');

    registry.issue({ name: 'iPhone' });
    expect(registry.authenticate(TOKEN_ONE, 'mobile.unclassified')).toEqual({
      status: 'capability_required',
      deviceId: 'device-1',
    });
  });

  it('authenticates the persisted credential through a fresh registry instance', () => {
    registry.issue({ name: 'iPhone' });
    const restartedRegistry = new MobileDeviceRegistry(testDb.db, { clock: () => NOW });

    expect(restartedRegistry.authenticate(TOKEN_ONE)).toMatchObject({
      status: 'authenticated',
      device: { id: 'device-1', name: 'iPhone' },
    });
  });

  it('does not distinguish malformed and unknown credentials', () => {
    registry.issue({ name: 'iPhone' });

    expect(registry.authenticate('not-a-token')).toEqual({ status: 'invalid' });
    expect(registry.authenticate('Z'.repeat(43))).toEqual({ status: 'invalid' });
  });

  it('revokes immediately without deleting device history', () => {
    const { device } = registry.issue({ name: 'iPhone' });

    expect(registry.revoke(device.id)).toBe(true);
    expect(registry.authenticate(TOKEN_ONE)).toEqual({
      status: 'revoked',
      deviceId: device.id,
    });
    expect(registry.list()[0].revokedAt).toBe(NOW.toISOString());
  });

  it('changes review access only for an active paired device', () => {
    const issued = registry.issue({ name: 'iPhone' });

    expect(registry.setReviewAccess(issued.device.id, true)).toMatchObject({
      capabilities: [MOBILE_READ_CAPABILITY, MOBILE_REVIEW_WRITE_CAPABILITY],
    });
    expect(registry.authenticate(TOKEN_ONE, MOBILE_REVIEW_WRITE_CAPABILITY).status).toBe(
      'authenticated',
    );
    expect(registry.setReviewAccess(issued.device.id, false)).toMatchObject({
      capabilities: [MOBILE_READ_CAPABILITY],
    });
    expect(registry.authenticate(TOKEN_ONE, MOBILE_REVIEW_WRITE_CAPABILITY)).toEqual({
      status: 'capability_required',
      deviceId: issued.device.id,
    });

    registry.revoke(issued.device.id);
    expect(registry.setReviewAccess(issued.device.id, true)).toBeNull();
  });

  it('rotates a token and invalidates the previous credential', () => {
    const original = registry.issue({ name: 'iPhone' });

    const rotated = registry.rotate(original.device.id);

    expect(rotated?.token).toBe(TOKEN_TWO);
    expect(rotated?.device.tokenVersion).toBe(2);
    expect(rotated?.device.rotatedAt).toBe(NOW.toISOString());
    expect(registry.authenticate(TOKEN_ONE)).toEqual({ status: 'invalid' });
    expect(registry.authenticate(TOKEN_TWO).status).toBe('authenticated');
  });

  it('does not rotate a missing or revoked device', () => {
    const original = registry.issue({ name: 'iPhone' });
    expect(registry.revoke(original.device.id)).toBe(true);

    expect(registry.rotate(original.device.id)).toBeNull();
    expect(registry.rotate('missing-device')).toBeNull();
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: original.device.id,
        tokenVersion: 1,
        rotatedAt: null,
        revokedAt: NOW.toISOString(),
      }),
    ]);
  });

  it('does not rotate a device that has expired by claim time', () => {
    const original = registry.issue({ name: 'Expired iPhone', expiresAt: NOW });

    expect(registry.rotate(original.device.id)).toBeNull();
    expect(registry.authenticate(TOKEN_ONE)).toEqual({
      status: 'expired',
      deviceId: original.device.id,
    });
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: original.device.id,
        tokenVersion: 1,
        rotatedAt: null,
        expiresAt: NOW.toISOString(),
      }),
    ]);
  });

  it('rejects expired and missing-capability devices', () => {
    registry.issue({ name: 'Expired', expiresAt: new Date('2026-07-15T09:59:59.000Z') });
    expect(registry.authenticate(TOKEN_ONE)).toEqual({
      status: 'expired',
      deviceId: 'device-1',
    });

    const second = registry.issue({ name: 'No capability' });
    testDb.db
      .update(schema.mobileDevices)
      .set({ capabilities: '[]' })
      .where(eq(schema.mobileDevices.id, second.device.id))
      .run();
    expect(registry.authenticate(TOKEN_TWO)).toEqual({
      status: 'capability_required',
      deviceId: second.device.id,
    });
  });

  it('validates device names and token-factory strength', () => {
    expect(() => registry.issue({ name: '   ' })).toThrow('Device name');

    const weakRegistry = new MobileDeviceRegistry(testDb.db, {
      tokenFactory: () => 'too-short',
    });
    expect(() => weakRegistry.issue({ name: 'iPhone' })).toThrow('256-bit');
  });
});
