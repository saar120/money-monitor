import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import * as schema from '../db/schema.js';
import { MOBILE_PROTOCOL_VERSION } from './contract.js';
import type {
  MobileDeviceCredential,
  MobileDeviceRegistryOptions,
  PublicMobileDevice,
} from './device-registry.js';
import { MOBILE_PAIRING_START_ROUTE } from './pairing-routes.js';
import type { MobilePairingSessionManager } from './pairing-session.js';
import {
  createProductionMobileAccess,
  type ProductionMobileAccess,
} from './production-mobile-access.js';
import { createMobileServer } from './mobile-server.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';

const NOW = new Date('2026-07-15T10:00:00.000Z');
const SERVER_ID = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const SERVER_ID_INPUT = SERVER_ID.toUpperCase();
const PUBLIC_ID_KEY = 'private-public-id-key-material-that-is-at-least-32-chars';
const DEVICE_TOKEN = 'T'.repeat(43);
const CLAIMANT_SECRET = 'C'.repeat(43);
const PUBLIC_URL = 'https://money-monitor.tailnet.ts.net:8443/money-monitor';
const REPLACEMENT_URL = 'https://replacement.tailnet.ts.net:8443/money-monitor';

const AUTHENTICATED_DEVICE: PublicMobileDevice = {
  id: 'device-01',
  name: 'Personal iPhone',
  capabilities: ['mobile.read'],
  protocolVersion: MOBILE_PROTOCOL_VERSION,
  tokenVersion: 1,
  createdAt: NOW.toISOString(),
  lastUsedAt: null,
  expiresAt: null,
  rotatedAt: null,
  revokedAt: null,
};

interface Harness {
  database: TestDb;
  access: ProductionMobileAccess;
}

function pairingInput(
  manager: MobilePairingSessionManager<MobileDeviceCredential>,
  deviceName = 'Personal iPhone',
  replacementDeviceId?: string,
) {
  const { qrPayload } = manager.create(replacementDeviceId ? { replacementDeviceId } : undefined);
  return {
    qrPayload,
    input: {
      pairingId: qrPayload.pairingId,
      nonce: qrPayload.nonce,
      serverId: qrPayload.serverId,
      protocolVersion: qrPayload.protocolVersion,
      deviceName,
    },
  };
}

describe('production mobile access composition', () => {
  const databases: TestDb[] = [];
  const servers: Array<ReturnType<typeof createMobileServer>> = [];

  function createHarness(
    deviceRegistryOptions: Omit<MobileDeviceRegistryOptions, 'clock'> = {
      idFactory: () => 'device-01',
      tokenFactory: () => DEVICE_TOKEN,
    },
  ): Harness {
    const database = createTestDb();
    databases.push(database);
    let pairingSequence = 0;
    const access = createProductionMobileAccess({
      db: database.db,
      sqlite: database.sqlite,
      serverId: SERVER_ID_INPUT,
      publicIdKey: PUBLIC_ID_KEY,
      server: {
        displayName: 'Saar’s Mac',
        serverVersion: '0.3.5',
        minimumClientVersion: '0.1.0',
      },
      readNetWorthIls: () => 123_456.78,
      clock: () => NOW,
      deviceRegistryOptions,
      pairingManagerOptions: {
        idFactory: () => `pairing-${++pairingSequence}`,
        nonceFactory: () => String.fromCharCode(64 + pairingSequence).repeat(43),
        claimantSecretFactory: () => CLAIMANT_SECRET,
      },
    });
    return { database, access };
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.shutdown()));
    databases.splice(0).forEach((database) => database.close());
  });

  it('composes production read ports, safe adapters, registry, and one authenticator', async () => {
    const { access } = createHarness();

    const bootstrap = await access.bootstrapDependencies.provide(AUTHENTICATED_DEVICE);

    expect(bootstrap).toMatchObject({
      data: {
        home: {
          aggregates: {
            netWorth: { amount: { value: '123456.78', currencyCode: 'ILS' } },
          },
        },
        recentTransactions: [],
        accounts: [],
      },
      meta: {
        apiVersion: '1',
        server: {
          id: SERVER_ID,
          displayName: 'Saar’s Mac',
          protocolVersion: MOBILE_PROTOCOL_VERSION,
          capabilities: ['mobile.read'],
        },
      },
    });
    expect(access.bootstrapDependencies.authenticator).toBe(access.deviceRegistry);
    expect(access.transactionDependencies.authenticator).toBe(access.deviceRegistry);
    expect(access.transactionDependencies.server).toEqual({
      id: SERVER_ID,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
    });
    expect(
      await access.transactionDependencies.list(
        { limit: 30, includeExcluded: false },
        { generatedAt: NOW.toISOString(), financialDate: '2026-07-15' },
        AUTHENTICATED_DEVICE,
      ),
    ).toEqual({
      financialDate: '2026-07-15',
      transactions: [],
      page: { hasMore: false, nextCursor: null },
    });
  });

  it('fails bootstrap, transaction list, and detail closed when the desktop source is unavailable', async () => {
    const database = createTestDb();
    databases.push(database);
    let available = true;
    let netWorthReads = 0;
    const access = createProductionMobileAccess({
      db: database.db,
      sqlite: database.sqlite,
      serverId: SERVER_ID,
      publicIdKey: PUBLIC_ID_KEY,
      server: {
        displayName: 'Saar’s Mac',
        serverVersion: '0.3.5',
        minimumClientVersion: '0.1.0',
      },
      readNetWorthIls: () => {
        netWorthReads += 1;
        return 123;
      },
      isMobileReadAvailable: () => available,
      clock: () => NOW,
    });

    await expect(access.bootstrapDependencies.provide(AUTHENTICATED_DEVICE)).resolves.toBeDefined();
    const context = { generatedAt: NOW.toISOString(), financialDate: '2026-07-15' };
    const query = { limit: 30, includeExcluded: false };
    expect(access.transactionDependencies.list(query, context, AUTHENTICATED_DEVICE)).toBeDefined();
    const missingTransactionId = createMobilePublicIdProjector(PUBLIC_ID_KEY)('transaction', 999);
    expect(
      access.transactionDependencies.detail(missingTransactionId, context, AUTHENTICATED_DEVICE),
    ).toBeNull();
    available = false;
    expect(() => access.bootstrapDependencies.provide(AUTHENTICATED_DEVICE)).toThrow('unavailable');
    expect(() => access.transactionDependencies.list(query, context, AUTHENTICATED_DEVICE)).toThrow(
      'unavailable',
    );
    expect(() =>
      access.transactionDependencies.detail(missingTransactionId, context, AUTHENTICATED_DEVICE),
    ).toThrow('unavailable');
    expect(netWorthReads).toBe(1);
  });

  it('issues and persists one scoped credential only after explicit Mac approval', () => {
    const { database, access } = createHarness();
    const manager = access.createPairingManager(PUBLIC_URL);
    const { input } = pairingInput(manager);

    expect(access.pairingDependencies.sessions.request(input).status).toBe('pending_approval');
    expect(access.pairingDependencies.sessions.claim(input.pairingId, CLAIMANT_SECRET)).toEqual({
      status: 'approval_required',
    });
    expect(manager.approve(input.pairingId)).toEqual({ status: 'approved' });

    const result = access.pairingDependencies.sessions.claim(input.pairingId, CLAIMANT_SECRET);
    expect(result).toMatchObject({
      status: 'claimed',
      credential: {
        token: DEVICE_TOKEN,
        device: {
          id: 'device-01',
          capabilities: ['mobile.read'],
          protocolVersion: MOBILE_PROTOCOL_VERSION,
        },
      },
    });
    expect(access.deviceRegistry.authenticate(DEVICE_TOKEN, 'mobile.read').status).toBe(
      'authenticated',
    );

    const stored = database.db.select().from(schema.mobileDevices).get();
    expect(stored?.tokenDigest).not.toBe(DEVICE_TOKEN);
    expect(JSON.stringify(stored)).not.toContain(DEVICE_TOKEN);
  });

  it('re-pairs by atomically rotating one existing identity after explicit approval', () => {
    const originalToken = 'O'.repeat(43);
    const replacementToken = 'R'.repeat(43);
    const tokens = [originalToken, replacementToken];
    const { access } = createHarness({
      idFactory: () => 'device-01',
      tokenFactory: () => tokens.shift() ?? 'X'.repeat(43),
    });
    const original = access.deviceRegistry.issue({
      name: 'Personal iPhone',
      capabilities: ['mobile.read'],
      protocolVersion: MOBILE_PROTOCOL_VERSION,
    });
    const manager = access.createPairingManager(PUBLIC_URL);
    const { qrPayload, input } = pairingInput(manager, 'Personal iPhone', original.device.id);

    expect(qrPayload).not.toHaveProperty('replacementDeviceId');
    expect(access.pairingDependencies.sessions.request(input).status).toBe('pending_approval');
    expect(access.deviceRegistry.authenticate(originalToken).status).toBe('authenticated');
    expect(manager.approve(input.pairingId)).toEqual({ status: 'approved' });

    const claimed = access.pairingDependencies.sessions.claim(input.pairingId, CLAIMANT_SECRET);
    expect(claimed).toMatchObject({
      status: 'claimed',
      credential: {
        token: replacementToken,
        device: { id: original.device.id, tokenVersion: 2 },
      },
    });
    expect(
      access.pairingDependencies.sessions.claim(input.pairingId, CLAIMANT_SECRET),
    ).toMatchObject({
      status: 'claimed',
      isRetry: true,
      credential: {
        token: replacementToken,
        device: { id: original.device.id, tokenVersion: 2 },
      },
    });
    expect(access.deviceRegistry.authenticate(originalToken).status).toBe('invalid');
    expect(access.deviceRegistry.authenticate(replacementToken).status).toBe('authenticated');
    expect(access.deviceRegistry.list()).toHaveLength(1);
  });

  it('fails a re-pair closed when its server-side target is missing, revoked, or expired', () => {
    const missing = createHarness();
    const missingManager = missing.access.createPairingManager(PUBLIC_URL);
    const missingPairing = pairingInput(missingManager, 'Personal iPhone', 'missing-device');
    missing.access.pairingDependencies.sessions.request(missingPairing.input);
    missingManager.approve(missingPairing.input.pairingId);
    expect(
      missing.access.pairingDependencies.sessions.claim(
        missingPairing.input.pairingId,
        CLAIMANT_SECRET,
      ),
    ).toEqual({ status: 'credential_issue_failed' });
    expect(missing.access.deviceRegistry.list()).toEqual([]);

    const revoked = createHarness();
    const original = revoked.access.deviceRegistry.issue({ name: 'Personal iPhone' });
    const revokedManager = revoked.access.createPairingManager(PUBLIC_URL);
    const revokedPairing = pairingInput(revokedManager, 'Personal iPhone', original.device.id);
    revoked.access.pairingDependencies.sessions.request(revokedPairing.input);
    expect(revoked.access.deviceRegistry.revoke(original.device.id)).toBe(true);
    revokedManager.approve(revokedPairing.input.pairingId);
    expect(
      revoked.access.pairingDependencies.sessions.claim(
        revokedPairing.input.pairingId,
        CLAIMANT_SECRET,
      ),
    ).toEqual({ status: 'credential_issue_failed' });
    expect(revoked.access.deviceRegistry.list()).toEqual([
      expect.objectContaining({ id: original.device.id, revokedAt: NOW.toISOString() }),
    ]);

    const expired = createHarness();
    const expiredOriginal = expired.access.deviceRegistry.issue({
      name: 'Personal iPhone',
      expiresAt: NOW,
    });
    const expiredManager = expired.access.createPairingManager(PUBLIC_URL);
    const expiredPairing = pairingInput(
      expiredManager,
      'Personal iPhone',
      expiredOriginal.device.id,
    );
    expired.access.pairingDependencies.sessions.request(expiredPairing.input);
    expiredManager.approve(expiredPairing.input.pairingId);
    expect(
      expired.access.pairingDependencies.sessions.claim(
        expiredPairing.input.pairingId,
        CLAIMANT_SECRET,
      ),
    ).toEqual({ status: 'credential_issue_failed' });
    expect(expired.access.deviceRegistry.list()).toEqual([
      expect.objectContaining({
        id: expiredOriginal.device.id,
        expiresAt: NOW.toISOString(),
        tokenVersion: 1,
        rotatedAt: null,
      }),
    ]);
  });

  it('fails closed through the stable route proxy while no manager is active', async () => {
    const { access } = createHarness();
    const missingInput = {
      pairingId: 'missing-pairing',
      nonce: 'N'.repeat(43),
      serverId: SERVER_ID,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      deviceName: 'Personal iPhone',
    };

    expect(access.pairingDependencies.sessions.request(missingInput)).toEqual({
      status: 'pairing_not_found',
    });
    expect(
      access.pairingDependencies.sessions.poll(missingInput.pairingId, CLAIMANT_SECRET),
    ).toEqual({ status: 'pairing_not_found' });
    expect(
      access.pairingDependencies.sessions.claim(missingInput.pairingId, CLAIMANT_SECRET),
    ).toEqual({
      status: 'pairing_not_found',
    });

    const server = createMobileServer({ pairing: access.pairingDependencies, logger: false });
    servers.push(server);
    const response = await server.app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: missingInput,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('pairing_invalid');
    expect(response.body).not.toContain(missingInput.nonce);
  });

  it('clearing invalidates pending sessions even through a retained stale manager reference', () => {
    const { access } = createHarness();
    const manager = access.createPairingManager(PUBLIC_URL);
    const { input } = pairingInput(manager);
    access.pairingDependencies.sessions.request(input);

    access.clearPairingManager();

    expect(access.pairingDependencies.sessions.poll(input.pairingId, CLAIMANT_SECRET)).toEqual({
      status: 'pairing_not_found',
    });
    expect(access.pairingDependencies.sessions.claim(input.pairingId, CLAIMANT_SECRET)).toEqual({
      status: 'pairing_not_found',
    });
    expect(manager.approve(input.pairingId)).toEqual({ status: 'approved' });
    expect(manager.claim(input.pairingId, CLAIMANT_SECRET)).toEqual({
      status: 'credential_issue_failed',
    });
    expect(access.deviceRegistry.list()).toEqual([]);
  });

  it('replacement invalidates the old manager lease while the new manager can pair', () => {
    const { access } = createHarness();
    const oldManager = access.createPairingManager(PUBLIC_URL);
    const oldPairing = pairingInput(oldManager, 'Old iPhone');
    access.pairingDependencies.sessions.request(oldPairing.input);
    oldManager.approve(oldPairing.input.pairingId);

    const newManager = access.createPairingManager(REPLACEMENT_URL);

    expect(
      access.pairingDependencies.sessions.poll(oldPairing.input.pairingId, CLAIMANT_SECRET),
    ).toEqual({ status: 'pairing_not_found' });
    expect(oldManager.claim(oldPairing.input.pairingId, CLAIMANT_SECRET)).toEqual({
      status: 'credential_issue_failed',
    });
    expect(access.deviceRegistry.list()).toEqual([]);

    const newPairing = pairingInput(newManager, 'New iPhone');
    expect(access.pairingDependencies.sessions.request(newPairing.input).status).toBe(
      'pending_approval',
    );
    expect(newManager.approve(newPairing.input.pairingId)).toEqual({ status: 'approved' });
    expect(
      access.pairingDependencies.sessions.claim(newPairing.input.pairingId, CLAIMANT_SECRET).status,
    ).toBe('claimed');
    expect(access.deviceRegistry.list()).toHaveLength(1);
  });

  it('does not revoke an already-issued persistent credential when pairing state is cleared', () => {
    const { access } = createHarness();
    const manager = access.createPairingManager(PUBLIC_URL);
    const { input } = pairingInput(manager);
    access.pairingDependencies.sessions.request(input);
    manager.approve(input.pairingId);
    expect(access.pairingDependencies.sessions.claim(input.pairingId, CLAIMANT_SECRET).status).toBe(
      'claimed',
    );

    access.clearPairingManager();

    expect(access.deviceRegistry.authenticate(DEVICE_TOKEN).status).toBe('authenticated');
  });

  it('validates stable identity and treats a failed URL replacement transactionally', () => {
    const database = createTestDb();
    databases.push(database);
    expect(() =>
      createProductionMobileAccess({
        db: database.db,
        sqlite: database.sqlite,
        serverId: 'not-a-uuid',
        publicIdKey: PUBLIC_ID_KEY,
        server: {
          displayName: 'Mac',
          serverVersion: '0.3.5',
          minimumClientVersion: '0.1.0',
        },
        readNetWorthIls: () => 0,
      }),
    ).toThrow('stable UUID');

    const { access } = createHarness();
    const manager = access.createPairingManager(PUBLIC_URL);
    const { input } = pairingInput(manager);
    expect(() => access.createPairingManager('http://unsafe-lan.example')).toThrow('HTTPS');
    expect(manager.inspect(input.pairingId)?.status).toBe('awaiting_request');
  });
});
