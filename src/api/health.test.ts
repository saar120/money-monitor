import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() { return testDb.db; },
  get sqlite() { return testDb.sqlite; },
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
  getExchangeRates: vi.fn().mockResolvedValue({ rates: { ILS: 1, USD: 3.6, EUR: 3.9 }, stale: false, fetchedAt: new Date().toISOString() }),
  convertToIls: vi.fn((amount: number, currency: string, rates: Record<string, number>) => {
    if (currency === 'ILS') return amount;
    const rate = rates[currency];
    if (rate === undefined) return 0;
    return amount * rate;
  }),
}));

describe('health & auth routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  // ── Health ──

  describe('GET /api/health', () => {
    it('returns 200 without auth', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/health',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  // ── Auth ──

  describe('authentication', () => {
    it('returns 401 for authenticated routes without token', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/categories',
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('accepts valid Bearer token', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/categories',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects invalid Bearer token', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/categories',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects request without Bearer prefix', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/categories',
        headers: { authorization: 'test-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
