import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_PROTOCOL_VERSION } from './contract.js';
import {
  MOBILE_PAIRING_BODY_LIMIT_BYTES,
  MOBILE_PAIRING_EXCHANGE_ROUTE,
  MOBILE_PAIRING_START_ROUTE,
  MOBILE_PAIRING_STATUS_ROUTE,
  type MobilePairingCredential,
} from './pairing-routes.js';
import {
  DEFAULT_APPROVAL_TIMEOUT_MS,
  DEFAULT_PAIRING_EXPIRY_MS,
  MobilePairingSessionManager,
  PAIRING_INVALID_ATTEMPT_LIMIT,
  PAIRING_INVALID_ATTEMPT_WINDOW_MS,
} from './pairing-session.js';
import { createMobileServer } from './mobile-server.js';

const START_MS = Date.parse('2026-07-15T10:00:00.000Z');
const OTHER_NONCE = 'X'.repeat(43);
const OTHER_CLAIMANT_SECRET = 'Q'.repeat(43);
const SERVER_ID_INPUT = '11111111-1111-4111-8111-AAAAAAAAAAAA';
const SERVER_ID = SERVER_ID_INPUT.toLowerCase();
const BASE_URL = 'https://money-monitor.tailnet.ts.net:8443/money-monitor';
const TOKEN = 'T'.repeat(43);
const CREDENTIAL: MobilePairingCredential = {
  device: {
    id: 'device-1',
    name: 'Personal iPhone',
    capabilities: ['mobile.read'],
    protocolVersion: MOBILE_PROTOCOL_VERSION,
    tokenVersion: 1,
    createdAt: new Date(START_MS).toISOString(),
    lastUsedAt: null,
    expiresAt: null,
    rotatedAt: null,
    revokedAt: null,
  },
  token: TOKEN,
};

interface HarnessOptions {
  credential?: unknown;
  credentialIssuer?: () => unknown;
  errorObserver?: (event: unknown) => void;
}

describe('public mobile pairing routes', () => {
  const openServers: Array<ReturnType<typeof createMobileServer>> = [];

  function createHarness(options: HarnessOptions = {}) {
    let nowMs = START_MS;
    const issueCredential = vi.fn(
      options.credentialIssuer ??
        (() => (options.credential === undefined ? CREDENTIAL : options.credential)),
    );
    const manager = new MobilePairingSessionManager<unknown>({
      serverId: SERVER_ID_INPUT,
      baseURL: BASE_URL,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      credentialIssuer: issueCredential,
      clock: () => new Date(nowMs),
    });
    const created = manager.create();
    const { pairingId, nonce } = created.qrPayload;
    const server = createMobileServer({
      pairing: { sessions: manager },
      clock: () => new Date(nowMs),
      errorObserver: options.errorObserver,
      logger: false,
    });
    openServers.push(server);

    const startBody = {
      pairingId,
      nonce,
      serverId: SERVER_ID_INPUT,
      protocolVersion: created.qrPayload.protocolVersion,
      deviceName: '  Personal   iPhone  ',
    };

    return {
      ...server,
      manager,
      created,
      pairingId,
      nonce,
      issueCredential,
      startBody,
      advance(ms: number) {
        nowMs += ms;
      },
    };
  }

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => server.shutdown()));
  });

  it('requests, polls, requires injected Mac approval, and retries one issued credential', async () => {
    const { app, manager, created, pairingId, nonce, startBody, issueCredential } = createHarness();

    expect(created.qrPayload).toEqual({
      kind: 'money-monitor-pairing',
      version: 1,
      pairingId,
      nonce,
      serverId: SERVER_ID,
      baseURL: BASE_URL,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      expiresAt: new Date(START_MS + DEFAULT_PAIRING_EXPIRY_MS).toISOString(),
    });
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(nonce, 'base64url')).toHaveLength(32);
    expect(manager.approve(pairingId)).toEqual({ status: 'approval_required' });
    expect(JSON.stringify(manager.inspect(pairingId))).not.toContain(nonce);

    const started = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(started.statusCode).toBe(202);
    const startedBody = started.json();
    const claimantSecret = startedBody.data.claimantSecret as string;
    expect(claimantSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(claimantSecret, 'base64url')).toHaveLength(32);
    expect(claimantSecret).not.toBe(nonce);
    expect(startedBody).toEqual({
      data: {
        status: 'pending_approval',
        expiresAt: new Date(START_MS + DEFAULT_APPROVAL_TIMEOUT_MS).toISOString(),
        pollAfterSeconds: 1,
        claimantSecret,
      },
      meta: {
        apiVersion: '1',
        generatedAt: new Date(START_MS).toISOString(),
        source: 'live',
      },
    });
    expect(started.body).not.toContain(nonce);
    expect(started.body).not.toContain(TOKEN);
    expect(manager.inspect(pairingId)).toMatchObject({
      serverId: SERVER_ID,
      deviceName: 'Personal iPhone',
    });
    expect(issueCredential).not.toHaveBeenCalled();

    const beforeApproval = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    expect(beforeApproval.statusCode).toBe(409);
    expect(beforeApproval.json().error.code).toBe('pairing_approval_required');
    expect(issueCredential).not.toHaveBeenCalled();

    const pending = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_STATUS_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().data.status).toBe('pending_approval');
    expect(pending.body).not.toContain('Personal iPhone');
    expect(pending.body).not.toContain(pairingId);

    // Approval is deliberately available only through the injected Mac-side
    // manager, never through a mobile HTTP route.
    expect(manager.approve(pairingId)).toEqual({ status: 'approved' });

    const approved = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_STATUS_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({
      data: { status: 'approved' },
      meta: {
        apiVersion: '1',
        generatedAt: new Date(START_MS).toISOString(),
        source: 'live',
      },
    });

    const exchanged = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    expect(exchanged.statusCode).toBe(201);
    expect(exchanged.json()).toEqual({
      data: { status: 'claimed', credential: CREDENTIAL },
      meta: {
        apiVersion: '1',
        generatedAt: new Date(START_MS).toISOString(),
        source: 'live',
      },
    });
    expect(exchanged.body).toContain(TOKEN);
    expect(issueCredential).toHaveBeenCalledOnce();
    expect(issueCredential).toHaveBeenCalledWith({
      pairingId,
      deviceName: 'Personal iPhone',
      serverId: SERVER_ID,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
    });

    const replay = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      data: { status: 'claimed', credential: CREDENTIAL },
    });
    expect(replay.body).toContain(TOKEN);
    expect(issueCredential).toHaveBeenCalledOnce();

    const inspection = JSON.stringify(manager.inspectAll());
    expect(inspection).not.toContain(nonce);
    expect(inspection).not.toContain(claimantSecret);
    expect(inspection).not.toContain(TOKEN);
  });

  it('makes a copied original QR unable to poll, exchange, or recover the claimant secret', async () => {
    const observedErrors: unknown[] = [];
    const { app, manager, pairingId, nonce, startBody, issueCredential } = createHarness({
      errorObserver: (event) => observedErrors.push(event),
    });

    const firstStart = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(firstStart.statusCode).toBe(202);
    const claimantSecret = firstStart.json().data.claimantSecret as string;

    const copiedStart = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(copiedStart.statusCode).toBe(409);
    expect(copiedStart.json().error.code).toBe('pairing_replayed');
    expect(copiedStart.body).not.toContain(claimantSecret);
    expect(copiedStart.body).not.toContain(nonce);

    for (const candidateSecret of [nonce, OTHER_CLAIMANT_SECRET]) {
      for (const url of [MOBILE_PAIRING_STATUS_ROUTE, MOBILE_PAIRING_EXCHANGE_ROUTE]) {
        const response = await app.inject({
          method: 'POST',
          url,
          payload: { pairingId, claimantSecret: candidateSecret },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('pairing_invalid');
        expect(response.body).not.toContain(candidateSecret);
      }
    }

    expect(manager.approve(pairingId)).toEqual({ status: 'approved' });
    const claimed = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    expect(claimed.statusCode).toBe(201);
    expect(issueCredential).toHaveBeenCalledOnce();

    const observed = JSON.stringify(observedErrors);
    expect(observed).not.toContain(nonce);
    expect(observed).not.toContain(claimantSecret);
    expect(observed).not.toContain(OTHER_CLAIMANT_SECRET);
    expect(observed).not.toContain(TOKEN);
  });

  it('keeps the idempotent claim available only until the pairing session expires', async () => {
    const { app, manager, pairingId, startBody, advance, issueCredential } = createHarness();
    const started = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    const claimantSecret = started.json().data.claimantSecret as string;
    manager.approve(pairingId);

    const first = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    expect(first.statusCode).toBe(201);

    advance(DEFAULT_PAIRING_EXPIRY_MS);
    const expired = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe('pairing_expired');
    expect(expired.body).not.toContain(TOKEN);
    expect(issueCredential).toHaveBeenCalledOnce();
  });

  it('collapses wrong-server, unknown-session, and invalid-nonce proof failures without consuming the session', async () => {
    const { app, nonce, startBody } = createHarness();

    const attempts = await Promise.all([
      app.inject({
        method: 'POST',
        url: MOBILE_PAIRING_START_ROUTE,
        payload: { ...startBody, serverId: 'wrong-server' },
      }),
      app.inject({
        method: 'POST',
        url: MOBILE_PAIRING_START_ROUTE,
        payload: { ...startBody, pairingId: 'unknown-session' },
      }),
      app.inject({
        method: 'POST',
        url: MOBILE_PAIRING_START_ROUTE,
        payload: { ...startBody, nonce: OTHER_NONCE },
      }),
    ]);

    for (const response of attempts) {
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('pairing_invalid');
      expect(response.body).not.toContain(nonce);
      expect(response.body).not.toContain(OTHER_NONCE);
      expect(response.body).not.toContain('wrong-server');
      expect(response.body).not.toContain('unknown-session');
    }

    const validStart = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(validStart.statusCode).toBe(202);
  });

  it('returns upgrade_required without feature data or consuming the session for an incompatible protocol', async () => {
    const { app, startBody } = createHarness();

    const response = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: { ...startBody, protocolVersion: MOBILE_PROTOCOL_VERSION + 1 },
    });

    expect(response.statusCode).toBe(426);
    expect(response.json().error.code).toBe('upgrade_required');
    expect(response.json()).not.toHaveProperty('data');

    const validStart = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(validStart.statusCode).toBe(202);
  });

  it('expires an unused proof and a pending approval at five minutes without issuing a credential', async () => {
    const unused = createHarness();
    unused.advance(DEFAULT_PAIRING_EXPIRY_MS);

    const unusedResponse = await unused.app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: unused.startBody,
    });
    expect(unusedResponse.statusCode).toBe(410);
    expect(unusedResponse.json().error.code).toBe('pairing_expired');
    expect(unusedResponse.body).not.toContain(unused.nonce);
    expect(unused.issueCredential).not.toHaveBeenCalled();

    const pending = createHarness();
    const started = await pending.app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: pending.startBody,
    });
    const claimantSecret = started.json().data.claimantSecret as string;
    pending.advance(DEFAULT_APPROVAL_TIMEOUT_MS);

    expect(pending.manager.approve(pending.pairingId)).toEqual({ status: 'pairing_expired' });
    const exchange = await pending.app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: pending.pairingId, claimantSecret },
    });
    expect(exchange.statusCode).toBe(410);
    expect(exchange.json().error.code).toBe('pairing_expired');
    expect(pending.issueCredential).not.toHaveBeenCalled();
  });

  it('surfaces Mac rejection as terminal without issuing or echoing a credential', async () => {
    const { app, manager, pairingId, startBody, issueCredential } = createHarness();
    const started = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    const claimantSecret = started.json().data.claimantSecret as string;
    expect(manager.reject(pairingId)).toEqual({ status: 'rejected' });
    expect(manager.approve(pairingId)).toEqual({ status: 'pairing_rejected' });

    const status = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_STATUS_ROUTE,
      payload: { pairingId, claimantSecret },
    });
    const exchange = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId, claimantSecret },
    });

    expect(status.statusCode).toBe(403);
    expect(status.json().error.code).toBe('pairing_rejected');
    expect(exchange.statusCode).toBe(403);
    expect(exchange.json().error.code).toBe('pairing_rejected');
    expect(status.body).not.toContain(TOKEN);
    expect(exchange.body).not.toContain(TOKEN);
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it('rate limits after five invalid proof attempts and resets after the window', async () => {
    const { app, startBody, advance } = createHarness();

    for (let attempt = 0; attempt < PAIRING_INVALID_ATTEMPT_LIMIT; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: MOBILE_PAIRING_START_ROUTE,
        payload: { ...startBody, nonce: OTHER_NONCE },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('pairing_invalid');
    }

    const limited = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('rate_limited');

    advance(PAIRING_INVALID_ATTEMPT_WINDOW_MS + 1);
    const recovered = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(recovered.statusCode).toBe(202);
  });

  it('bounds request bodies and rejects invalid device names, unsafe replacement IDs, and extra fields', async () => {
    const { app, manager, pairingId, startBody } = createHarness();

    const emptyManager = new MobilePairingSessionManager({
      serverId: SERVER_ID,
      baseURL: BASE_URL,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      credentialIssuer: () => CREDENTIAL,
    });
    expect(() => emptyManager.create({ replacementDeviceId: '../device-1' })).toThrow(
      'valid opaque identifier',
    );
    expect(emptyManager.inspectAll()).toEqual([]);

    for (const badName of ['   ', 'x'.repeat(81)]) {
      const invalidName = await app.inject({
        method: 'POST',
        url: MOBILE_PAIRING_START_ROUTE,
        payload: { ...startBody, deviceName: badName },
      });
      expect(invalidName.statusCode).toBe(400);
      expect(invalidName.json().error.code).toBe('validation_error');
    }

    const extraField = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: { ...startBody, balance: '1000000.00' },
    });
    expect(extraField.statusCode).toBe(400);
    expect(extraField.json().error.code).toBe('validation_error');
    expect(extraField.body).not.toContain('balance');

    const oversized = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        ...startBody,
        deviceName: 'x'.repeat(MOBILE_PAIRING_BODY_LIMIT_BYTES),
      }),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe('payload_too_large');
    expect(manager.inspect(pairingId)?.status).toBe('awaiting_request');

    const missingClaimant = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_STATUS_ROUTE,
      payload: { pairingId },
    });
    expect(missingClaimant.statusCode).toBe(400);
    expect(missingClaimant.json().error.code).toBe('validation_error');
  });

  it('fails closed when an issuer throws or returns an unsafe credential shape', async () => {
    const unsafeSecret = 'FORBIDDEN_PAIRING_SECRET';
    const unsafe = createHarness({
      credential: { ...CREDENTIAL, databasePassword: unsafeSecret },
    });
    const unsafeStart = await unsafe.app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: unsafe.startBody,
    });
    const unsafeClaimant = unsafeStart.json().data.claimantSecret as string;
    unsafe.manager.approve(unsafe.pairingId);

    const unsafeResponse = await unsafe.app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: unsafe.pairingId, claimantSecret: unsafeClaimant },
    });
    expect(unsafeResponse.statusCode).toBe(500);
    expect(unsafeResponse.json().error.code).toBe('internal_server_error');
    expect(unsafeResponse.body).not.toContain(unsafeSecret);
    expect(unsafeResponse.body).not.toContain(TOKEN);

    const throwing = createHarness({
      credentialIssuer: () => {
        throw new Error('sensitive database detail');
      },
    });
    const throwingStart = await throwing.app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: throwing.startBody,
    });
    const throwingClaimant = throwingStart.json().data.claimantSecret as string;
    throwing.manager.approve(throwing.pairingId);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await throwing.app.inject({
        method: 'POST',
        url: MOBILE_PAIRING_EXCHANGE_ROUTE,
        payload: { pairingId: throwing.pairingId, claimantSecret: throwingClaimant },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('internal_server_error');
      expect(response.body).not.toContain('sensitive database detail');
    }
    expect(throwing.issueCredential).toHaveBeenCalledOnce();
    expect(JSON.stringify(throwing.manager.inspect(throwing.pairingId))).not.toContain(
      'sensitive database detail',
    );
  });

  it.each([
    ['GET', MOBILE_PAIRING_START_ROUTE],
    ['HEAD', MOBILE_PAIRING_START_ROUTE],
    ['GET', MOBILE_PAIRING_STATUS_ROUTE],
    ['HEAD', MOBILE_PAIRING_STATUS_ROUTE],
    ['GET', MOBILE_PAIRING_EXCHANGE_ROUTE],
    ['HEAD', MOBILE_PAIRING_EXCHANGE_ROUTE],
    ['POST', '/api/mobile/v1/pairing/approve'],
    ['POST', '/api/mobile/v1/pairing/reject'],
  ] as const)('does not expose unsupported %s %s', async (method, url) => {
    const { app } = createHarness();

    const response = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });

    expect(response.statusCode).toBe(404);
    if (method !== 'HEAD') {
      expect(response.json().error.code).toBe('route_not_found');
    }
  });
});
