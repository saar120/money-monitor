import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import { createMobileServer } from './mobile-server.js';
import { createProductionMobileAccess } from './production-mobile-access.js';

const NOW = new Date('2026-07-15T10:00:00.000Z');
const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const PUBLIC_ID_KEY = 'private-public-id-key-material-that-is-at-least-32-chars';
const BASE_URL = '/api/mobile/v1/recurring-payments';

describe('mobile recurring payments route', () => {
  const databases: TestDb[] = [];
  const servers: Array<ReturnType<typeof createMobileServer>> = [];

  function createHarness() {
    const database = createTestDb();
    databases.push(database);
    const access = createProductionMobileAccess({
      db: database.db,
      serverId: SERVER_ID,
      publicIdKey: PUBLIC_ID_KEY,
      server: {
        displayName: 'Saar’s Mac',
        serverVersion: '0.3.5',
        minimumClientVersion: '0.1.0',
      },
      readNetWorthIls: () => 0,
      clock: () => NOW,
    });
    const issued = access.deviceRegistry.issue({ name: 'Personal iPhone' });
    const server = createMobileServer({
      recurringPayments: access.recurringPaymentsDependencies,
      transactions: access.transactionDependencies,
      clock: () => NOW,
      logger: false,
    });
    servers.push(server);
    return {
      database,
      server,
      headers: { authorization: `Bearer ${issued.token}` },
    };
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.shutdown()));
    databases.splice(0).forEach((database) => database.close());
  });

  it('requires authentication, validates decisions, and persists subscription review updates', async () => {
    const { database, server, headers } = createHarness();
    const account = insertAccount(database.db);
    for (const date of ['2026-04-20', '2026-05-20', '2026-06-20']) {
      insertTransaction(database.db, account.id, {
        date,
        processedDate: date,
        description: 'Holmes Place',
        chargedAmount: -50,
        category: 'fitness',
      });
    }

    expect((await server.app.inject({ method: 'GET', url: BASE_URL })).statusCode).toBe(401);

    const initial = await server.app.inject({ method: 'GET', url: BASE_URL, headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.json()).toMatchObject({
      data: {
        payments: [],
        suggestions: [{ name: 'Holmes Place' }],
        asOfDate: '2026-07-15',
      },
      meta: { server: { id: SERVER_ID } },
    });

    const candidate = initial.json().data.suggestions[0];
    expect(candidate.accountId).toMatch(/^account_[A-Za-z0-9_-]{22}$/);
    expect(candidate.merchantKey).toMatch(/^[a-f0-9]{64}$/);

    const detailUrl = `${BASE_URL}/detail?${new URLSearchParams({
      accountId: candidate.accountId,
      currencyCode: candidate.currencyCode,
      merchantKey: candidate.merchantKey,
    })}`;
    expect((await server.app.inject({ method: 'GET', url: detailUrl })).statusCode).toBe(401);

    const detail = await server.app.inject({ method: 'GET', url: detailUrl, headers });
    expect(detail.statusCode).toBe(200);
    const chargeId = detail.json().data.transactions[0].id as string;
    expect(chargeId).toMatch(/^transaction_[A-Za-z0-9_-]{22}$/);
    expect(
      (
        await server.app.inject({
          method: 'GET',
          url: `/api/mobile/v1/transactions/${chargeId}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);

    const decisionPayload = {
      accountId: candidate.accountId,
      currencyCode: candidate.currencyCode,
      merchantKey: candidate.merchantKey,
      decision: 'include',
      commandId: '11111111-1111-4111-8111-111111111112',
      expectedVersion: candidate.resourceVersion ?? 0,
    };
    expect(
      (
        await server.app.inject({
          method: 'PUT',
          url: `${BASE_URL}/decision`,
          payload: decisionPayload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.app.inject({
          method: 'PUT',
          url: `${BASE_URL}/decision`,
          headers,
          payload: { ...decisionPayload, decision: 'other' },
        })
      ).statusCode,
    ).toBe(400);

    const saved = await server.app.inject({
      method: 'PUT',
      url: `${BASE_URL}/decision`,
      headers,
      payload: decisionPayload,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.result).toMatchObject({
      payments: [{ name: 'Holmes Place' }],
      suggestions: [],
    });

    const reread = await server.app.inject({ method: 'GET', url: BASE_URL, headers });
    expect(reread.json().data.payments).toHaveLength(1);
  });

  it('normalizes legacy shekel codes, merges currency totals, and serves price-change detail through production ports', async () => {
    const { database, server, headers } = createHarness();
    const account = insertAccount(database.db, { displayName: 'Card' });
    const shekelCharges = [
      ['2026-03-20', -40],
      ['2026-04-20', -40],
      ['2026-05-20', -50],
      ['2026-06-20', -50],
    ] as const;
    for (const [date, chargedAmount] of shekelCharges) {
      insertTransaction(database.db, account.id, {
        date,
        processedDate: date,
        description: 'Netflix',
        chargedAmount,
        chargedCurrency: '₪',
      });
    }
    for (const date of ['2026-04-20', '2026-05-20', '2026-06-20']) {
      insertTransaction(database.db, account.id, {
        date,
        processedDate: date,
        description: 'Spotify',
        chargedAmount: -20,
        chargedCurrency: 'ILS',
      });
    }

    const initial = await server.app.inject({ method: 'GET', url: BASE_URL, headers });
    expect(initial.statusCode).toBe(200);
    const suggestions = initial.json().data.suggestions as Array<{
      name: string;
      accountId: string;
      currencyCode: string;
      merchantKey: string;
      resourceVersion?: number;
    }>;
    expect(suggestions.map((item) => item.name).sort()).toEqual(['Netflix', 'Spotify']);

    for (const [index, suggestion] of suggestions.entries()) {
      expect(suggestion.currencyCode).toBe('ILS');
      expect(suggestion.accountId).toMatch(/^account_[A-Za-z0-9_-]{22}$/);
      const res = await server.app.inject({
        method: 'PUT',
        url: `${BASE_URL}/decision`,
        headers,
        payload: {
          accountId: suggestion.accountId,
          currencyCode: suggestion.currencyCode,
          merchantKey: suggestion.merchantKey,
          decision: 'include',
          commandId: `11111111-1111-4111-8111-11111111111${index + 3}`,
          expectedVersion: suggestion.resourceVersion ?? 0,
        },
      });
      expect(res.statusCode).toBe(200);
    }

    const listed = await server.app.inject({ method: 'GET', url: BASE_URL, headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.totals).toEqual([
      { currencyCode: 'ILS', monthlyCost: 70, annualCost: 840 },
    ]);

    const netflix = suggestions.find((item) => item.name === 'Netflix')!;
    const detail = await server.app.inject({
      method: 'GET',
      url: `${BASE_URL}/detail?${new URLSearchParams({
        accountId: netflix.accountId,
        currencyCode: netflix.currencyCode,
        merchantKey: netflix.merchantKey,
      })}`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      payment: { name: 'Netflix', currencyCode: 'ILS' },
      previousAmount: 40,
      changedOnDate: '2026-05-20',
    });
    expect(detail.json().data.transactions[0]).toMatchObject({
      inPattern: true,
    });
    expect(detail.json().data.transactions[0].id).toMatch(/^transaction_[A-Za-z0-9_-]{22}$/);
  });
});
