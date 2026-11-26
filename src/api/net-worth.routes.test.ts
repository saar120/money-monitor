import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';
import { insertAccount, insertLiability } from '../__tests__/helpers/fixtures.js';

let testDb: TestDb;

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

describe('net-worth routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  // ── GET /api/net-worth ──

  describe('GET /api/net-worth', () => {
    it('returns calculated net worth with data', async () => {
      insertAccount(testDb.db, {
        displayName: 'Bank',
        accountType: 'bank',
        balance: 10000,
        isActive: true,
      });
      insertLiability(testDb.db, {
        name: 'Loan',
        currency: 'ILS',
        currentBalance: 3000,
        isActive: true,
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/net-worth',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.banksTotal).toBe(10000);
      expect(body.liabilitiesTotal).toBe(3000);
      expect(body.total).toBe(7000);
    });
  });

  // ── GET /api/net-worth/history ──

  describe('GET /api/net-worth/history', () => {
    it('passes query parameters through and validates history bounds', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/net-worth/history?startDate=2026-01-01&endDate=2026-03-01&granularity=monthly',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { series: Array<{ date: string }> };
      expect(body.series.map((p) => p.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);

      const invalidGranularity = await server.inject({
        method: 'GET',
        url: '/api/net-worth/history?granularity=hourly',
        headers: authHeaders(),
      });
      expect(invalidGranularity.statusCode).toBe(400);

      const tooManyPoints = await server.inject({
        method: 'GET',
        url: '/api/net-worth/history?startDate=2020-01-01&endDate=2026-01-01&granularity=daily',
        headers: authHeaders(),
      });
      expect(tooManyPoints.statusCode).toBe(400);
    });
  });
});
