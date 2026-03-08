import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';

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
    it('creates a category and returns 201', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/categories',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'groceries', label: 'Groceries' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.category.name).toBe('groceries');
      expect(body.category.label).toBe('Groceries');
      expect(body.category.id).toBeGreaterThan(0);
    });

    it('returns 400 for invalid name', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/categories',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'Invalid Name!', label: 'Test' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for missing label', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/categories',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'test' },
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

    it('accepts optional color and rules', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/categories',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'bills', label: 'Bills', color: '#ff0000', rules: 'electric|water' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.category.color).toBe('#ff0000');
      expect(body.category.rules).toBe('electric|water');
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

    it('returns 400 for invalid id param', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: '/api/categories/abc',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { label: 'Test' },
      });
      expect(res.statusCode).toBe(400);
    });

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
    it('deletes a category', async () => {
      // Create one to delete
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
      const body = JSON.parse(res.body);
      expect(body.deleted).toBe(true);
    });

    it('returns 404 for non-existent category', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/api/categories/99999',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid id param', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/api/categories/abc',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
