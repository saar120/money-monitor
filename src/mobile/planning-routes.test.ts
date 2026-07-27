import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileServer } from './mobile-server.js';
import type { PublicMobileDevice } from './device-registry.js';
import type { MobileCredentialAuthenticator } from './mobile-auth.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';

const TOKEN = 'A'.repeat(43);
const NOW = new Date('2026-07-16T08:00:00.000Z');
const SERVER = { id: '11111111-1111-4111-8111-111111111111', protocolVersion: 1 as const };
const project = createMobilePublicIdProjector('production-mobile-public-id-key-32-chars-minimum');
const DEVICE: PublicMobileDevice = { id: 'device-1', name: 'iPhone', capabilities: ['mobile.read'], protocolVersion: 1, tokenVersion: 1, createdAt: NOW.toISOString(), lastUsedAt: null, expiresAt: null, rotatedAt: null, revokedAt: null };

function snapshot() {
  return {
    financialDate: '2026-07-16', calculatedAt: NOW.toISOString(), baseCurrencyCode: 'ILS', budgets: [],
    netWorth: { state: 'available', total: { value: '100.00', currencyCode: 'ILS' }, assetsTotal: { value: '100.00', currencyCode: 'ILS' }, liabilitiesTotal: { value: '0', currencyCode: 'ILS' }, bankBalancesTotal: { value: '100.00', currencyCode: 'ILS' } },
    accounts: [{ id: project('account', 1), institutionName: 'Bank Hapoalim', displayName: 'Main', type: 'bank', identifierMask: '•••• 1234', currencyCode: 'ILS', state: 'active', freshness: { status: 'current', lastSuccessfulSyncAt: NOW.toISOString() }, balance: { value: '100.00', currencyCode: 'ILS' } }],
    assets: [{ id: project('asset', 1), displayName: 'Savings', type: 'cash', liquidity: 'liquid', currentValue: { value: '0', currencyCode: 'ILS' }, state: 'available' }],
    latestSync: { state: 'completed', startedAt: NOW.toISOString(), completedAt: NOW.toISOString(), accountsSucceeded: 1, accountsAttentionNeeded: 0 },
  };
}

describe('mobile planning route', () => {
  const servers: Array<ReturnType<typeof createMobileServer>> = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.shutdown())); });

  it('is authenticated, no-store, and projects only a strict safe snapshot', async () => {
    const authenticate = vi.fn(() => ({ status: 'authenticated', device: DEVICE } as const));
    const read = vi.fn(() => snapshot());
    const server = createMobileServer({ planning: { authenticator: { authenticate } satisfies MobileCredentialAuthenticator, server: SERVER, read }, clock: () => NOW, logger: false });
    servers.push(server);

    const response = await server.app.inject({ method: 'GET', url: '/api/mobile/v1/planning', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ data: snapshot(), meta: { apiVersion: '1', generatedAt: NOW.toISOString(), source: 'live', server: SERVER } });
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.read');
    expect(read).toHaveBeenCalledWith({ generatedAt: NOW.toISOString(), financialDate: '2026-07-16' }, DEVICE);
  });

  it('fails closed for unmasked account data or a credit-card balance', async () => {
    const authenticate = vi.fn(() => ({ status: 'authenticated', device: DEVICE } as const));
    const unsafe = snapshot();
    unsafe.accounts[0].identifierMask = '123456789';
    const server = createMobileServer({ planning: { authenticator: { authenticate } satisfies MobileCredentialAuthenticator, server: SERVER, read: () => unsafe }, clock: () => NOW, logger: false });
    servers.push(server);

    const response = await server.app.inject({ method: 'GET', url: '/api/mobile/v1/planning', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('123456789');
  });
});
