import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import { todayInIsrael } from '../shared/dates.js';
import { config } from '../config.js';

const { evaluateTypeSafeMock } = vi.hoisted(() => ({ evaluateTypeSafeMock: vi.fn() }));
vi.mock('../ai/typesafe/client.js', () => ({ evaluateTypeSafe: evaluateTypeSafeMock }));

// Keep monthly charges in the past while preserving real timers for timeout checks.
vi.mock('../shared/dates.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/dates.js')>()),
  todayInIsrael: () => '2026-09-15',
}));

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
    let expectedVersion = 0;
    const request = (decision: string) =>
      server.inject({
        method: 'PUT',
        url: '/api/recurring-payments/decision',
        headers: authHeaders(),
        payload: { ...body, decision, commandId: randomUUID(), expectedVersion: expectedVersion++ },
      });
    const excluded = await request('exclude');
    expect(excluded.statusCode).toBe(200);
    expect(excluded.json().result).toMatchObject({
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
    expect(restored.json().result).toMatchObject({ payments: [{ name: 'Netflix' }], excluded: [] });
    expect((await request('invalid')).statusCode).toBe(400);
  });

  // ── GET /api/transactions/summary ──

  describe('GET /api/transactions/summary', () => {
    it('returns summary grouped by category by default and forwards query filters', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, {
        category: 'food',
        date: '2026-01-15',
        processedDate: '2026-01-15',
        chargedAmount: -100,
      });
      insertTransaction(testDb.db, account.id, {
        category: 'transport',
        date: '2026-03-15',
        processedDate: '2026-03-15',
        chargedAmount: -50,
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions/summary',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ groupBy: 'category' });
      expect(res.json().summary.length).toBeGreaterThanOrEqual(2);

      const filtered = await server.inject({
        method: 'GET',
        url: '/api/transactions/summary?groupBy=month&startDate=2026-01-01&endDate=2026-01-31',
        headers: authHeaders(),
      });
      expect(filtered.statusCode).toBe(200);
      expect(filtered.json()).toMatchObject({
        groupBy: 'month',
        summary: [{ month: '2026-01', totalAmount: -100 }],
      });
    });
  });
});
