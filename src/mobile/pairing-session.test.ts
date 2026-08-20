import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APPROVAL_TIMEOUT_MS,
  DEFAULT_PAIRING_EXPIRY_MS,
  MobilePairingSessionManager,
  PAIRING_INVALID_ATTEMPT_LIMIT,
  PAIRING_INVALID_ATTEMPT_WINDOW_MS,
  type PairingRequestInput,
} from './pairing-session.js';

const START_MS = Date.parse('2026-07-15T10:00:00.000Z');
const PAIRING_ID = 'pairing-1';
const NONCE = 'N'.repeat(43);
const OTHER_NONCE = 'X'.repeat(43);
const CLAIMANT_SECRET = 'C'.repeat(43);
const OTHER_CLAIMANT_SECRET = 'Q'.repeat(43);
const SERVER_ID_INPUT = '11111111-1111-4111-8111-AAAAAAAAAAAA';
const SERVER_ID = SERVER_ID_INPUT.toLowerCase();
const BASE_URL = 'https://money-monitor.tailnet.ts.net:8443/money-monitor';
const PROTOCOL_VERSION = 1;
const DEVICE_TOKEN = 'T'.repeat(43);

interface TestCredential {
  deviceId: string;
  token: string;
}

function createHarness() {
  let nowMs = START_MS;
  const credentialIssuer = vi.fn(
    (): TestCredential => ({
      deviceId: 'device-1',
      token: DEVICE_TOKEN,
    }),
  );
  const manager = new MobilePairingSessionManager<TestCredential>({
    serverId: SERVER_ID_INPUT,
    baseURL: BASE_URL,
    protocolVersion: PROTOCOL_VERSION,
    credentialIssuer,
    clock: () => new Date(nowMs),
    idFactory: () => PAIRING_ID,
    nonceFactory: () => NONCE,
    claimantSecretFactory: () => CLAIMANT_SECRET,
  });

  const validRequest: PairingRequestInput = {
    pairingId: PAIRING_ID,
    nonce: NONCE,
    serverId: SERVER_ID_INPUT,
    protocolVersion: PROTOCOL_VERSION,
    deviceName: '  Saar’s   iPhone  ',
  };

  return {
    manager,
    validRequest,
    credentialIssuer,
    advance(ms: number) {
      nowMs += ms;
    },
  };
}

describe('MobilePairingSessionManager', () => {
  it('completes request, explicit approval, and claimant-bound credential claim', () => {
    const { manager, validRequest, credentialIssuer } = createHarness();

    const created = manager.create();
    expect(created).toEqual({
      status: 'created',
      qrPayload: {
        kind: 'money-monitor-pairing',
        version: 1,
        pairingId: PAIRING_ID,
        nonce: NONCE,
        serverId: SERVER_ID,
        baseURL: BASE_URL,
        protocolVersion: PROTOCOL_VERSION,
        expiresAt: new Date(START_MS + DEFAULT_PAIRING_EXPIRY_MS).toISOString(),
      },
    });

    expect(manager.request(validRequest)).toEqual({
      status: 'pending_approval',
      claimantSecret: CLAIMANT_SECRET,
      request: {
        pairingId: PAIRING_ID,
        deviceName: 'Saar’s iPhone',
        requestedAt: new Date(START_MS).toISOString(),
        expiresAt: new Date(START_MS + DEFAULT_APPROVAL_TIMEOUT_MS).toISOString(),
      },
    });
    expect(credentialIssuer).not.toHaveBeenCalled();
    expect(manager.approve(PAIRING_ID)).toEqual({ status: 'approved' });

    expect(manager.claim(PAIRING_ID, CLAIMANT_SECRET)).toEqual({
      status: 'claimed',
      credential: { deviceId: 'device-1', token: DEVICE_TOKEN },
      isRetry: false,
    });
    expect(credentialIssuer).toHaveBeenCalledOnce();
    expect(credentialIssuer).toHaveBeenCalledWith({
      pairingId: PAIRING_ID,
      deviceName: 'Saar’s iPhone',
      serverId: SERVER_ID,
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it('never issues a credential before explicit approval', () => {
    const { manager, validRequest, credentialIssuer } = createHarness();
    manager.create();

    expect(manager.approve(PAIRING_ID)).toEqual({ status: 'approval_required' });
    expect(manager.request(validRequest).status).toBe('pending_approval');
    expect(manager.claim(PAIRING_ID, CLAIMANT_SECRET)).toEqual({
      status: 'approval_required',
    });
    expect(credentialIssuer).not.toHaveBeenCalled();
  });

  it('rejects an invalid nonce using a fixed, secret-free result', () => {
    const { manager, validRequest } = createHarness();
    manager.create();

    expect(manager.request({ ...validRequest, nonce: OTHER_NONCE })).toEqual({
      status: 'invalid_nonce',
    });
    expect(manager.inspect(PAIRING_ID)?.status).toBe('awaiting_request');
  });

  it('expires an unused QR after five minutes', () => {
    const { manager, validRequest, advance } = createHarness();
    manager.create();
    advance(DEFAULT_PAIRING_EXPIRY_MS);

    expect(manager.request(validRequest)).toEqual({ status: 'pairing_expired' });
    expect(manager.inspect(PAIRING_ID)?.status).toBe('expired');
  });

  it('expires a pending approval after five minutes', () => {
    const { manager, validRequest, advance } = createHarness();
    manager.create();
    const requested = manager.request(validRequest);
    expect(requested.status).toBe('pending_approval');
    advance(DEFAULT_APPROVAL_TIMEOUT_MS);

    expect(manager.approve(PAIRING_ID)).toEqual({ status: 'pairing_expired' });
    expect(manager.claim(PAIRING_ID, CLAIMANT_SECRET)).toEqual({ status: 'pairing_expired' });
  });

  it('makes rejection terminal and never invokes the credential issuer', () => {
    const { manager, validRequest, credentialIssuer } = createHarness();
    manager.create();
    manager.request(validRequest);

    expect(manager.reject(PAIRING_ID)).toEqual({ status: 'rejected' });
    expect(manager.claim(PAIRING_ID, CLAIMANT_SECRET)).toEqual({ status: 'pairing_rejected' });
    expect(manager.approve(PAIRING_ID)).toEqual({ status: 'pairing_rejected' });
    expect(credentialIssuer).not.toHaveBeenCalled();
  });

  it('returns the exact same credential on a claimant retry and calls the issuer only once', () => {
    const { manager, validRequest, credentialIssuer } = createHarness();
    manager.create();
    manager.request(validRequest);
    manager.approve(PAIRING_ID);

    const first = manager.claim(PAIRING_ID, CLAIMANT_SECRET);
    expect(first).toEqual({
      status: 'claimed',
      credential: { deviceId: 'device-1', token: DEVICE_TOKEN },
      isRetry: false,
    });
    const replay = manager.claim(PAIRING_ID, CLAIMANT_SECRET);
    expect(replay).toEqual({
      status: 'claimed',
      credential: { deviceId: 'device-1', token: DEVICE_TOKEN },
      isRetry: true,
    });
    expect(credentialIssuer).toHaveBeenCalledOnce();
  });

  it('keeps a trusted replacement binding server-side until credential issuance', () => {
    const { manager, validRequest, credentialIssuer } = createHarness();

    const created = manager.create({ replacementDeviceId: 'device-1' });
    expect(created.qrPayload).not.toHaveProperty('replacementDeviceId');
    expect(JSON.stringify(manager.inspect(PAIRING_ID))).not.toContain('device-1');

    manager.request(validRequest);
    manager.approve(PAIRING_ID);
    expect(manager.claim(PAIRING_ID, CLAIMANT_SECRET).status).toBe('claimed');
    expect(credentialIssuer).toHaveBeenCalledWith({
      pairingId: PAIRING_ID,
      deviceName: 'Saar’s iPhone',
      serverId: SERVER_ID,
      protocolVersion: PROTOCOL_VERSION,
      replacementDeviceId: 'device-1',
    });
    expect(JSON.stringify(manager.inspectAll())).not.toContain('device-1');
  });

  it('rejects an unsafe replacement binding before creating pairing state', () => {
    const { manager } = createHarness();

    expect(() => manager.create({ replacementDeviceId: '../device-1' })).toThrow(
      'valid opaque identifier',
    );
    expect(manager.inspectAll()).toEqual([]);
  });

  it('rejects incompatible server and protocol values without consuming the session', () => {
    const { manager, validRequest } = createHarness();
    manager.create();

    expect(
      manager.request({
        ...validRequest,
        serverId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toEqual({
      status: 'server_mismatch',
    });
    expect(manager.request({ ...validRequest, protocolVersion: 2 })).toEqual({
      status: 'incompatible_protocol',
    });
    expect(manager.request(validRequest).status).toBe('pending_approval');
  });

  it('normalizes and validates device names before creating approval state', () => {
    const { manager, validRequest } = createHarness();
    manager.create();

    expect(manager.request({ ...validRequest, deviceName: '   ' })).toEqual({
      status: 'invalid_device_name',
    });
    expect(manager.request({ ...validRequest, deviceName: 'x'.repeat(81) })).toEqual({
      status: 'invalid_device_name',
    });
    expect(manager.request(validRequest)).toMatchObject({
      status: 'pending_approval',
      request: { deviceName: 'Saar’s iPhone' },
    });
  });

  it('rate limits after five invalid attempts in sixty seconds and resets the window', () => {
    const { manager, validRequest, advance } = createHarness();
    manager.create();

    for (let attempt = 0; attempt < PAIRING_INVALID_ATTEMPT_LIMIT; attempt += 1) {
      expect(manager.request({ ...validRequest, nonce: OTHER_NONCE })).toEqual({
        status: 'invalid_nonce',
      });
    }
    expect(manager.request(validRequest)).toEqual({ status: 'rate_limited' });

    advance(PAIRING_INVALID_ATTEMPT_WINDOW_MS + 1);
    expect(manager.request(validRequest).status).toBe('pending_approval');
  });

  it('binds polling and exchange to the post-scan claimant secret', () => {
    const { manager, validRequest, credentialIssuer } = createHarness();
    manager.create();
    const requested = manager.request(validRequest);
    expect(requested.status).toBe('pending_approval');

    expect(manager.poll(PAIRING_ID, NONCE)).toEqual({ status: 'invalid_claimant' });
    expect(manager.poll(PAIRING_ID, OTHER_CLAIMANT_SECRET)).toEqual({
      status: 'invalid_claimant',
    });
    expect(manager.claim(PAIRING_ID, NONCE)).toEqual({ status: 'invalid_claimant' });
    expect(manager.claim(PAIRING_ID, OTHER_CLAIMANT_SECRET)).toEqual({
      status: 'invalid_claimant',
    });
    expect(manager.poll(PAIRING_ID, CLAIMANT_SECRET)).toMatchObject({
      status: 'available',
      snapshot: { status: 'pending_approval' },
    });
    expect(credentialIssuer).not.toHaveBeenCalled();
  });

  it('canonicalizes the server UUID in the QR, snapshot, and issuer request', () => {
    const { manager, validRequest, credentialIssuer } = createHarness();
    expect(manager.create().qrPayload.serverId).toBe(SERVER_ID);
    manager.request(validRequest);
    expect(manager.inspect(PAIRING_ID)?.serverId).toBe(SERVER_ID);
    manager.approve(PAIRING_ID);
    manager.claim(PAIRING_ID, CLAIMANT_SECRET);
    expect(credentialIssuer).toHaveBeenCalledWith(expect.objectContaining({ serverId: SERVER_ID }));
  });

  it('never exposes raw pairing proofs or claimed credentials in public inspection', () => {
    const { manager, validRequest } = createHarness();
    const { qrPayload } = manager.create();

    const beforeRequest = JSON.stringify(manager.inspect(PAIRING_ID));
    const internalSessions = Reflect.get(manager, 'sessions') as Map<string, unknown>;
    expect(beforeRequest).not.toContain(qrPayload.nonce);
    expect(beforeRequest).not.toContain('nonce');
    expect(JSON.stringify([...internalSessions.entries()])).not.toContain(qrPayload.nonce);

    manager.request(validRequest);
    manager.approve(PAIRING_ID);
    expect(manager.claim(PAIRING_ID, CLAIMANT_SECRET).status).toBe('claimed');

    const publicInspection = JSON.stringify(manager.inspectAll());
    expect(publicInspection).not.toContain(DEVICE_TOKEN);
    expect(publicInspection).not.toContain('credential');
    expect(publicInspection).not.toContain('nonce');
    expect(publicInspection).not.toContain(CLAIMANT_SECRET);
  });

  it('creates independent 256-bit QR and claimant secrets with cryptographic defaults', () => {
    const manager = new MobilePairingSessionManager({
      serverId: SERVER_ID,
      baseURL: BASE_URL,
      protocolVersion: PROTOCOL_VERSION,
      credentialIssuer: () => ({}),
    });

    const nonce = manager.create().qrPayload.nonce;
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(nonce, 'base64url')).toHaveLength(32);
    const requested = manager.request({
      pairingId: manager.inspectAll()[0]!.pairingId,
      nonce,
      serverId: SERVER_ID,
      protocolVersion: PROTOCOL_VERSION,
      deviceName: 'iPhone',
    });
    expect(requested.status).toBe('pending_approval');
    if (requested.status !== 'pending_approval') throw new Error('unreachable');
    expect(requested.claimantSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(requested.claimantSecret, 'base64url')).toHaveLength(32);
    expect(requested.claimantSecret).not.toBe(nonce);
  });

  it('loses memory-only sessions across a manager restart', () => {
    const first = createHarness();
    first.manager.create();
    first.manager.request(first.validRequest);
    first.manager.approve(PAIRING_ID);

    const restarted = createHarness();
    expect(restarted.manager.claim(PAIRING_ID, CLAIMANT_SECRET)).toEqual({
      status: 'pairing_not_found',
    });
    expect(restarted.credentialIssuer).not.toHaveBeenCalled();
  });

  it('fails closed if credential issuance throws and never retries the issuer', () => {
    let calls = 0;
    const manager = new MobilePairingSessionManager<TestCredential>({
      serverId: SERVER_ID,
      baseURL: BASE_URL,
      protocolVersion: PROTOCOL_VERSION,
      credentialIssuer: () => {
        calls += 1;
        throw new Error('sensitive database detail');
      },
      clock: () => new Date(START_MS),
      idFactory: () => PAIRING_ID,
      nonceFactory: () => NONCE,
      claimantSecretFactory: () => CLAIMANT_SECRET,
    });
    manager.create();
    manager.request({
      pairingId: PAIRING_ID,
      nonce: NONCE,
      serverId: SERVER_ID,
      protocolVersion: PROTOCOL_VERSION,
      deviceName: 'iPhone',
    });
    manager.approve(PAIRING_ID);

    expect(manager.claim(PAIRING_ID, CLAIMANT_SECRET)).toEqual({
      status: 'credential_issue_failed',
    });
    expect(manager.claim(PAIRING_ID, CLAIMANT_SECRET)).toEqual({
      status: 'credential_issue_failed',
    });
    expect(calls).toBe(1);
    expect(JSON.stringify(manager.inspect(PAIRING_ID))).not.toContain('sensitive database detail');
  });

  it('validates injected nonce strength and constructor identity settings', () => {
    const weakNonceManager = new MobilePairingSessionManager({
      serverId: SERVER_ID,
      baseURL: BASE_URL,
      protocolVersion: PROTOCOL_VERSION,
      credentialIssuer: () => ({}),
      nonceFactory: () => 'weak',
    });
    expect(() => weakNonceManager.create()).toThrow('256-bit base64url nonce');

    const weakClaimantManager = new MobilePairingSessionManager({
      serverId: SERVER_ID,
      baseURL: BASE_URL,
      protocolVersion: PROTOCOL_VERSION,
      credentialIssuer: () => ({}),
      idFactory: () => PAIRING_ID,
      nonceFactory: () => NONCE,
      claimantSecretFactory: () => 'weak',
    });
    weakClaimantManager.create();
    expect(() =>
      weakClaimantManager.request({
        pairingId: PAIRING_ID,
        nonce: NONCE,
        serverId: SERVER_ID,
        protocolVersion: PROTOCOL_VERSION,
        deviceName: 'iPhone',
      }),
    ).toThrow('256-bit base64url secret');

    expect(
      () =>
        new MobilePairingSessionManager({
          serverId: SERVER_ID,
          baseURL: 'http://localhost:3000',
          protocolVersion: PROTOCOL_VERSION,
          credentialIssuer: () => ({}),
        }),
    ).toThrow('must be HTTPS');

    expect(
      () =>
        new MobilePairingSessionManager({
          serverId: 'not-a-uuid',
          baseURL: BASE_URL,
          protocolVersion: PROTOCOL_VERSION,
          credentialIssuer: () => ({}),
        }),
    ).toThrow('stable UUID');
  });
});
