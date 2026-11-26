import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import {
  createMobileBootstrapAdapter,
  MobileBootstrapSectionReadError,
  type MobileBootstrapReadPorts,
  type MobileRecentTransactionReadModel,
} from './bootstrap-adapter.js';
import {
  MobileDeviceRegistry,
  type MobileAuthenticationResult,
  type PublicMobileDevice,
} from './device-registry.js';
import type { MobileCredentialAuthenticator } from './mobile-auth.js';
import { createMobileServer } from './mobile-server.js';
import { MobileApiError } from './contract.js';

const TOKEN = 'A'.repeat(43);
const CALCULATED_AT = '2026-07-15T10:00:00.000Z';
const GENERATED_AT = '2026-07-15T10:00:01.000Z';
const FIXTURE_DIRECTORY = join(process.cwd(), 'src', 'mobile', 'fixtures', 'bootstrap');
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

function money(value: string) {
  return { value, currencyCode: 'ILS' };
}

function aggregate(value: string, startDate = '2026-07-01') {
  return {
    amount: money(value),
    period: { startDate, endDate: '2026-07-15' },
    comparisonPeriod: null,
  };
}

function transaction(index = 1): MobileRecentTransactionReadModel {
  return {
    publicId: `transaction_${String(index).padStart(2, '0')}`,
    occurredOn: '2026-07-15',
    displayName: 'Neighborhood Market',
    amount: money('245.9000'),
    direction: 'debit',
    status: 'posted',
    category: { publicId: 'category_food_01', label: 'Groceries' },
    account: {
      publicId: 'account_checking_01',
      displayName: 'Everyday Checking',
      identifierMask: '•••• 4321',
    },
  };
}

function makePorts(): MobileBootstrapReadPorts {
  return {
    readHome: vi.fn(() => ({
      primaryCurrencyCode: 'ILS',
      netWorth: aggregate('128430.2700', '2026-07-15'),
      income: aggregate('12500.00'),
      spending: aggregate('4560.30'),
    })),
    readBudgetPulse: vi.fn(() => ({
      status: 'on_track' as const,
      spent: money('4560.30'),
      limit: money('9000.00'),
      remaining: money('4439.70'),
      period: { startDate: '2026-07-01', endDate: '2026-07-15' },
    })),
    readReview: vi.fn(() => ({ count: 3 })),
    readRecentTransactions: vi.fn(() => [transaction()]),
    readAccounts: vi.fn(() => [
      {
        publicId: 'account_checking_01',
        displayName: 'Everyday Checking',
        institutionName: 'Example Bank',
        type: 'checking' as const,
        currencyCode: 'ILS',
        identifierMask: '•••• 4321',
        freshness: {
          status: 'fresh' as const,
          lastSuccessfulSyncAt: '2026-07-15T09:58:00.000Z',
        },
      },
    ]),
    readLatestSync: vi.fn(() => ({
      status: 'succeeded' as const,
      startedAt: '2026-07-15T09:56:00.000Z',
      completedAt: '2026-07-15T09:58:00.000Z',
      accountsSucceeded: 1,
      accountsFailed: 0,
    })),
  };
}

function makeAdapter(ports = makePorts()) {
  const instants = [new Date(CALCULATED_AT), new Date(GENERATED_AT)];
  return createMobileBootstrapAdapter({
    ports,
    server: {
      id: '11111111-1111-4111-8111-111111111111',
      displayName: 'Saar’s Mac',
      serverVersion: '0.3.5',
      minimumClientVersion: '0.1.0',
    },
    fallbackCurrencyCode: 'ILS',
    clock: () => instants.shift() ?? new Date(GENERATED_AT),
  });
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
  ) {
    const authenticate = vi.fn(() => authenticationResult);
    const authenticator: MobileCredentialAuthenticator = { authenticate };
    const provider = vi.fn(provide);
    const server = createMobileServer({
      bootstrap: { authenticator, provide: provider },
      logger: false,
    });
    openServers.push(server);
    return { ...server, authenticate, provider };
  }

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => server.shutdown()));
    openDatabases.splice(0).forEach((database) => database.close());
  });

  it('requires mobile.read auth and serves a coherent adapter-backed bootstrap envelope', async () => {
    const ports = makePorts();
    const { app, authenticate, provider } = makeServer(undefined, makeAdapter(ports));

    const unauthorized = await app.inject({ method: 'GET', url: '/api/mobile/v1/bootstrap' });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.code).toBe('authentication_required');
    expect(provider).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta).toMatchObject({
      apiVersion: '1',
      generatedAt: GENERATED_AT,
      calculatedAt: CALCULATED_AT,
      financialDate: '2026-07-15',
      source: 'live',
      bootstrapSchemaVersion: 1,
      server: {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Saar’s Mac',
        serverVersion: '0.3.5',
        protocolVersion: 1,
        minimumClientVersion: '0.1.0',
        capabilities: ['mobile.read'],
        compatibility: { status: 'not_evaluated', reason: null },
      },
      cacheability: {
        status: 'cacheable',
        maxAgeSeconds: 300,
        staleAt: '2026-07-16T10:00:00.000Z',
        deleteAfter: '2026-07-22T10:00:00.000Z',
      },
      completeness: { status: 'complete', sectionErrors: [] },
    });
    expect(body.data.home.aggregates.netWorth.calculatedAt).toBe(CALCULATED_AT);
    expect(body.data.budgetPulse.calculatedAt).toBe(CALCULATED_AT);
    expect(body.data.review.calculatedAt).toBe(CALCULATED_AT);
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.read');
    expect(provider).toHaveBeenCalledWith(DEVICE);
    expect(response.body).not.toContain(TOKEN);
  });

  it('degrades failed sections safely, strips non-allowlisted fields, and caps recent transactions at 20', async () => {
    const degradedPorts = makePorts();
    degradedPorts.readBudgetPulse = vi.fn(() => {
      throw new MobileBootstrapSectionReadError('calculation_failed', true);
    });
    degradedPorts.readRecentTransactions = vi.fn(() => {
      throw new Error('Bearer secret-token at /Users/private/finance.sqlite');
    });
    const degradedServer = makeServer(undefined, makeAdapter(degradedPorts));
    const degraded = await degradedServer.app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(degraded.statusCode).toBe(200);
    expect(degraded.json().meta.cacheability).toEqual({
      status: 'not_cacheable',
      maxAgeSeconds: 0,
    });
    expect(degraded.json().meta.completeness).toEqual({
      status: 'partial',
      sectionErrors: [
        { section: 'budget_pulse', code: 'calculation_failed', retryable: true },
        { section: 'recent_transactions', code: 'unknown', retryable: true },
      ],
    });
    expect(degraded.json().data.budgetPulse).toMatchObject({
      status: 'unavailable',
      spent: null,
      limit: null,
      remaining: null,
    });
    expect(degraded.json().data.recentTransactions).toEqual([]);
    expect(degraded.body).not.toContain('secret-token');
    expect(degraded.body).not.toContain('/Users/private');

    const cappedPorts = makePorts();
    cappedPorts.readRecentTransactions = vi.fn(() =>
      Array.from({ length: 25 }, (_, index) => ({
        ...transaction(index + 1),
        databaseId: 42,
        accountNumber: '1234567890123456',
        credential: 'Bearer should-never-leave-the-port',
        rawRow: { private: true },
      })),
    );
    const cappedServer = makeServer(undefined, makeAdapter(cappedPorts));
    const capped = await cappedServer.app.inject({
      method: 'GET',
      url: '/api/mobile/v1/bootstrap',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(capped.statusCode).toBe(200);
    expect(capped.json().data.recentTransactions).toHaveLength(20);
    expect(capped.json().data.recentTransactions.at(-1)?.id).toBe('transaction_20');
    for (const forbidden of [
      'databaseId',
      'accountNumber',
      'credential',
      'rawRow',
      '1234567890123456',
    ]) {
      expect(capped.body).not.toContain(forbidden);
    }
  });

  it.each([
    ['an invalid redaction fixture', () => loadFixture('bootstrap-forbidden-redaction.json')],
    ['a provider exception', () => Promise.reject(new Error('raw provider secret'))],
    [
      'a numeric port identifier',
      () => {
        const ports = makePorts();
        ports.readRecentTransactions = vi.fn(() => [{ ...transaction(), publicId: '42' }]);
        return makeAdapter(ports)();
      },
    ],
    [
      'non-canonical port money',
      () => {
        const ports = makePorts();
        ports.readRecentTransactions = vi.fn(() => [
          { ...transaction(), amount: money('245.90000') },
        ]);
        return makeAdapter(ports)();
      },
    ],
  ])('collapses %s to a safe 500 internal error', async (_name, provide) => {
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

  it('honors real registry rotation and revocation on the next request', async () => {
    const testDatabase = createTestDb();
    openDatabases.push(testDatabase);
    const registry = new MobileDeviceRegistry(testDatabase.db);
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
    expect(rotated?.token).toBeTruthy();
    const [oldCredential, newCredential] = await Promise.all([
      request(credential.token),
      request(rotated!.token),
    ]);
    expect(oldCredential.statusCode).toBe(401);
    expect(oldCredential.json().error.code).toBe('authentication_invalid');
    expect(newCredential.statusCode).toBe(200);

    expect(registry.revoke(credential.device.id)).toBe(true);
    const revoked = await request(rotated!.token);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe('authentication_revoked');
    expect(provider).toHaveBeenCalledTimes(2);
    expect(
      [initial.body, oldCredential.body, newCredential.body, revoked.body].join(),
    ).not.toContain(credential.token);
  });

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
