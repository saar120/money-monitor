import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileServer } from './mobile-server.js';
import type { PublicMobileDevice } from './device-registry.js';
import type { MobileCredentialAuthenticator } from './mobile-auth.js';

const TOKEN = 'A'.repeat(43);
const NOW = new Date('2026-07-16T08:00:00.000Z');
const SERVER = { id: '11111111-1111-4111-8111-111111111111', protocolVersion: 1 as const };
const DEVICE: PublicMobileDevice = { id: 'device-1', name: 'iPhone', capabilities: ['mobile.read'], protocolVersion: 1, tokenVersion: 1, createdAt: NOW.toISOString(), lastUsedAt: null, expiresAt: null, rotatedAt: null, revokedAt: null };

function history() {
  const money = (value: string) => ({ value, currencyCode: 'ILS' as const });
  return {
    financialDate: '2026-07-16', range: '3M' as const,
    period: { startDate: '2026-04-16', endDate: '2026-07-16' }, baseCurrencyCode: 'ILS' as const,
    estimatedHistory: true as const, estimationMethod: 'latest_known_values_carried_forward' as const,
    points: [
      { date: '2026-04-16', total: money('90'), assetsTotal: money('50'), liabilitiesTotal: money('10'), bankBalancesTotal: money('50') },
      { date: '2026-07-16', total: money('100'), assetsTotal: money('55'), liabilitiesTotal: money('10'), bankBalancesTotal: money('55') },
    ],
  };
}

describe('mobile net-worth history route', () => {
  const servers: Array<ReturnType<typeof createMobileServer>> = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.shutdown())); });

  it('authenticates mobile.read and returns an aggregate-only estimated ILS series', async () => {
    const authenticate = vi.fn(() => ({ status: 'authenticated', device: DEVICE } as const));
    const read = vi.fn(() => history());
    const server = createMobileServer({ netWorthHistory: { authenticator: { authenticate } satisfies MobileCredentialAuthenticator, server: SERVER, read }, clock: () => NOW, logger: false });
    servers.push(server);

    const response = await server.app.inject({ method: 'GET', url: '/api/mobile/v1/net-worth/history?range=3M', headers: { authorization: `Bearer ${TOKEN}` } });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ data: history(), meta: { apiVersion: '1', generatedAt: NOW.toISOString(), source: 'live', server: SERVER } });
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.read');
    expect(read).toHaveBeenCalledWith({ range: '3M' }, { generatedAt: NOW.toISOString(), financialDate: '2026-07-16' }, DEVICE);
  });

  it('rejects omitted, unknown, and unallowlisted range input before reading', async () => {
    const read = vi.fn(() => history());
    const server = createMobileServer({ netWorthHistory: { authenticator: { authenticate: () => ({ status: 'authenticated', device: DEVICE } as const) }, server: SERVER, read }, clock: () => NOW, logger: false });
    servers.push(server);

    for (const url of ['/api/mobile/v1/net-worth/history', '/api/mobile/v1/net-worth/history?range=2Y', '/api/mobile/v1/net-worth/history?range=3M&currency=USD']) {
      const response = await server.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${TOKEN}` } });
      expect(response.statusCode).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('fails closed instead of serializing unsafe provider fields', async () => {
    const unsafe = { ...history(), accountNumber: '123456789' };
    const server = createMobileServer({ netWorthHistory: { authenticator: { authenticate: () => ({ status: 'authenticated', device: DEVICE } as const) }, server: SERVER, read: () => unsafe }, clock: () => NOW, logger: false });
    servers.push(server);

    const response = await server.app.inject({ method: 'GET', url: '/api/mobile/v1/net-worth/history?range=3M', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('123456789');
  });
});
