import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';
import { reviewState } from '../shared/transaction-review.js';
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

  it('totals the whole filtered reporting scope, separately for each currency', async () => {
    const account = insertAccount(testDb.db);
    for (const chargedAmount of [-10, -20, 100])
      insertTransaction(testDb.db, account.id, { chargedAmount, expenseOwnerType: 'shared' });
    insertTransaction(testDb.db, account.id, {
      chargedAmount: -3.5,
      chargedCurrency: 'USD',
      expenseOwnerType: 'shared',
    });
    insertTransaction(testDb.db, account.id, {
      chargedAmount: -40,
      ignored: true,
      expenseOwnerType: 'shared',
    });
    insertTransaction(testDb.db, account.id, {
      chargedAmount: -50,
      status: 'pending',
      expenseOwnerType: 'shared',
    });
    insertTransaction(testDb.db, account.id, {
      chargedAmount: -999,
      expenseOwnerType: 'unassigned',
    });
    const response = await server.inject({
      method: 'GET',
      url: `/api/transactions?accountId=${account.id}&ownerType=shared&limit=1`,
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().transactions).toHaveLength(1);
    expect(response.json().pagination.total).toBe(6);
    expect(response.json().totals).toEqual(
      expect.arrayContaining([
        { currency: 'ILS', income: 100, expense: 30 },
        { currency: 'USD', income: 0, expense: 3.5 },
      ]),
    );
    const noMatches = await server.inject({
      method: 'GET',
      url: `/api/transactions?accountId=${account.id}&search=no-such-merchant`,
      headers: authHeaders(),
    });
    expect(noMatches.json().totals).toEqual([]);
  });

  it('commits and undoes a complete review without changing bank data', async () => {
    const account = insertAccount(testDb.db);
    const tx = insertTransaction(testDb.db, account.id, {
      needsReview: true,
      reviewReason: 'Unknown merchant',
      category: null,
      ignored: true,
      expenseOwnerType: 'unassigned',
      ownerSource: 'unassigned',
      confidence: 0.4,
    });
    const member = insertMember(testDb.db, { name: 'Review owner' });
    const commandId = randomUUID();
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/transactions/${tx.id}/review`,
      headers: authHeaders(),
      payload: {
        commandId,
        expectedVersion: tx.resourceVersion,
        expected: reviewState(tx),
        category: 'food',
        ownerType: 'member',
        ownerMemberId: member.id,
        included: true,
        effectiveDate: '2026-10-03',
      },
    });
    expect(response.statusCode).toBe(200);
    const committed = response.json();
    expect(committed.transaction).toMatchObject({
      needsReview: false,
      category: 'food',
      expenseOwnerType: 'member',
      expenseOwnerMemberId: member.id,
      ignored: false,
      effectiveDate: '2026-10-03',
      date: tx.date,
      chargedAmount: tx.chargedAmount,
    });
    const replay = await server.inject({
      method: 'PATCH',
      url: `/api/transactions/${tx.id}/review`,
      headers: authHeaders(),
      payload: {
        commandId,
        expectedVersion: tx.resourceVersion,
        expected: reviewState(tx),
        category: 'food',
        ownerType: 'member',
        ownerMemberId: member.id,
        included: true,
        effectiveDate: '2026-10-03',
      },
    });
    expect(replay.json()).toEqual(committed);
    expect(committed.transaction.resourceVersion).toBe(tx.resourceVersion + 1);
    const undoCommandId = randomUUID();
    const undone = await server.inject({
      method: 'PATCH',
      url: `/api/transactions/${tx.id}/review/undo`,
      headers: authHeaders(),
      payload: {
        ...committed.undo,
        commandId: undoCommandId,
        expectedVersion: committed.transaction.resourceVersion,
      },
    });
    expect(undone.statusCode).toBe(200);
    expect(reviewState(undone.json().transaction)).toEqual(reviewState(tx));
    expect(undone.json().transaction.date).toBe(tx.date);
    expect(undone.json().transaction.resourceVersion).toBe(tx.resourceVersion + 2);
    const undoReplay = await server.inject({
      method: 'PATCH',
      url: `/api/transactions/${tx.id}/review/undo`,
      headers: authHeaders(),
      payload: {
        ...committed.undo,
        commandId: undoCommandId,
        expectedVersion: committed.transaction.resourceVersion,
      },
    });
    expect(undoReplay.json()).toEqual(undone.json());
  });

  it('rejects a stale review and invalid owner before saving any fields', async () => {
    const account = insertAccount(testDb.db);
    const tx = insertTransaction(testDb.db, account.id, { needsReview: true, category: null });
    const payload = {
      commandId: randomUUID(),
      expectedVersion: tx.resourceVersion,
      expected: reviewState(tx),
      category: 'food',
      ownerType: 'member',
      ownerMemberId: 999999,
    };
    const invalid = await server.inject({
      method: 'PATCH',
      url: `/api/transactions/${tx.id}/review`,
      headers: authHeaders(),
      payload,
    });
    expect(invalid.statusCode).toBe(400);
    const unchanged = await server.inject({
      method: 'GET',
      url: `/api/transactions/${tx.id}`,
      headers: authHeaders(),
    });
    expect(reviewState(unchanged.json().transaction)).toEqual(reviewState(tx));
    await server.inject({
      method: 'POST',
      url: `/api/transactions/${tx.id}/commands`,
      headers: authHeaders(),
      payload: {
        commandId: randomUUID(),
        expectedVersion: tx.resourceVersion,
        patch: { effectiveDate: '2026-10-04' },
      },
    });
    const stale = await server.inject({
      method: 'PATCH',
      url: `/api/transactions/${tx.id}/review`,
      headers: authHeaders(),
      payload: { ...payload, ownerType: 'shared', ownerMemberId: null },
    });
    expect(stale.statusCode).toBe(409);
    const current = await server.inject({
      method: 'GET',
      url: `/api/transactions/${tx.id}`,
      headers: authHeaders(),
    });
    expect(current.json().transaction).toMatchObject({
      needsReview: true,
      category: null,
      effectiveDate: '2026-10-04',
    });
  });

  it('does not let Undo overwrite a later transaction edit', async () => {
    const account = insertAccount(testDb.db);
    const tx = insertTransaction(testDb.db, account.id, { needsReview: true, category: null });
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/transactions/${tx.id}/review`,
      headers: authHeaders(),
      payload: {
        commandId: randomUUID(),
        expectedVersion: tx.resourceVersion,
        expected: reviewState(tx),
        category: 'food',
        ownerType: 'shared',
        ownerMemberId: null,
      },
    });
    expect(response.statusCode).toBe(200);
    await server.inject({
      method: 'POST',
      url: `/api/transactions/${tx.id}/commands`,
      headers: authHeaders(),
      payload: {
        commandId: randomUUID(),
        expectedVersion: response.json().transaction.resourceVersion,
        patch: { ignored: true },
      },
    });
    const undone = await server.inject({
      method: 'PATCH',
      url: `/api/transactions/${tx.id}/review/undo`,
      headers: authHeaders(),
      payload: {
        ...response.json().undo,
        commandId: randomUUID(),
        expectedVersion: response.json().transaction.resourceVersion,
      },
    });
    expect(undone.statusCode).toBe(409);
    const current = await server.inject({
      method: 'GET',
      url: `/api/transactions/${tx.id}`,
      headers: authHeaders(),
    });
    expect(current.json().transaction).toMatchObject({
      needsReview: false,
      category: 'food',
      ignored: true,
    });
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

  it('keeps old-client reads and rejects unversioned writes', async () => {
    const account = insertAccount(testDb.db);
    const row = insertTransaction(testDb.db, account.id);
    for (const suffix of ['', '/resolve', '/owner', '/effective-date', '/ignore']) {
      const result = await server.inject({
        method: 'PATCH',
        url: `/api/transactions/${row.id}${suffix}`,
        headers: authHeaders(),
        payload: {},
      });
      expect(result.statusCode).toBe(426);
      expect(result.json().code).toBe('update_required');
    }
    const result = await server.inject({
      method: 'POST',
      url: `/api/transactions/${row.id}/commands`,
      headers: authHeaders(),
      payload: {
        commandId: '00000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        patch: { effectiveDate: '2026-08-31', ignored: true },
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().transaction).toMatchObject({
      resourceVersion: 2,
      reportingDate: '2026-08-31',
      date: row.date,
      ignored: true,
    });
    const replay = await server.inject({
      method: 'POST',
      url: `/api/transactions/${row.id}/commands`,
      headers: authHeaders(),
      payload: {
        commandId: '00000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        patch: { effectiveDate: '2026-08-31', ignored: true },
      },
    });
    expect(replay.json()).toEqual(result.json());
  });
});
