import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileServer } from './mobile-server.js';
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
      update?: MobileTransactionRouteDependencies['update'];
      reviewOptions?: MobileTransactionRouteDependencies['reviewOptions'];
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
      transactions: {
        authenticator,
        server: SERVER,
        list,
        detail,
        update: options.update,
        reviewOptions: options.reviewOptions,
      },
      clock: () => NOW,
      logger: false,
    });
    servers.push(server);
    return { ...server, authenticate, list, detail };
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.shutdown()));
  });

  it('requires authentication across transaction routes, validates query input, and returns bound server metadata', async () => {
    const update = vi.fn(() => ({
      ...transaction(),
      owner: { kind: 'unassigned' as const, displayName: null },
    }));
    const reviewOptions = vi.fn(() => ({ categories: ['Dining'], owners: ['Saar'] }));
    const { app, authenticate, list, detail } = makeServer({ update, reviewOptions });

    const unauthenticated = await Promise.all([
      app.inject({ method: 'GET', url: '/api/mobile/v1/transactions' }),
      app.inject({
        method: 'GET',
        url: `/api/mobile/v1/transactions/${project('transaction', 1)}`,
      }),
      app.inject({ method: 'GET', url: '/api/mobile/v1/transactions/review-options' }),
      app.inject({
        method: 'PATCH',
        url: `/api/mobile/v1/transactions/${project('transaction', 1)}`,
        payload: { reviewed: true },
      }),
    ]);
    for (const res of unauthenticated) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('authentication_required');
    }
    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(reviewOptions).not.toHaveBeenCalled();

    const query = new URLSearchParams({
      q: '  Ｍａｒｋｅｔ   רמי ',
      includeExcluded: 'false',
      limit: '20',
    });
    query.append('categories', 'Groceries');
    query.append('categories', 'Dining');
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
        categories: ['Dining', 'Groceries'],
        includeExcluded: false,
        limit: 20,
      },
      { generatedAt: NOW.toISOString(), financialDate: '2026-07-16' },
      DEVICE,
    );
    expect(response.body).not.toContain(TOKEN);
  });

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

  it('exposes only the narrow review options and transaction patch when their providers exist', async () => {
    const update = vi.fn(() => ({
      ...transaction(),
      category: { id: project('category', 3), label: 'Dining' },
      needsReview: false,
      owner: { kind: 'unassigned' as const, displayName: null },
    }));
    const reviewOptions = vi.fn(() => ({
      categories: ['Dining', 'Groceries'],
      owners: ['Saar', 'Shared'],
    }));
    const { app } = makeServer({ update, reviewOptions });

    const optionsResponse = await app.inject({
      method: 'GET',
      url: '/api/mobile/v1/transactions/review-options',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/mobile/v1/transactions/${project('transaction', 1)}`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        category: 'Dining',
        reviewed: true,
        commandId: '11111111-1111-4111-8111-111111111112',
        expectedVersion: 1,
      },
    });

    expect(optionsResponse.statusCode).toBe(200);
    expect(optionsResponse.json().data).toEqual({
      categories: ['Dining', 'Groceries'],
      owners: ['Saar', 'Shared'],
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().data.transaction).toEqual(
      expect.objectContaining({
        category: { id: project('category', 3), label: 'Dining' },
        needsReview: false,
      }),
    );
    expect(update).toHaveBeenCalledWith(
      project('transaction', 1),
      {
        category: 'Dining',
        reviewed: true,
        commandId: '11111111-1111-4111-8111-111111111112',
        expectedVersion: 1,
      },
      { generatedAt: NOW.toISOString(), financialDate: '2026-07-16', clientId: DEVICE.id },
      DEVICE,
    );
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

  it('rejects unsafe provider fields before sending and never echoes the search query', async () => {
    const secretQuery = 'UNIQUE_PRIVATE_QUERY_SENTINEL';
    const server = makeServer({
      list: () => ({
        financialDate: '2026-07-16',
        transactions: [{ ...transaction(), memo: 'PRIVATE_MEMO_SENTINEL' }],
        page: { hasMore: false, nextCursor: null },
      }),
    });
    const response = await server.app.inject({
      method: 'GET',
      url: `/api/mobile/v1/transactions?q=${secretQuery}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('PRIVATE_MEMO_SENTINEL');
    expect(response.body).not.toContain(secretQuery);
  });

  it('rejects unsupported HTTP methods and omits PATCH when no update provider is supplied', async () => {
    const { app, list, detail } = makeServer();
    const detailUrl = `/api/mobile/v1/transactions/${project('transaction', 1)}`;
    const checks: Array<[string, string]> = [
      ['HEAD', '/api/mobile/v1/transactions'],
      ['POST', '/api/mobile/v1/transactions'],
      ['PATCH', '/api/mobile/v1/transactions'],
      ['PUT', '/api/mobile/v1/transactions'],
      ['DELETE', '/api/mobile/v1/transactions'],
      ['HEAD', detailUrl],
      ['POST', detailUrl],
      ['PATCH', detailUrl],
      ['PUT', detailUrl],
      ['DELETE', detailUrl],
    ];
    for (const [method, url] of checks) {
      const response = await app.inject({
        method: method as 'HEAD' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        url,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(response.statusCode).toBe(404);
      if (method !== 'HEAD') {
        expect(response.json().error.code).toBe('route_not_found');
      }
    }
    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });
});
