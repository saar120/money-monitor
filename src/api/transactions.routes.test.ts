import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';
import { insertAccount, insertMember, insertTransaction } from '../__tests__/helpers/fixtures.js';
import { createMobilePublicIdProjector } from '../mobile/mobile-public-id.js';
import { config } from '../config.js';

let testDb: TestDb;
const publicId = createMobilePublicIdProjector(config.MOBILE_PUBLIC_ID_KEY);

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

describe('transactions routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  // ── GET /api/transactions/needs-review/count ──

  describe('GET /api/transactions/needs-review/count', () => {
    it('returns count of transactions needing review', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { needsReview: true });
      insertTransaction(testDb.db, account.id, { needsReview: true });
      insertTransaction(testDb.db, account.id, { needsReview: false });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions/needs-review/count',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.count).toBe(2);
    });
  });

  // ── PATCH /api/transactions/:id ──

  describe('PATCH /api/transactions/:id', () => {
    it('updates transaction category', async () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', tx.id)}`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { category: 'food' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transaction.category).toBe('food');
    });

    it('returns 404 for non-existent transaction', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', 99999)}`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { category: 'food' },
      });
      expect(res.statusCode).toBe(404);
    });

    it.each(['abc', '1'])('returns 400 for private or invalid id %s', async (id) => {
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${id}`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { category: 'food' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /api/transactions/:id/owner ──

  describe('PATCH /api/transactions/:id/owner', () => {
    it('sets manual transaction owner', async () => {
      const member = insertMember(testDb.db, { name: 'Dana' });
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', tx.id)}/owner`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { ownerType: 'member', ownerMemberId: member.id },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transaction.expenseOwnerType).toBe('member');
      expect(body.transaction.expenseOwnerMemberId).toBe(member.id);
      expect(body.transaction.ownerSource).toBe('manual');
    });
  });

  // ── PATCH /api/transactions/:id/ignore ──

  describe('PATCH /api/transactions/:id/ignore', () => {
    it('sets ignored flag', async () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', tx.id)}/ignore`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { ignored: true },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transaction.ignored).toBe(true);
    });

    it('returns 404 for non-existent transaction', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', 99999)}/ignore`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { ignored: true },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for missing ignored field', async () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', tx.id)}/ignore`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /api/transactions/:id/resolve ──

  describe('PATCH /api/transactions/:id/resolve', () => {
    it('resolves a review', async () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id, { needsReview: true });

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', tx.id)}/resolve`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { category: 'food' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transaction.needsReview).toBe(false);
      expect(body.transaction.category).toBe('food');
    });

    it('returns 404 for non-existent transaction', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', 99999)}/resolve`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { category: 'food' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for missing category', async () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${publicId('transaction', tx.id)}/resolve`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
