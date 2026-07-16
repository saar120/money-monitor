import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileServer, type MobileServerErrorEvent } from './mobile-server.js';
import type { MobileAuthenticationResult, PublicMobileDevice } from './device-registry.js';
import type { MobileCredentialAuthenticator } from './mobile-auth.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';
import { MobileTransactionCursorError } from './transaction-cursor.js';
import type { MobileTransactionRouteDependencies } from './transaction-routes.js';

const TOKEN = 'A'.repeat(43);
const NOW = new Date('2026-07-16T08:00:00.000Z');
const SERVER = { id: '11111111-1111-4111-8111-111111111111', protocolVersion: 1 as const };
const project = createMobilePublicIdProjector('production-mobile-public-id-key-32-chars-minimum');
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

function transaction() {
  return {
    id: project('transaction', 1),
    occurredOn: '2026-07-15',
    displayName: 'רמי לוי Market',
    amount: { value: '42.50', currencyCode: 'ILS' },
    direction: 'debit' as const,
    status: 'posted' as const,
    category: null,
    account: {
      id: project('account', 2),
      displayName: 'Primary Account',
      identifierMask: '•••• 3456',
    },
    needsReview: false,
    excludedFromReports: false,
  };
}

describe('protected mobile transaction routes', () => {
  const servers: Array<ReturnType<typeof createMobileServer>> = [];

  function makeServer(
    options: {
      authenticationResult?: MobileAuthenticationResult;
      list?: MobileTransactionRouteDependencies['list'];
      detail?: MobileTransactionRouteDependencies['detail'];
      errorObserver?: (event: Readonly<MobileServerErrorEvent>) => void;
    } = {},
  ) {
    const authenticate = vi.fn(
      () => options.authenticationResult ?? ({ status: 'authenticated', device: DEVICE } as const),
    );
    const authenticator: MobileCredentialAuthenticator = { authenticate };
    const list = vi.fn(
      options.list ??
        (() => ({
          financialDate: '2026-07-16',
          transactions: [transaction()],
          page: { hasMore: false, nextCursor: null },
        })),
    );
    const detail = vi.fn(
      options.detail ??
        (() => ({ ...transaction(), owner: { kind: 'unassigned', displayName: null } })),
    );
    const server = createMobileServer({
      transactions: { authenticator, server: SERVER, list, detail },
      clock: () => NOW,
      errorObserver: options.errorObserver,
      logger: false,
    });
    servers.push(server);
    return { ...server, authenticate, list, detail };
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.shutdown()));
  });

  it('keeps both routes absent until one complete dependency boundary is supplied', async () => {
    const server = createMobileServer({ logger: false });
    servers.push(server);

    for (const url of [
      '/api/mobile/v1/transactions',
      `/api/mobile/v1/transactions/${project('transaction', 1)}`,
    ]) {
      const response = await server.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('route_not_found');
    }
  });

  it('authenticates mobile.read, validates query input, and returns bound server metadata', async () => {
    const { app, authenticate, list } = makeServer();
    const query = new URLSearchParams({
      q: '  Ｍａｒｋｅｔ   רמי ',
      includeExcluded: 'false',
      limit: '20',
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/mobile/v1/transactions?${query.toString()}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      data: {
        financialDate: '2026-07-16',
        transactions: [transaction()],
        page: { hasMore: false, nextCursor: null },
      },
      meta: {
        apiVersion: '1',
        generatedAt: NOW.toISOString(),
        source: 'live',
        server: SERVER,
      },
    });
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.read');
    expect(list).toHaveBeenCalledWith(
      {
        q: 'Market רמי',
        includeExcluded: false,
        limit: 20,
      },
      { generatedAt: NOW.toISOString(), financialDate: '2026-07-16' },
      DEVICE,
    );
    expect(response.body).not.toContain(TOKEN);
  });

  it.each([
    [undefined, { status: 'invalid' } as const, 401, 'authentication_required'],
    ['Basic invalid', { status: 'invalid' } as const, 401, 'authentication_invalid'],
    [
      `Bearer ${TOKEN}`,
      { status: 'expired', deviceId: DEVICE.id } as const,
      401,
      'authentication_expired',
    ],
    [
      `Bearer ${TOKEN}`,
      { status: 'revoked', deviceId: DEVICE.id } as const,
      401,
      'authentication_revoked',
    ],
    [
      `Bearer ${TOKEN}`,
      { status: 'capability_required', deviceId: DEVICE.id } as const,
      403,
      'capability_required',
    ],
  ])(
    'rejects authorization state %# before either transaction provider runs',
    async (authorization, authenticationResult, statusCode, code) => {
      const { app, list, detail } = makeServer({ authenticationResult });
      const headers = authorization ? { authorization } : undefined;
      const [listResponse, detailResponse] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/mobile/v1/transactions', headers }),
        app.inject({
          method: 'GET',
          url: `/api/mobile/v1/transactions/${project('transaction', 1)}`,
          headers,
        }),
      ]);

      expect(listResponse.statusCode).toBe(statusCode);
      expect(detailResponse.statusCode).toBe(statusCode);
      expect(listResponse.json().error.code).toBe(code);
      expect(detailResponse.json().error.code).toBe(code);
      expect(list).not.toHaveBeenCalled();
      expect(detail).not.toHaveBeenCalled();
    },
  );

  it('returns a strict detail envelope and a safe transaction-specific 404', async () => {
    const found = makeServer();
    const foundResponse = await found.app.inject({
      method: 'GET',
      url: `/api/mobile/v1/transactions/${project('transaction', 1)}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(foundResponse.statusCode).toBe(200);
    expect(foundResponse.json().data.transaction.owner).toEqual({
      kind: 'unassigned',
      displayName: null,
    });

    const missingId = project('transaction', 999);
    const missing = makeServer({ detail: () => null });
    const missingResponse = await missing.app.inject({
      method: 'GET',
      url: `/api/mobile/v1/transactions/${missingId}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json().error.code).toBe('transaction_not_found');
    expect(missingResponse.body).not.toContain(missingId);
  });

  it('rejects malformed query and public IDs without invoking providers', async () => {
    const { app, list, detail } = makeServer();
    const [queryResponse, idResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/mobile/v1/transactions?limit=51',
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      app.inject({
        method: 'GET',
        url: '/api/mobile/v1/transactions/42',
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    ]);
    expect(queryResponse.statusCode).toBe(400);
    expect(idResponse.statusCode).toBe(400);
    expect(queryResponse.json().error.code).toBe('validation_error');
    expect(idResponse.json().error.code).toBe('validation_error');
    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });

  it('maps only the typed cursor error to 400 and collapses every other provider error to 500', async () => {
    const cursor = makeServer({
      list: () => {
        throw new MobileTransactionCursorError();
      },
    });
    const cursorResponse = await cursor.app.inject({
      method: 'GET',
      url: '/api/mobile/v1/transactions?cursor=cursor_v1_bad',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(cursorResponse.statusCode).toBe(400);
    expect(cursorResponse.json().error.code).toBe('validation_error');

    const provider = makeServer({
      list: () => {
        throw new Error('PRIVATE_PROVIDER_SENTINEL');
      },
    });
    const providerResponse = await provider.app.inject({
      method: 'GET',
      url: '/api/mobile/v1/transactions',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(providerResponse.statusCode).toBe(500);
    expect(providerResponse.json().error.code).toBe('internal_server_error');
    expect(providerResponse.body).not.toContain('PRIVATE_PROVIDER_SENTINEL');
  });

  it('rejects unsafe provider fields before sending and never records the search query', async () => {
    const events: MobileServerErrorEvent[] = [];
    const secretQuery = 'UNIQUE_PRIVATE_QUERY_SENTINEL';
    const server = makeServer({
      list: () => ({
        financialDate: '2026-07-16',
        transactions: [{ ...transaction(), memo: 'PRIVATE_MEMO_SENTINEL' }],
        page: { hasMore: false, nextCursor: null },
      }),
      errorObserver: (event) => events.push({ ...event }),
    });
    const response = await server.app.inject({
      method: 'GET',
      url: `/api/mobile/v1/transactions?q=${secretQuery}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('PRIVATE_MEMO_SENTINEL');
    expect(response.body).not.toContain(secretQuery);
    expect(events).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/api/mobile/v1/transactions',
        statusCode: 500,
        errorCode: 'internal_server_error',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(secretQuery);
  });

  it.each(['HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'] as const)(
    'does not expose %s list or detail mutations',
    async (method) => {
      const { app, list, detail } = makeServer();
      for (const url of [
        '/api/mobile/v1/transactions',
        `/api/mobile/v1/transactions/${project('transaction', 1)}`,
      ]) {
        const response = await app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(response.statusCode).toBe(404);
        expect(response.json().error.code).toBe('route_not_found');
      }
      expect(list).not.toHaveBeenCalled();
      expect(detail).not.toHaveBeenCalled();
    },
  );

  it('keeps the desktop transaction route absent from the mobile listener', async () => {
    const { app, list, detail } = makeServer();
    const response = await app.inject({
      method: 'GET',
      url: '/api/transactions',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.statusCode).toBe(404);
    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });
});
