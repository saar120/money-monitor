import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';
import { insertLiability } from '../__tests__/helpers/fixtures.js';

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

describe('liabilities routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  // ── GET /api/liabilities ──

  describe('GET /api/liabilities', () => {
    it('returns empty list', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/liabilities',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toEqual([]);
    });

    it('returns active liabilities with ILS conversion', async () => {
      insertLiability(testDb.db, { name: 'Mortgage', currency: 'USD', currentBalance: 1000 });

      const res = await server.inject({
        method: 'GET',
        url: '/api/liabilities',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Mortgage');
      expect(body[0].currentBalanceIls).toBe(3600);
    });

    it('includes inactive when querystring set', async () => {
      insertLiability(testDb.db, { name: 'Active', isActive: true });
      insertLiability(testDb.db, { name: 'Inactive', isActive: false });

      const res = await server.inject({
        method: 'GET',
        url: '/api/liabilities?includeInactive=true',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(2);
    });
  });

  // ── POST /api/liabilities ──

  describe('POST /api/liabilities', () => {
    it('creates a liability and returns 201', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/liabilities',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'Home Loan', type: 'mortgage', currency: 'ILS',
          originalAmount: 500000, currentBalance: 400000,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.name).toBe('Home Loan');
    });

    it('returns 409 for duplicate name', async () => {
      insertLiability(testDb.db, { name: 'My Loan' });

      const res = await server.inject({
        method: 'POST',
        url: '/api/liabilities',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'My Loan', type: 'loan', currency: 'ILS',
          originalAmount: 10000, currentBalance: 8000,
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/liabilities',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'Incomplete' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── PUT /api/liabilities/:id ──

  describe('PUT /api/liabilities/:id', () => {
    it('updates a liability', async () => {
      const liability = insertLiability(testDb.db, { name: 'Loan', currentBalance: 50000 });

      const res = await server.inject({
        method: 'PUT',
        url: `/api/liabilities/${liability.id}`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { currentBalance: 45000 },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.currentBalance).toBe(45000);
    });

    it('returns 404 for non-existent liability', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: '/api/liabilities/99999',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { currentBalance: 1000 },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid id', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: '/api/liabilities/abc',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { currentBalance: 1000 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /api/liabilities/:id ──

  describe('DELETE /api/liabilities/:id', () => {
    it('soft-deletes a liability and returns 204', async () => {
      const liability = insertLiability(testDb.db, { name: 'To Delete' });

      const res = await server.inject({
        method: 'DELETE',
        url: `/api/liabilities/${liability.id}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(204);
    });

    it('returns 404 for non-existent liability', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/api/liabilities/99999',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
