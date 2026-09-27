import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';
import { insertAccount, insertMember, insertTransaction } from '../__tests__/helpers/fixtures.js';

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

describe('transactions routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  // ── GET /api/transactions ──

  it('opens a transaction by ID independently of list pagination', async () => {
    const account = insertAccount(testDb.db);
    const transaction = insertTransaction(testDb.db, account.id, { description: 'Linked charge' });
    const response = await server.inject({
      method: 'GET',
      url: `/api/transactions/${transaction.id}`,
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().transaction).toMatchObject({
      id: transaction.id,
      description: 'Linked charge',
    });
    const missing = await server.inject({
      method: 'GET',
      url: '/api/transactions/999999',
      headers: authHeaders(),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('reports new activity since a saved visit', async () => {
    const account = insertAccount(testDb.db);
    insertTransaction(testDb.db, account.id, { chargedAmount: -42 });
    const response = await server.inject({
      method: 'GET',
      url: '/api/transactions/since?since=2020-01-01T00%3A00%3A00.000Z',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ transactions: 1, spent: 42 });
  });

  it('shows budget progress for the selected historical month', async () => {
    const account = insertAccount(testDb.db);
    insertTransaction(testDb.db, account.id, {
      category: 'food',
      chargedAmount: -42,
      date: '2025-01-15',
      processedDate: '2025-01-15',
    });
    insertTransaction(testDb.db, account.id, {
      category: 'food',
      chargedAmount: -99,
      date: '2025-02-15',
      processedDate: '2025-02-15',
    });
    const created = await server.inject({
      method: 'POST',
      url: '/api/budgets',
      headers: authHeaders(),
      payload: { name: 'Food', amount: 100, categoryNames: ['food'] },
    });
    expect(created.statusCode).toBe(201);
    const response = await server.inject({
      method: 'GET',
      url: '/api/budgets/progress?referenceDate=2025-01-01&monthlyView=true',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().progress[0]).toMatchObject({
      spent: 42,
      period: { startDate: '2025-01-01', endDate: '2025-01-31' },
    });
  });

  it('stops yearly budget progress at the selected month', async () => {
    const account = insertAccount(testDb.db);
    insertTransaction(testDb.db, account.id, {
      category: 'food',
      chargedAmount: -42,
      date: '2026-01-15',
      processedDate: '2026-01-15',
    });
    insertTransaction(testDb.db, account.id, {
      category: 'food',
      chargedAmount: -99,
      date: '2026-02-15',
      processedDate: '2026-02-15',
    });
    await server.inject({
      method: 'POST',
      url: '/api/budgets',
      headers: authHeaders(),
      payload: { name: 'Yearly food', amount: 1200, period: 'yearly', categoryNames: ['food'] },
    });
    const response = await server.inject({
      method: 'GET',
      url: '/api/budgets/progress?referenceDate=2026-01-01',
      headers: authHeaders(),
    });
    expect(response.json().progress[0]).toMatchObject({
      spent: 42,
      period: { startDate: '2026-01-01', endDate: '2026-01-31' },
    });
  });

  describe('GET /api/transactions', () => {
    it('returns empty list with pagination', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transactions).toHaveLength(0);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(0);
    });

    it('returns transactions with pagination', async () => {
      const account = insertAccount(testDb.db);
      for (let i = 0; i < 3; i++) {
        insertTransaction(testDb.db, account.id);
      }

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions?limit=2',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transactions).toHaveLength(2);
      expect(body.pagination.total).toBe(3);
      expect(body.pagination.hasMore).toBe(true);
    });

    it('supports query filters', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, {
        category: 'food',
        date: '2026-01-15',
        processedDate: '2026-01-15',
      });
      insertTransaction(testDb.db, account.id, {
        category: 'transport',
        date: '2026-02-15',
        processedDate: '2026-02-15',
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions?category=food&startDate=2026-01-01&endDate=2026-01-31',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transactions).toHaveLength(1);
      expect(body.transactions[0].category).toBe('food');
    });

    it('finds uncategorized transactions from category drilldown', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { category: null });
      insertTransaction(testDb.db, account.id, { category: 'food' });
      const response = await server.inject({
        method: 'GET',
        url: '/api/transactions?category=uncategorized',
        headers: authHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().pagination.total).toBe(1);
      expect(response.json().transactions[0].category).toBeNull();
    });

    it('searches descriptions containing punctuation and Hebrew', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { description: 'הלוואה - משכנתא' });
      const response = await server.inject({
        method: 'GET',
        url: `/api/transactions?search=${encodeURIComponent('הלוואה - משכנתא')}`,
        headers: authHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().pagination.total).toBe(1);
    });

    it('filters excluded and review transactions with explicit false values', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { ignored: true, needsReview: false });
      insertTransaction(testDb.db, account.id, { ignored: false, needsReview: true });
      const response = await server.inject({
        method: 'GET',
        url: '/api/transactions?ignored=false&needsReview=true',
        headers: authHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().transactions).toMatchObject([{ ignored: false, needsReview: true }]);
    });

    it('supports sorting', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, {
        chargedAmount: -50,
        date: '2026-01-10',
        processedDate: '2026-01-10',
      });
      insertTransaction(testDb.db, account.id, {
        chargedAmount: -200,
        date: '2026-01-20',
        processedDate: '2026-01-20',
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/transactions?sortBy=date&sortOrder=asc',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transactions[0].date).toBe('2026-01-10');
    });
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
        url: `/api/transactions/${tx.id}`,
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
        url: '/api/transactions/99999',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { category: 'food' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid id', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: '/api/transactions/abc',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { category: 'food' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /api/transactions/:id/owner ──

  describe('PATCH /api/transactions/:id/effective-date', () => {
    it('sets and clears an effective date', async () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id, { date: '2026-09-01' });

      const moved = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${tx.id}/effective-date`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { effectiveDate: '2026-08-31' },
      });
      expect(moved.statusCode).toBe(200);
      expect(JSON.parse(moved.body).transaction.reportingDate).toBe('2026-08-31');

      const reset = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${tx.id}/effective-date`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { effectiveDate: null },
      });
      expect(reset.statusCode).toBe(200);
      expect(JSON.parse(reset.body).transaction.reportingDate).toBe('2026-09-01');
    });

    it('rejects invalid calendar dates', async () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${tx.id}/effective-date`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { effectiveDate: '2026-02-30' },
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
        url: `/api/transactions/${tx.id}/owner`,
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
        url: `/api/transactions/${tx.id}/ignore`,
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
        url: '/api/transactions/99999/ignore',
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
        url: `/api/transactions/${tx.id}/ignore`,
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
        url: `/api/transactions/${tx.id}/resolve`,
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
        url: '/api/transactions/99999/resolve',
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
        url: `/api/transactions/${tx.id}/resolve`,
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
