import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import * as schema from '../db/schema.js';
import { MOBILE_READ_CAPABILITY, MobileDeviceRegistry } from './device-registry.js';

const NOW = new Date('2026-07-15T10:00:00.000Z');

describe('MobileDeviceRegistry', () => {
  let testDb: TestDb;
  let registry: MobileDeviceRegistry;

  beforeEach(() => {
    testDb = createTestDb();
    registry = new MobileDeviceRegistry(testDb.db, { clock: () => NOW });
  });

  afterEach(() => testDb.close());

  it('issues one credential while persisting only its digest', () => {
    const credential = registry.issue({ name: '  Personal   iPhone  ' });
    const stored = testDb.db.select().from(schema.mobileDevices).get();

    expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credential).toMatchObject({
      device: {
        name: 'Personal iPhone',
        capabilities: [MOBILE_READ_CAPABILITY],
        tokenVersion: 1,
      },
    });
    expect(stored?.id).toBe(credential.device.id);
    expect(stored?.tokenDigest).toBe(
      createHash('sha256').update(credential.token, 'utf8').digest('hex'),
    );
    expect(stored?.tokenDigest).not.toContain(credential.token);
    expect(Object.keys(stored ?? {})).not.toContain('token');
    expect(Object.keys(credential.device)).not.toContain('tokenDigest');
  });

  it('authenticates an active device and updates last-used metadata', () => {
    const issued = registry.issue({ name: 'iPhone' });

    const result = registry.authenticate(issued.token);

    expect(result).toMatchObject({
      status: 'authenticated',
      device: { id: issued.device.id, lastUsedAt: NOW.toISOString() },
    });
    expect(testDb.db.select().from(schema.mobileDevices).get()?.lastUsedAt).toBe(NOW.toISOString());
  });

  it('authenticates the persisted credential through a fresh registry instance', () => {
    const issued = registry.issue({ name: 'iPhone' });
    const restartedRegistry = new MobileDeviceRegistry(testDb.db, { clock: () => NOW });

    expect(restartedRegistry.authenticate(issued.token)).toMatchObject({
      status: 'authenticated',
      device: { id: issued.device.id, name: 'iPhone' },
    });
  });

  it('does not distinguish malformed and unknown credentials', () => {
    registry.issue({ name: 'iPhone' });

    expect(registry.authenticate('not-a-token')).toEqual({ status: 'invalid' });
    expect(registry.authenticate('Z'.repeat(43))).toEqual({ status: 'invalid' });
  });

  it('revokes immediately without deleting device history', () => {
    const { device, token } = registry.issue({ name: 'iPhone' });

    expect(registry.revoke(device.id)).toBe(true);
    expect(registry.authenticate(token)).toEqual({
      status: 'revoked',
      deviceId: device.id,
    });
    expect(registry.list()[0].revokedAt).toBe(NOW.toISOString());
  });

  it('rotates a token and invalidates the previous credential', () => {
    const original = registry.issue({ name: 'iPhone' });

    const rotated = registry.rotate(original.device.id);

    expect(rotated?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated?.token).not.toBe(original.token);
    expect(rotated?.device.tokenVersion).toBe(2);
    expect(rotated?.device.rotatedAt).toBe(NOW.toISOString());
    expect(registry.authenticate(original.token)).toEqual({ status: 'invalid' });
    expect(registry.authenticate(rotated!.token).status).toBe('authenticated');
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
    expect(registry.authenticate(original.token)).toEqual({
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
    const expired = registry.issue({
      name: 'Expired',
      expiresAt: new Date('2026-07-15T09:59:59.000Z'),
    });
    expect(registry.authenticate(expired.token)).toEqual({
      status: 'expired',
      deviceId: expired.device.id,
    });

    const second = registry.issue({ name: 'No capability' });
    testDb.db
      .update(schema.mobileDevices)
      .set({ capabilities: '[]' })
      .where(eq(schema.mobileDevices.id, second.device.id))
      .run();
    expect(registry.authenticate(second.token)).toEqual({
      status: 'capability_required',
      deviceId: second.device.id,
    });
  });

  it('validates device names', () => {
    expect(() => registry.issue({ name: '   ' })).toThrow('Device name');
  });
});
