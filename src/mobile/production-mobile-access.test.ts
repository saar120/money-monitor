import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import * as schema from '../db/schema.js';
import { MOBILE_PROTOCOL_VERSION } from './contract.js';
import type { MobileDeviceCredential, PublicMobileDevice } from './device-registry.js';
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

function requestPairing(
  access: ProductionMobileAccess,
  input: ReturnType<typeof pairingInput>['input'],
) {
  const requested = access.pairingDependencies.sessions.request(input);
  expect(requested.status).toBe('pending_approval');
  if (requested.status !== 'pending_approval') throw new Error('expected pending_approval');
  return requested.claimantSecret;
}

describe('production mobile access composition', () => {
  const databases: TestDb[] = [];
  const servers: Array<ReturnType<typeof createMobileServer>> = [];

  function createHarness(): Harness {
    const database = createTestDb();
    databases.push(database);
    const access = createProductionMobileAccess({
      db: database.db,
      serverId: SERVER_ID_INPUT,
      publicIdKey: PUBLIC_ID_KEY,
      server: {
        displayName: 'Saar’s Mac',
        serverVersion: '0.3.5',
        minimumClientVersion: '0.1.0',
      },
      readNetWorthIls: () => 123_456.78,
      clock: () => NOW,
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

    const claimantSecret = requestPairing(access, input);
    expect(access.pairingDependencies.sessions.claim(input.pairingId, claimantSecret)).toEqual({
      status: 'approval_required',
    });
    expect(manager.approve(input.pairingId)).toEqual({ status: 'approved' });

    const result = access.pairingDependencies.sessions.claim(input.pairingId, claimantSecret);
    expect(result).toMatchObject({
      status: 'claimed',
      credential: {
        device: {
          capabilities: ['mobile.read'],
          protocolVersion: MOBILE_PROTOCOL_VERSION,
        },
      },
    });
    if (result.status !== 'claimed') throw new Error('expected claimed');
    const issued = result.credential as MobileDeviceCredential;
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(access.deviceRegistry.authenticate(issued.token, 'mobile.read').status).toBe(
      'authenticated',
    );

    const stored = database.db.select().from(schema.mobileDevices).get();
    expect(stored?.tokenDigest).not.toBe(issued.token);
    expect(JSON.stringify(stored)).not.toContain(issued.token);
  });

  it('re-pairs by atomically rotating one existing identity after explicit approval', () => {
    const { access } = createHarness();
    const original = access.deviceRegistry.issue({
      name: 'Personal iPhone',
      capabilities: ['mobile.read'],
      protocolVersion: MOBILE_PROTOCOL_VERSION,
    });
    const manager = access.createPairingManager(PUBLIC_URL);
    const { qrPayload, input } = pairingInput(manager, 'Personal iPhone', original.device.id);

    expect(qrPayload).not.toHaveProperty('replacementDeviceId');
    expect(JSON.stringify(manager.inspectAll())).not.toContain(original.device.id);
    const claimantSecret = requestPairing(access, input);
    expect(access.deviceRegistry.authenticate(original.token).status).toBe('authenticated');
    expect(manager.approve(input.pairingId)).toEqual({ status: 'approved' });

    const claimed = access.pairingDependencies.sessions.claim(input.pairingId, claimantSecret);
    expect(claimed).toMatchObject({
      status: 'claimed',
      credential: {
        device: { id: original.device.id, tokenVersion: 2 },
      },
    });
    if (claimed.status !== 'claimed') throw new Error('expected claimed');
    const replacement = claimed.credential as MobileDeviceCredential;
    expect(replacement.token).not.toBe(original.token);
    expect(
      access.pairingDependencies.sessions.claim(input.pairingId, claimantSecret),
    ).toMatchObject({
      status: 'claimed',
      isRetry: true,
      credential: {
        token: replacement.token,
        device: { id: original.device.id, tokenVersion: 2 },
      },
    });
    expect(access.deviceRegistry.authenticate(original.token).status).toBe('invalid');
    expect(access.deviceRegistry.authenticate(replacement.token).status).toBe('authenticated');
    expect(access.deviceRegistry.list()).toHaveLength(1);
    expect(JSON.stringify(manager.inspectAll())).not.toContain(original.device.id);
  });

  it('fails a re-pair closed when its server-side target is missing, revoked, or expired', () => {
    const missing = createHarness();
    const missingManager = missing.access.createPairingManager(PUBLIC_URL);
    const missingPairing = pairingInput(missingManager, 'Personal iPhone', 'missing-device');
    const missingClaimant = requestPairing(missing.access, missingPairing.input);
    missingManager.approve(missingPairing.input.pairingId);
    expect(
      missing.access.pairingDependencies.sessions.claim(
        missingPairing.input.pairingId,
        missingClaimant,
      ),
    ).toEqual({ status: 'credential_issue_failed' });
    expect(missing.access.deviceRegistry.list()).toEqual([]);

    const revoked = createHarness();
    const original = revoked.access.deviceRegistry.issue({ name: 'Personal iPhone' });
    const revokedManager = revoked.access.createPairingManager(PUBLIC_URL);
    const revokedPairing = pairingInput(revokedManager, 'Personal iPhone', original.device.id);
    const revokedClaimant = requestPairing(revoked.access, revokedPairing.input);
    expect(revoked.access.deviceRegistry.revoke(original.device.id)).toBe(true);
    revokedManager.approve(revokedPairing.input.pairingId);
    expect(
      revoked.access.pairingDependencies.sessions.claim(
        revokedPairing.input.pairingId,
        revokedClaimant,
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
    const expiredClaimant = requestPairing(expired.access, expiredPairing.input);
    expiredManager.approve(expiredPairing.input.pairingId);
    expect(
      expired.access.pairingDependencies.sessions.claim(
        expiredPairing.input.pairingId,
        expiredClaimant,
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
    const claimantSecret = 'C'.repeat(43);

    expect(access.pairingDependencies.sessions.request(missingInput)).toEqual({
      status: 'pairing_not_found',
    });
    expect(
      access.pairingDependencies.sessions.poll(missingInput.pairingId, claimantSecret),
    ).toEqual({ status: 'pairing_not_found' });
    expect(
      access.pairingDependencies.sessions.claim(missingInput.pairingId, claimantSecret),
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
    const claimantSecret = requestPairing(access, input);

    access.clearPairingManager();

    expect(access.pairingDependencies.sessions.poll(input.pairingId, claimantSecret)).toEqual({
      status: 'pairing_not_found',
    });
    expect(access.pairingDependencies.sessions.claim(input.pairingId, claimantSecret)).toEqual({
      status: 'pairing_not_found',
    });
    expect(manager.approve(input.pairingId)).toEqual({ status: 'approved' });
    expect(manager.claim(input.pairingId, claimantSecret)).toEqual({
      status: 'credential_issue_failed',
    });
    expect(access.deviceRegistry.list()).toEqual([]);
  });

  it('replacement invalidates the old manager lease while the new manager can pair', () => {
    const { access } = createHarness();
    const oldManager = access.createPairingManager(PUBLIC_URL);
    const oldPairing = pairingInput(oldManager, 'Old iPhone');
    const oldClaimant = requestPairing(access, oldPairing.input);
    oldManager.approve(oldPairing.input.pairingId);

    const newManager = access.createPairingManager(REPLACEMENT_URL);

    expect(
      access.pairingDependencies.sessions.poll(oldPairing.input.pairingId, oldClaimant),
    ).toEqual({ status: 'pairing_not_found' });
    expect(oldManager.claim(oldPairing.input.pairingId, oldClaimant)).toEqual({
      status: 'credential_issue_failed',
    });
    expect(access.deviceRegistry.list()).toEqual([]);

    const newPairing = pairingInput(newManager, 'New iPhone');
    const newClaimant = requestPairing(access, newPairing.input);
    expect(newManager.approve(newPairing.input.pairingId)).toEqual({ status: 'approved' });
    expect(
      access.pairingDependencies.sessions.claim(newPairing.input.pairingId, newClaimant).status,
    ).toBe('claimed');
    expect(access.deviceRegistry.list()).toHaveLength(1);
  });

  it('does not revoke an already-issued persistent credential when pairing state is cleared', () => {
    const { access } = createHarness();
    const manager = access.createPairingManager(PUBLIC_URL);
    const { input } = pairingInput(manager);
    const claimantSecret = requestPairing(access, input);
    manager.approve(input.pairingId);
    const claimed = access.pairingDependencies.sessions.claim(input.pairingId, claimantSecret);
    expect(claimed.status).toBe('claimed');
    if (claimed.status !== 'claimed') throw new Error('expected claimed');
    const issued = claimed.credential as MobileDeviceCredential;

    access.clearPairingManager();

    expect(access.deviceRegistry.authenticate(issued.token).status).toBe('authenticated');
  });

  it('validates stable identity and treats a failed URL replacement transactionally', () => {
    const database = createTestDb();
    databases.push(database);
    expect(() =>
      createProductionMobileAccess({
        db: database.db,
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
