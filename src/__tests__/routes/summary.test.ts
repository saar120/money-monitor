import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../helpers/server.js';
import { insertAccount, insertTransaction } from '../helpers/fixtures.js';

let testDb: TestDb;

vi.mock('../../db/connection.js', () => ({
  get db() { return testDb.db; },
  get sqlite() { return testDb.sqlite; },
}));

vi.mock('../../scraper/credential-store.js', () => ({
  getStoredCredentials: vi.fn().mockResolvedValue([]),
  storeCredentials: vi.fn().mockResolvedValue(undefined),
  deleteCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../scraper/scraper.service.js', () => ({
  MANUAL_LOGIN_COMPANIES: new Set(),
  startScraping: vi.fn(),
}));

vi.mock('../../services/exchange-rates.js', () => ({
  getExchangeRates: vi.fn().mockResolvedValue({ rates: { ILS: 1, USD: 3.6, EUR: 3.9 }, stale: false, fetchedAt: new Date().toISOString() }),
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
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
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
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', chargedAmount: -100 });
      insertTransaction(testDb.db, account.id, { date: '2026-03-15', processedDate: '2026-03-15', chargedAmount: -200 });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions/summary?startDate=2026-01-01&endDate=2026-01-31',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const total = body.summary.reduce((s: number, r: { totalAmount: number }) => s + r.totalAmount, 0);
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
