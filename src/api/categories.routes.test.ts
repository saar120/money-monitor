import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';

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

describe('categories routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  // ── GET /api/categories ──

  describe('GET /api/categories', () => {
    it('returns list of categories', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/categories',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.categories).toBeDefined();
      expect(Array.isArray(body.categories)).toBe(true);
      // Seeded categories from migration
      expect(body.categories.length).toBeGreaterThanOrEqual(12);
    });
  });

  // ── POST /api/categories ──

  describe('POST /api/categories', () => {
    it('creates a category with optional fields and returns 201', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/categories',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'bills', label: 'Bills', color: '#ff0000', rules: 'electric|water' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.category).toMatchObject({
        name: 'bills',
        label: 'Bills',
        color: '#ff0000',
        rules: 'electric|water',
      });
      expect(body.category.id).toBeGreaterThan(0);
    });

    it.each([
      ['invalid name', { name: 'Invalid Name!', label: 'Test' }],
      ['missing label', { name: 'test' }],
    ])('returns 400 for %s', async (_label, payload) => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/categories',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      // 'food' is seeded by migration
      const res = await server.inject({
        method: 'POST',
        url: '/api/categories',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'food', label: 'Food again' },
      });
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('already exists');
    });
  });

  // ── PATCH /api/categories/:id ──

  describe('PATCH /api/categories/:id', () => {
    it('updates a category', async () => {
      // Get seeded category
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/categories',
        headers: authHeaders(),
      });
      const categories = JSON.parse(listRes.body).categories;
      const food = categories.find((c: { name: string }) => c.name === 'food');

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/categories/${food.id}`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { label: 'Food & Drink' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.category.label).toBe('Food & Drink');
    });

    it.each(['PATCH', 'DELETE'] as const)(
      'returns 400 for invalid id param on %s',
      async (method) => {
        const res = await server.inject({
          method,
          url: '/api/categories/abc',
          headers:
            method === 'PATCH'
              ? { ...authHeaders(), 'content-type': 'application/json' }
              : authHeaders(),
          payload: method === 'PATCH' ? { label: 'Test' } : undefined,
        });
        expect(res.statusCode).toBe(400);
      },
    );

    it('returns 404 for non-existent category', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: '/api/categories/99999',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { label: 'Nope' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/categories/:id ──

  describe('DELETE /api/categories/:id', () => {
    it('deletes a category and returns 404 when missing', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/categories',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'to-delete', label: 'Deletable' },
      });
      const { id } = JSON.parse(createRes.body).category;

      const res = await server.inject({
        method: 'DELETE',
        url: `/api/categories/${id}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).deleted).toBe(true);

      const missing = await server.inject({
        method: 'DELETE',
        url: `/api/categories/${id}`,
        headers: authHeaders(),
      });
      expect(missing.statusCode).toBe(404);
    });
  });
});
