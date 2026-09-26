import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import { todayInIsrael } from '../shared/dates.js';
import { config } from '../config.js';

const { evaluateTypeSafeMock } = vi.hoisted(() => ({ evaluateTypeSafeMock: vi.fn() }));
vi.mock('../ai/typesafe/client.js', () => ({ evaluateTypeSafe: evaluateTypeSafeMock }));

let testDb: TestDb;
let configKeySequence = 0;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
  get sqlite() {
    return testDb.sqlite;
  },
  isDemoMode: () => false,
  closeAll: () => {},
}));

vi.mock('../scraper/credential-store.js', () => ({
  getStoredCredentials: vi.fn().mockResolvedValue([]),
  storeCredentials: vi.fn().mockResolvedValue(undefined),
  deleteCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../scraper/scraper.service.js', () => ({
  MANUAL_LOGIN_COMPANIES: new Set(),
  startScraping: vi.fn(),
}));

vi.mock('../services/exchange-rates.js', () => ({
  getExchangeRates: vi.fn().mockResolvedValue({
    rates: { ILS: 1, USD: 3.6, EUR: 3.9 },
    stale: false,
    fetchedAt: new Date().toISOString(),
  }),
  convertToIls: vi.fn((amount: number, currency: string, rates: Record<string, number>) => {
    if (currency === 'ILS') return amount;
    const rate = rates[currency];
    if (rate === undefined) return 0;
    return amount * rate;
  }),
}));

describe('summary routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    config.TYPESAFE_API_KEY = `test-typesafe-key-${++configKeySequence}`;
    evaluateTypeSafeMock.mockReset();
    evaluateTypeSafeMock.mockImplementation(
      async ({ questions }: { questions: Record<string, unknown> }) => ({
        model: 'jev-test',
        answers: Object.fromEntries(
          Object.keys(questions).map((id) => [
            id,
            {
              type: 'choice',
              choice: 'subscription',
              confidence: 0.95,
              probabilities: {
                subscription: 0.95,
                serviceBill: 0.02,
                ordinary: 0.01,
                other: 0.01,
                unknown: 0.01,
              },
            },
          ]),
        ),
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('serves recurring payments to the desktop', async () => {
    const account = insertAccount(testDb.db);
    const today = todayInIsrael();
    const [year, month] = today.split('-').map(Number);
    const day = Math.min(Number(today.slice(8)), 6);
    for (const offset of [-2, -1, 0]) {
      const date = new Date(Date.UTC(year, month - 1 + offset, day)).toISOString().slice(0, 10);
      insertTransaction(testDb.db, account.id, {
        date,
        processedDate: date,
        description: 'Netflix',
        category: 'subscriptions',
        chargedAmount: -50,
      });
    }
    const response = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().payments).toMatchObject([
      { name: 'Netflix', usualAmount: 50, monthlyCost: 50, frequency: 'monthly' },
    ]);
  });

  it('shows matched and other merchant charges after a subscription upgrade', async () => {
    const account = insertAccount(testDb.db);
    const anotherAccount = insertAccount(testDb.db);
    const today = todayInIsrael();
    const [year, month] = today.split('-').map(Number);
    for (const [index, offset] of [-3, -2, -1, 0].entries()) {
      const date = new Date(Date.UTC(year, month - 1 + offset, 6)).toISOString().slice(0, 10);
      insertTransaction(testDb.db, account.id, {
        date,
        processedDate: date,
        description: 'Codex Subscription',
        chargedAmount: index === 3 ? -100 : -20,
      });
    }
    const otherDate = new Date(Date.UTC(year, month - 1, 10)).toISOString().slice(0, 10);
    insertTransaction(testDb.db, account.id, {
      date: otherDate,
      processedDate: otherDate,
      description: 'Codex Subscription',
      chargedAmount: -20,
    });
    insertTransaction(testDb.db, anotherAccount.id, {
      date: otherDate,
      processedDate: otherDate,
      description: 'Codex Subscription',
      chargedAmount: -9,
    });
    const list = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    const payment = list.json().payments[0];
    expect(payment).toMatchObject({ usualAmount: 100, annualCost: 1200 });
    const query = new URLSearchParams({
      accountId: String(payment.accountId),
      currencyCode: payment.currencyCode,
      merchantKey: payment.merchantKey,
    });
    const detail = await server.inject({
      method: 'GET',
      url: `/api/recurring-payments/detail?${query}`,
      headers: authHeaders(),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      previousAmount: 20,
      changedOnDate: new Date(Date.UTC(year, month - 1, 6)).toISOString().slice(0, 10),
      payment: { usualAmount: 100, annualCost: 1200 },
    });
    expect(
      detail.json().transactions.filter((row: { inPattern: boolean }) => row.inPattern),
    ).toHaveLength(4);
    expect(
      detail.json().transactions.filter((row: { inPattern: boolean }) => !row.inPattern),
    ).toMatchObject([{ amount: 20 }]);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/recurring-payments/detail?merchantKey=x',
          headers: authHeaders(),
        })
      ).statusCode,
    ).toBe(400);
  });

  it('uses Jev to hide repeat shopping without sending editable categories', async () => {
    const account = insertAccount(testDb.db);
    const today = todayInIsrael();
    const [year, month] = today.split('-').map(Number);
    for (const offset of [-2, -1, 0]) {
      const date = new Date(Date.UTC(year, month - 1 + offset, 6)).toISOString().slice(0, 10);
      insertTransaction(testDb.db, account.id, {
        date,
        processedDate: date,
        description: 'Cafe Example',
        category: 'subscriptions',
        chargedAmount: -50,
      });
      insertTransaction(testDb.db, account.id, {
        date,
        processedDate: date,
        description: 'Utility Example',
        category: 'shopping',
        chargedAmount: -50,
      });
    }
    evaluateTypeSafeMock.mockImplementation(
      async ({
        state,
        questions,
      }: {
        state: { candidates: Array<{ name: string }> };
        questions: Record<string, unknown>;
      }) => ({
        model: 'jev-test',
        answers: Object.fromEntries(
          Object.keys(questions).map((id, index) => {
            const choice = state.candidates[index].name.startsWith('Cafe')
              ? 'ordinary'
              : 'serviceBill';
            return [
              id,
              {
                type: 'choice',
                choice,
                confidence: 0.96,
                probabilities: { [choice]: 0.96, unknown: 0.04 },
              },
            ];
          }),
        ),
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const response = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      payments: [{ name: 'Utility Example', kind: 'serviceBill' }],
      suggestions: [],
    });
    expect(JSON.stringify(evaluateTypeSafeMock.mock.calls[0][0])).not.toContain('category');
  });

  it('keeps candidates in Review when Jev is unavailable', async () => {
    const account = insertAccount(testDb.db);
    const today = todayInIsrael();
    const [year, month] = today.split('-').map(Number);
    for (const offset of [-2, -1, 0]) {
      const date = new Date(Date.UTC(year, month - 1 + offset, 6)).toISOString().slice(0, 10);
      insertTransaction(testDb.db, account.id, {
        date,
        processedDate: date,
        description: 'Unclassified Provider',
        chargedAmount: -50,
      });
    }
    evaluateTypeSafeMock.mockRejectedValueOnce(new Error('offline'));
    const response = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      payments: [],
      suggestions: [{ name: 'Unclassified Provider' }],
      totals: [],
    });
    const retry = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    expect(retry.json().classificationPending).toBe(false);
    expect(evaluateTypeSafeMock).toHaveBeenCalledTimes(1);
  });

  it('retries classification when the TypeSafe key changes during a failed request', async () => {
    const account = insertAccount(testDb.db);
    const today = todayInIsrael();
    const [year, month] = today.split('-').map(Number);
    for (const offset of [-2, -1, 0]) {
      const date = new Date(Date.UTC(year, month - 1 + offset, 6)).toISOString().slice(0, 10);
      insertTransaction(testDb.db, account.id, {
        date,
        processedDate: date,
        description: 'Key Change Provider',
        chargedAmount: -50,
      });
    }
    evaluateTypeSafeMock.mockImplementationOnce(async () => {
      config.TYPESAFE_API_KEY = `replacement-key-${++configKeySequence}`;
      throw new Error('previous key failed');
    });
    const first = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    expect(first.json().suggestions).toMatchObject([{ name: 'Key Change Provider' }]);

    const retry = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    expect(retry.json().payments).toMatchObject([{ name: 'Key Change Provider' }]);
    expect(evaluateTypeSafeMock).toHaveBeenCalledTimes(2);
  });

  it('returns Review before a slow Jev request can time out the phone', async () => {
    const account = insertAccount(testDb.db);
    const today = todayInIsrael();
    const [year, month] = today.split('-').map(Number);
    for (const offset of [-2, -1, 0]) {
      const date = new Date(Date.UTC(year, month - 1 + offset, 6)).toISOString().slice(0, 10);
      insertTransaction(testDb.db, account.id, {
        date,
        processedDate: date,
        description: 'Slow Provider',
        chargedAmount: -50,
      });
    }
    evaluateTypeSafeMock.mockImplementationOnce(() => new Promise(() => {}));
    const started = Date.now();
    const response = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(response.json()).toMatchObject({
      payments: [],
      suggestions: [{ name: 'Slow Provider' }],
      classificationPending: true,
    });
  }, 7_000);

  it('saves subscription review decisions and restores automatic detection', async () => {
    const account = insertAccount(testDb.db);
    const today = todayInIsrael();
    const [year, month] = today.split('-').map(Number);
    for (const offset of [-2, -1, 0]) {
      const date = new Date(Date.UTC(year, month - 1 + offset, 6)).toISOString().slice(0, 10);
      insertTransaction(testDb.db, account.id, {
        date,
        processedDate: date,
        description: 'Netflix',
        category: 'subscriptions',
        chargedAmount: -50,
      });
    }
    const first = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    const body = {
      accountId: account.id,
      currencyCode: 'ILS',
      merchantKey: first.json().payments[0].merchantKey,
    };
    const request = (decision: string) =>
      server.inject({
        method: 'PUT',
        url: '/api/recurring-payments/decision',
        headers: authHeaders(),
        payload: { ...body, decision },
      });
    const excluded = await request('exclude');
    expect(excluded.statusCode).toBe(200);
    expect(excluded.json()).toMatchObject({
      payments: [],
      excluded: [{ name: 'Netflix' }],
      totals: [],
    });
    const persisted = await server.inject({
      method: 'GET',
      url: '/api/recurring-payments',
      headers: authHeaders(),
    });
    expect(persisted.json().excluded).toHaveLength(1);
    const restored = await request('auto');
    expect(restored.json()).toMatchObject({ payments: [{ name: 'Netflix' }], excluded: [] });
    expect((await request('invalid')).statusCode).toBe(400);
  });

  // ── GET /api/transactions/summary ──

  describe('GET /api/transactions/summary', () => {
    it('returns summary grouped by category by default', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { category: 'food', chargedAmount: -100 });
      insertTransaction(testDb.db, account.id, { category: 'transport', chargedAmount: -50 });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions/summary',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.groupBy).toBe('category');
      expect(body.summary.length).toBeGreaterThanOrEqual(2);
    });

    it('supports groupBy=month', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15' });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions/summary?groupBy=month',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.groupBy).toBe('month');
    });

    it('supports groupBy=cashflow', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions/summary?groupBy=cashflow',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.groupBy).toBe('cashflow');
    });

    it('supports date range filters', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, {
        date: '2026-01-15',
        processedDate: '2026-01-15',
        chargedAmount: -100,
      });
      insertTransaction(testDb.db, account.id, {
        date: '2026-03-15',
        processedDate: '2026-03-15',
        chargedAmount: -200,
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions/summary?startDate=2026-01-01&endDate=2026-01-31',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const total = body.summary.reduce(
        (s: number, r: { totalAmount: number }) => s + r.totalAmount,
        0,
      );
      expect(total).toBe(-100);
    });

    it('returns empty summary for non-existent accountType', async () => {
      const account = insertAccount(testDb.db, { accountType: 'bank' });
      insertTransaction(testDb.db, account.id, { chargedAmount: -100 });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions/summary?accountType=credit_card',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.summary).toHaveLength(0);
    });
  });
});
