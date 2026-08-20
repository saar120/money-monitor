import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  DEFAULT_PAIRING_EXPIRY_MS,
  MobilePairingSessionManager,
  PAIRING_INVALID_ATTEMPT_LIMIT,
  type PairingQrPayload,
} from './pairing-session.js';
import { createMobileServer } from './mobile-server.js';

const FIXTURE_DIRECTORY = join(process.cwd(), 'ios', 'Fixtures', 'MobilePairing');
const PAIRING_FIXTURES = [
  'pairing-error-expired.json',
  'pairing-error-rejected.json',
  'pairing-error-replayed.json',
  'pairing-error-upgrade-required.json',
  'pairing-exchange-claimed.json',
  'pairing-qr-valid.json',
  'pairing-start-pending.json',
  'pairing-status-approved.json',
] as const;

function loadPairingFixture(name: (typeof PAIRING_FIXTURES)[number]): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIRECTORY, name), 'utf8')) as unknown;
}

interface PendingFixture {
  data: {
    status: 'pending_approval';
    expiresAt: string;
    pollAfterSeconds: 1;
    claimantSecret: string;
  };
  meta: { apiVersion: '1'; generatedAt: string; source: 'live' };
}

interface ClaimedFixture {
  data: { status: 'claimed'; credential: MobilePairingCredential };
  meta: { apiVersion: '1'; generatedAt: string; source: 'live' };
}

const QR_FIXTURE = loadPairingFixture('pairing-qr-valid.json') as PairingQrPayload;
const PENDING_FIXTURE = loadPairingFixture('pairing-start-pending.json') as PendingFixture;
const CLAIMED_FIXTURE = loadPairingFixture('pairing-exchange-claimed.json') as ClaimedFixture;

const START_MS = Date.parse(PENDING_FIXTURE.meta.generatedAt);
const PAIRING_ID = QR_FIXTURE.pairingId;
const NONCE = QR_FIXTURE.nonce;
const OTHER_NONCE = 'X'.repeat(43);
const CLAIMANT_SECRET = PENDING_FIXTURE.data.claimantSecret;
const OTHER_CLAIMANT_SECRET = 'Q'.repeat(43);
const TOKEN = CLAIMED_FIXTURE.data.credential.token;
const SERVER_ID = QR_FIXTURE.serverId;
const BASE_URL = QR_FIXTURE.baseURL;
const CREDENTIAL = CLAIMED_FIXTURE.data.credential;

interface HarnessOptions {
  credential?: unknown;
  errorObserver?: (event: unknown) => void;
}

describe('public mobile pairing routes', () => {
  const openServers: Array<ReturnType<typeof createMobileServer>> = [];

  function createHarness(options: HarnessOptions = {}) {
    let nowMs = START_MS;
    const issueCredential = vi.fn(() =>
      options.credential === undefined ? CREDENTIAL : options.credential,
    );
    const manager = new MobilePairingSessionManager<unknown>({
      serverId: SERVER_ID,
      baseURL: BASE_URL,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      credentialIssuer: issueCredential,
      clock: () => new Date(nowMs),
      idFactory: () => PAIRING_ID,
      nonceFactory: () => NONCE,
      claimantSecretFactory: () => CLAIMANT_SECRET,
    });
    const created = manager.create();
    expect(created.qrPayload).toEqual(QR_FIXTURE);
    const server = createMobileServer({
      pairing: { sessions: manager },
      clock: () => new Date(nowMs),
      errorObserver: options.errorObserver,
      logger: false,
    });
    openServers.push(server);

    const startBody = {
      pairingId: created.qrPayload.pairingId,
      nonce: created.qrPayload.nonce,
      serverId: created.qrPayload.serverId,
      protocolVersion: created.qrPayload.protocolVersion,
      deviceName: '  Personal   iPhone  ',
    };

    return {
      ...server,
      manager,
      created,
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

  it('keeps one explicit pairing fixture inventory shared by TypeScript and Swift', () => {
    expect(
      readdirSync(FIXTURE_DIRECTORY)
        .filter((name) => name.endsWith('.json'))
        .sort(),
    ).toEqual([...PAIRING_FIXTURES].sort());
  });

  it('requests, polls, requires injected Mac approval, and retries one issued credential', async () => {
    const { app, manager, startBody, issueCredential } = createHarness();

    const started = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual(PENDING_FIXTURE);
    expect(started.body).not.toContain(NONCE);
    expect(started.body).not.toContain(TOKEN);
    expect(issueCredential).not.toHaveBeenCalled();

    const beforeApproval = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    expect(beforeApproval.statusCode).toBe(409);
    expect(beforeApproval.json().error.code).toBe('pairing_approval_required');
    expect(issueCredential).not.toHaveBeenCalled();

    const pending = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_STATUS_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().data.status).toBe('pending_approval');
    expect(pending.body).not.toContain('Personal iPhone');
    expect(pending.body).not.toContain(PAIRING_ID);

    // Approval is deliberately available only through the injected Mac-side
    // manager, never through a mobile HTTP route.
    expect(manager.approve(PAIRING_ID)).toEqual({ status: 'approved' });

    const approved = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_STATUS_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual(loadPairingFixture('pairing-status-approved.json'));

    const exchanged = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    expect(exchanged.statusCode).toBe(201);
    expect(exchanged.json()).toEqual(CLAIMED_FIXTURE);
    expect(exchanged.body).toContain(TOKEN);
    expect(issueCredential).toHaveBeenCalledOnce();

    const replay = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      data: { status: 'claimed', credential: CREDENTIAL },
    });
    expect(replay.body).toContain(TOKEN);
    expect(issueCredential).toHaveBeenCalledOnce();
  });

  it('makes a copied original QR unable to poll, exchange, or recover the claimant secret', async () => {
    const observedErrors: unknown[] = [];
    const { app, manager, startBody, issueCredential } = createHarness({
      errorObserver: (event) => observedErrors.push(event),
    });

    const firstStart = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(firstStart.statusCode).toBe(202);
    expect(firstStart.json().data.claimantSecret).toBe(CLAIMANT_SECRET);

    const copiedStart = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });
    expect(copiedStart.statusCode).toBe(409);
    expect(copiedStart.json()).toEqual(loadPairingFixture('pairing-error-replayed.json'));
    expect(copiedStart.body).not.toContain(CLAIMANT_SECRET);
    expect(copiedStart.body).not.toContain(NONCE);

    for (const claimantSecret of [NONCE, OTHER_CLAIMANT_SECRET]) {
      for (const url of [MOBILE_PAIRING_STATUS_ROUTE, MOBILE_PAIRING_EXCHANGE_ROUTE]) {
        const response = await app.inject({
          method: 'POST',
          url,
          payload: { pairingId: PAIRING_ID, claimantSecret },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('pairing_invalid');
        expect(response.body).not.toContain(claimantSecret);
      }
    }

    expect(manager.approve(PAIRING_ID)).toEqual({ status: 'approved' });
    const claimed = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    expect(claimed.statusCode).toBe(201);
    expect(issueCredential).toHaveBeenCalledOnce();

    const observed = JSON.stringify(observedErrors);
    expect(observed).not.toContain(NONCE);
    expect(observed).not.toContain(CLAIMANT_SECRET);
    expect(observed).not.toContain(OTHER_CLAIMANT_SECRET);
    expect(observed).not.toContain(TOKEN);
  });

  it('keeps the idempotent claim available only until the pairing session expires', async () => {
    const { app, manager, startBody, advance, issueCredential } = createHarness();
    await app.inject({ method: 'POST', url: MOBILE_PAIRING_START_ROUTE, payload: startBody });
    manager.approve(PAIRING_ID);

    const first = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    expect(first.statusCode).toBe(201);

    advance(DEFAULT_PAIRING_EXPIRY_MS);
    const expired = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe('pairing_expired');
    expect(expired.body).not.toContain(TOKEN);
    expect(issueCredential).toHaveBeenCalledOnce();
  });

  it('keeps every pairing route absent until the dependency boundary is supplied', async () => {
    const server = createMobileServer({ logger: false });
    openServers.push(server);

    for (const url of [
      MOBILE_PAIRING_START_ROUTE,
      MOBILE_PAIRING_STATUS_ROUTE,
      MOBILE_PAIRING_EXCHANGE_ROUTE,
    ]) {
      const response = await server.app.inject({ method: 'POST', url, payload: {} });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('route_not_found');
    }
  });

  it('leaves health and pairing public while protected features still require a credential', async () => {
    const { manager, startBody } = createHarness();
    const authenticate = vi.fn(() => ({ status: 'invalid' as const }));
    const provider = vi.fn(() => {
      throw new Error('must not run');
    });
    const server = createMobileServer({
      pairing: { sessions: manager },
      bootstrap: { authenticator: { authenticate }, provide: provider },
      logger: false,
    });
    openServers.push(server);

    const [health, pairing, bootstrap, desktop] = await Promise.all([
      server.app.inject({ method: 'GET', url: '/api/mobile/v1/health' }),
      server.app.inject({
        method: 'POST',
        url: MOBILE_PAIRING_START_ROUTE,
        payload: startBody,
      }),
      server.app.inject({ method: 'GET', url: '/api/mobile/v1/bootstrap' }),
      server.app.inject({ method: 'GET', url: '/api/accounts' }),
    ]);

    expect(health.statusCode).toBe(200);
    expect(pairing.statusCode).toBe(202);
    expect(bootstrap.statusCode).toBe(401);
    expect(bootstrap.json().error.code).toBe('authentication_required');
    expect(desktop.statusCode).toBe(404);
    expect(authenticate).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();

    const publicResponses = `${health.body}\n${pairing.body}`;
    for (const forbiddenField of [
      'balance',
      'transaction',
      'accountNumber',
      'budget',
      'netWorth',
    ]) {
      expect(publicResponses).not.toContain(forbiddenField);
    }
  });

  it('collapses wrong-server, unknown-session, and invalid-nonce proof failures safely', async () => {
    const { app, startBody } = createHarness();

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
      expect(response.body).not.toContain(NONCE);
      expect(response.body).not.toContain(OTHER_NONCE);
      expect(response.body).not.toContain('wrong-server');
      expect(response.body).not.toContain('unknown-session');
    }
  });

  it('returns upgrade_required without feature data for an incompatible protocol', async () => {
    const { app, startBody } = createHarness();

    const response = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: { ...startBody, protocolVersion: MOBILE_PROTOCOL_VERSION + 1 },
    });

    expect(response.statusCode).toBe(426);
    expect(response.json()).toEqual(loadPairingFixture('pairing-error-upgrade-required.json'));
    expect(response.json()).not.toHaveProperty('data');
  });

  it('expires the proof at five minutes and never issues a credential', async () => {
    const { app, startBody, advance, issueCredential } = createHarness();
    advance(DEFAULT_PAIRING_EXPIRY_MS);

    const response = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_START_ROUTE,
      payload: startBody,
    });

    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual(loadPairingFixture('pairing-error-expired.json'));
    expect(response.body).not.toContain(NONCE);
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it('surfaces Mac rejection without issuing or echoing a credential', async () => {
    const { app, manager, startBody, issueCredential } = createHarness();
    await app.inject({ method: 'POST', url: MOBILE_PAIRING_START_ROUTE, payload: startBody });
    expect(manager.reject(PAIRING_ID)).toEqual({ status: 'rejected' });

    const status = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_STATUS_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });
    const exchange = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });

    expect(status.statusCode).toBe(403);
    expect(status.json()).toEqual(loadPairingFixture('pairing-error-rejected.json'));
    expect(exchange.statusCode).toBe(403);
    expect(exchange.json().error.code).toBe('pairing_rejected');
    expect(status.body).not.toContain(TOKEN);
    expect(exchange.body).not.toContain(TOKEN);
    expect(issueCredential).not.toHaveBeenCalled();
  });

  it('rate limits after five invalid proof attempts in the session window', async () => {
    const { app, startBody } = createHarness();

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
  });

  it('bounds request bodies and rejects extra or malformed fields before state changes', async () => {
    const { app, manager, startBody } = createHarness();

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
    expect(manager.inspect(PAIRING_ID)?.status).toBe('awaiting_request');

    const missingClaimant = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_STATUS_ROUTE,
      payload: { pairingId: PAIRING_ID },
    });
    expect(missingClaimant.statusCode).toBe(400);
    expect(missingClaimant.json().error.code).toBe('validation_error');
  });

  it('fails closed when an issuer returns an unsafe credential shape', async () => {
    const unsafeSecret = 'FORBIDDEN_PAIRING_SECRET';
    const { app, manager, startBody } = createHarness({
      credential: { ...CREDENTIAL, databasePassword: unsafeSecret },
    });
    await app.inject({ method: 'POST', url: MOBILE_PAIRING_START_ROUTE, payload: startBody });
    manager.approve(PAIRING_ID);

    const response = await app.inject({
      method: 'POST',
      url: MOBILE_PAIRING_EXCHANGE_ROUTE,
      payload: { pairingId: PAIRING_ID, claimantSecret: CLAIMANT_SECRET },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_server_error');
    expect(response.body).not.toContain(unsafeSecret);
    expect(response.body).not.toContain(TOKEN);
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
