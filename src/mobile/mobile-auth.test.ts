import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthenticationResult } from './device-registry.js';
import {
  createMobileAuthenticationHook,
  type MobileCredentialAuthenticator,
} from './mobile-auth.js';

const TOKEN = 'A'.repeat(43);
const DEVICE = {
  id: 'device-1',
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

describe('mobile authentication hook', () => {
  const openApps: ReturnType<typeof Fastify>[] = [];

  function createProtectedApp(result: MobileAuthenticationResult) {
    const authenticate = vi.fn(() => result);
    const authenticator: MobileCredentialAuthenticator = { authenticate };
    const app = Fastify({ logger: false });
    openApps.push(app);
    app.get(
      '/protected',
      { onRequest: createMobileAuthenticationHook(authenticator, 'mobile.read') },
      async (request) => ({ deviceId: request.mobileDevice?.id }),
    );
    return { app, authenticate };
  }

  afterEach(async () => {
    await Promise.all(openApps.splice(0).map((app) => app.close()));
  });

  it('requires a credential without invoking the registry', async () => {
    const { app, authenticate } = createProtectedApp({ status: 'invalid' });

    const response = await app.inject({ method: 'GET', url: '/protected' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('authentication_required');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each(['Basic abc', 'Bearer too-short', `Bearer ${TOKEN} extra`, `Bearer  ${TOKEN}`])(
    'rejects malformed authorization header %s',
    async (authorization) => {
      const { app, authenticate } = createProtectedApp({ status: 'invalid' });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('authentication_invalid');
      expect(authenticate).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ status: 'invalid' } as const, 401, 'authentication_invalid'],
    [{ status: 'expired', deviceId: 'device-1' } as const, 401, 'authentication_expired'],
    [{ status: 'revoked', deviceId: 'device-1' } as const, 401, 'authentication_revoked'],
    [{ status: 'capability_required', deviceId: 'device-1' } as const, 403, 'capability_required'],
  ])('maps registry result %# to a safe response', async (result, statusCode, errorCode) => {
    const { app, authenticate } = createProtectedApp(result);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(statusCode);
    expect(response.json().error.code).toBe(errorCode);
    expect(response.body).not.toContain(TOKEN);
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.read');
  });

  it('attaches the public device only after successful scoped authentication', async () => {
    const { app, authenticate } = createProtectedApp({
      status: 'authenticated',
      device: DEVICE,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deviceId: DEVICE.id });
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.read');
    expect(response.body).not.toContain(TOKEN);
  });
});
