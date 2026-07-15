import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import {
  MobileDeviceRegistry,
  type MobileAuthenticationResult,
  type PublicMobileDevice,
} from './device-registry.js';
import type { MobileCredentialAuthenticator } from './mobile-auth.js';
import { createMobileServer, type MobileServerErrorEvent } from './mobile-server.js';
import { MobileApiError } from './contract.js';

const TOKEN = 'A'.repeat(43);
const ROTATED_TOKEN = 'B'.repeat(43);
const FIXTURE_DIRECTORY = join(process.cwd(), 'ios', 'Fixtures', 'MobileBootstrap');
const DEVICE: PublicMobileDevice = {
  id: 'device-test-01',
  name: 'Personal iPhone',
  capabilities: ['mobile.read'],
  protocolVersion: 1,
  tokenVersion: 1,
  createdAt: '2026-07-15T10:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  rotatedAt: null,
  revokedAt: null,
};

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIRECTORY, name), 'utf8')) as unknown;
}

describe('protected mobile bootstrap route', () => {
  const openServers: Array<ReturnType<typeof createMobileServer>> = [];
  const openDatabases: TestDb[] = [];

  function makeServer(
    authenticationResult: MobileAuthenticationResult = {
      status: 'authenticated',
      device: DEVICE,
    },
    provide: (device: PublicMobileDevice) => unknown | Promise<unknown> = () =>
      loadFixture('bootstrap-complete.json'),
    errorObserver?: (event: Readonly<MobileServerErrorEvent>) => void,
  ) {
    const authenticate = vi.fn(() => authenticationResult);
    const authenticator: MobileCredentialAuthenticator = { authenticate };
    const provider = vi.fn(provide);
    const server = createMobileServer({
      bootstrap: { authenticator, provide: provider },
      errorObserver,
      logger: false,
    });
    openServers.push(server);
    return { ...server, authenticate, provider };
  }

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => server.shutdown()));
    openDatabases.splice(0).forEach((database) => database.close());
  });

  it('does not register bootstrap until both dependencies are supplied as one boundary', async () => {
    const server = createMobileServer({ logger: false });
    openServers.push(server);

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('route_not_found');
  });

  it('returns a validated canonical fixture to an authorized mobile.read device', async () => {
    const { app, authenticate, provider } = makeServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(loadFixture('bootstrap-complete.json'));
    expect(authenticate).toHaveBeenCalledOnce();
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.read');
    expect(provider).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledWith(DEVICE);
    expect(response.body).not.toContain(TOKEN);
  });

  it.each([
    [undefined, 'authentication_required'],
    ['Basic invalid', 'authentication_invalid'],
    ['Bearer too-short', 'authentication_invalid'],
  ])(
    'rejects a missing or malformed credential before reading data',
    async (authorization, code) => {
      const { app, authenticate, provider } = makeServer();

      const response = await app.inject({
        method: 'GET',
        url: '/api/mobile/v1/bootstrap',
        headers: authorization === undefined ? undefined : { authorization },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe(code);
      expect(authenticate).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ status: 'invalid' } as const, 401, 'authentication_invalid'],
    [{ status: 'expired', deviceId: DEVICE.id } as const, 401, 'authentication_expired'],
    [{ status: 'revoked', deviceId: DEVICE.id } as const, 401, 'authentication_revoked'],
    [{ status: 'capability_required', deviceId: DEVICE.id } as const, 403, 'capability_required'],
  ])('maps %s to a safe response without invoking the provider', async (result, status, code) => {
    const { app, authenticate, provider } = makeServer(result);

    const response = await app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.read');
    expect(provider).not.toHaveBeenCalled();
    expect(response.body).not.toContain(TOKEN);
  });

  it.each([
    [
      'an invalid redaction fixture',
      (_device: PublicMobileDevice) => loadFixture('bootstrap-forbidden-redaction.json'),
    ],
    [
      'a provider exception',
      (_device: PublicMobileDevice) => Promise.reject(new Error('raw provider secret')),
    ],
  ])('collapses %s to a safe internal error', async (_name, provide) => {
    const { app } = makeServer(undefined, provide);

    const response = await app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_server_error');
    expect(response.body).not.toContain('FORBIDDEN_SECRET_SENTINEL');
    expect(response.body).not.toContain('raw provider secret');
    expect(response.body).not.toContain(TOKEN);
  });

  it('returns the explicit 426 envelope before an incompatible feature payload exists', async () => {
    const { app } = makeServer(undefined, () => {
      throw new MobileApiError('upgrade_required');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(426);
    expect(response.json()).toMatchObject({
      error: {
        code: 'upgrade_required',
        message: 'Update Money Monitor on this iPhone and Mac to continue.',
      },
      meta: { apiVersion: '1' },
    });
    expect(response.json()).not.toHaveProperty('data');
  });

  it('emits only allow-listed metadata when a provider error contains secrets and paths', async () => {
    const events: MobileServerErrorEvent[] = [];
    const { app } = makeServer(
      undefined,
      () => Promise.reject(new Error(`Bearer ${TOKEN} at /Users/private/finance.sqlite`)),
      (event) => events.push({ ...event }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(500);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: 'GET',
      route: '/api/mobile/v1/bootstrap',
      statusCode: 500,
      errorCode: 'internal_server_error',
    });
    expect(Object.keys(events[0]).sort()).toEqual(
      ['requestId', 'method', 'route', 'statusCode', 'errorCode'].sort(),
    );
    const serializedEvent = JSON.stringify(events[0]);
    expect(serializedEvent).not.toContain(TOKEN);
    expect(serializedEvent).not.toContain('/Users/private');
    expect(serializedEvent).not.toContain('finance.sqlite');
  });

  it('honors real registry rotation and revocation on the next request', async () => {
    const testDatabase = createTestDb();
    openDatabases.push(testDatabase);
    const tokens = [TOKEN, ROTATED_TOKEN];
    const registry = new MobileDeviceRegistry(testDatabase.db, {
      tokenFactory: () => tokens.shift() ?? 'C'.repeat(43),
      idFactory: () => 'device-registry-01',
    });
    const credential = registry.issue({ name: 'Personal iPhone' });
    const provider = vi.fn(() => loadFixture('bootstrap-complete.json'));
    const server = createMobileServer({
      bootstrap: { authenticator: registry, provide: provider },
      logger: false,
    });
    openServers.push(server);

    const request = (token: string) =>
      server.app.inject({
        method: 'GET',
        url: '/api/mobile/v1/bootstrap',
        headers: { authorization: `Bearer ${token}` },
      });

    const initial = await request(credential.token);
    expect(initial.statusCode).toBe(200);

    const rotated = registry.rotate(credential.device.id);
    expect(rotated?.token).toBe(ROTATED_TOKEN);
    const [oldCredential, newCredential] = await Promise.all([
      request(credential.token),
      request(ROTATED_TOKEN),
    ]);
    expect(oldCredential.statusCode).toBe(401);
    expect(oldCredential.json().error.code).toBe('authentication_invalid');
    expect(newCredential.statusCode).toBe(200);

    expect(registry.revoke(credential.device.id)).toBe(true);
    const revoked = await request(ROTATED_TOKEN);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe('authentication_revoked');
    expect(provider).toHaveBeenCalledTimes(2);
    expect(
      [initial.body, oldCredential.body, newCredential.body, revoked.body].join(),
    ).not.toContain(TOKEN);
  });

  it.each(['/api/accounts', '/api/settings', '/api/scrape', '/api/ai/chat', '/'])(
    'keeps desktop route %s absent even for an authenticated mobile device',
    async (url) => {
      const { app, authenticate, provider } = makeServer();

      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('route_not_found');
      expect(authenticate).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    },
  );

  it.each(['HEAD', 'POST'] as const)('does not expose %s for bootstrap', async (method) => {
    const { app, authenticate, provider } = makeServer();

    const response = await app.inject({
      method,
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('route_not_found');
    expect(authenticate).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
});
