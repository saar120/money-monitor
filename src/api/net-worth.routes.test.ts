import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';
import { insertAccount, insertLiability } from '../__tests__/helpers/fixtures.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() { return testDb.db; },
  get sqlite() { return testDb.sqlite; },
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
  getExchangeRates: vi.fn().mockResolvedValue({ rates: { ILS: 1, USD: 3.6, EUR: 3.9 }, stale: false, fetchedAt: new Date().toISOString() }),
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
    it('returns net worth with empty DB', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/net-worth',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.total).toBe(0);
      expect(body.banksTotal).toBe(0);
      expect(body.assetsTotal).toBe(0);
      expect(body.liabilitiesTotal).toBe(0);
    });

    it('returns calculated net worth with data', async () => {
      insertAccount(testDb.db, { displayName: 'Bank', accountType: 'bank', balance: 10000, isActive: true });
      insertLiability(testDb.db, { name: 'Loan', currency: 'ILS', currentBalance: 3000, isActive: true });

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
    it('returns history series', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/net-worth/history?startDate=2026-01-01&endDate=2026-03-01&granularity=monthly',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.series).toBeDefined();
      expect(Array.isArray(body.series)).toBe(true);
    });

    it('returns empty series for future dates with no data', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/net-worth/history?startDate=2030-01-01&endDate=2030-03-01&granularity=monthly',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.series).toBeDefined();
      // Series will have date points but all zeros
      for (const point of body.series) {
        expect(point.total).toBe(0);
      }
    });
  });
});
