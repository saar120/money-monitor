import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';

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

const {
  commandTransaction,
  listTransactions,
  buildTransactionFilters,
  getNeedsReviewCount,
  categorizeTransaction,
} = await import('./transactions.js');

describe('transactions service', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  // ── listTransactions ──

  describe('listTransactions', () => {
    it('returns empty result with pagination metadata when no transactions', () => {
      const result = listTransactions({});
      expect(result.transactions).toHaveLength(0);
      expect(result.pagination).toEqual({ total: 0, offset: 0, limit: 50, hasMore: false });
    });

    it('returns transactions with default pagination', () => {
      const account = insertAccount(testDb.db);
      for (let i = 0; i < 3; i++) {
        insertTransaction(testDb.db, account.id, { description: `Tx ${i}` });
      }
      const result = listTransactions({});
      expect(result.transactions).toHaveLength(3);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('respects limit and offset for pagination', () => {
      const account = insertAccount(testDb.db);
      for (let i = 0; i < 5; i++) {
        insertTransaction(testDb.db, account.id, { description: `Tx ${i}` });
      }
      const page1 = listTransactions({}, { limit: 2, offset: 0 });
      expect(page1.transactions).toHaveLength(2);
      expect(page1.pagination).toEqual({ total: 5, offset: 0, limit: 2, hasMore: true });

      const page2 = listTransactions({}, { limit: 2, offset: 2 });
      expect(page2.transactions).toHaveLength(2);
      expect(page2.pagination.hasMore).toBe(true);

      const page3 = listTransactions({}, { limit: 2, offset: 4 });
      expect(page3.transactions).toHaveLength(1);
      expect(page3.pagination.hasMore).toBe(false);
    });

    it('filters by accountId', () => {
      const a1 = insertAccount(testDb.db, { displayName: 'Bank 1' });
      const a2 = insertAccount(testDb.db, { displayName: 'Bank 2' });
      insertTransaction(testDb.db, a1.id);
      insertTransaction(testDb.db, a2.id);

      const result = listTransactions({ accountId: a1.id });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].accountId).toBe(a1.id);
    });

    it('filters by accountType', () => {
      const bank = insertAccount(testDb.db, { accountType: 'bank', companyId: 'hapoalim' });
      const cc = insertAccount(testDb.db, { accountType: 'credit_card', companyId: 'max' });
      insertTransaction(testDb.db, bank.id, { description: 'Bank tx' });
      insertTransaction(testDb.db, cc.id, { description: 'CC tx' });

      const result = listTransactions({ accountType: 'bank' });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].description).toBe('Bank tx');
    });

    it('returns empty when accountType has no matching accounts', () => {
      const account = insertAccount(testDb.db, { accountType: 'bank' });
      insertTransaction(testDb.db, account.id);

      const result = listTransactions({ accountType: 'credit_card' });
      expect(result.transactions).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('filters by date range', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { date: '2026-01-01', processedDate: '2026-01-01' });
      insertTransaction(testDb.db, account.id, { date: '2026-02-01', processedDate: '2026-02-01' });
      insertTransaction(testDb.db, account.id, { date: '2026-03-01', processedDate: '2026-03-01' });

      const result = listTransactions({ startDate: '2026-01-15', endDate: '2026-02-15' });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].date).toBe('2026-02-01');
    });

    it('filters and sorts by reporting date', () => {
      const account = insertAccount(testDb.db);
      const moved = insertTransaction(testDb.db, account.id, {
        date: '2026-09-01',
        processedDate: '2026-09-01',
        effectiveDate: '2026-08-31',
      });
      insertTransaction(testDb.db, account.id, {
        date: '2026-08-15',
        processedDate: '2026-08-15',
      });

      const result = listTransactions(
        { startDate: '2026-08-01', endDate: '2026-08-31' },
        { sortBy: 'date', sortOrder: 'desc' },
      );

      expect(result.transactions.map((tx) => tx.id)).toEqual([moved.id, expect.any(Number)]);
      expect(result.transactions[0].reportingDate).toBe('2026-08-31');
    });

    it('filters by category', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { category: 'food' });
      insertTransaction(testDb.db, account.id, { category: 'transport' });

      const result = listTransactions({ category: 'food' });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].category).toBe('food');
    });

    it('filters by status', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { status: 'completed' });
      insertTransaction(testDb.db, account.id, { status: 'pending' });

      const result = listTransactions({ status: 'completed' });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].status).toBe('completed');
    });

    it('filters by needsReview', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { needsReview: true });
      insertTransaction(testDb.db, account.id, { needsReview: false });

      const result = listTransactions({ needsReview: true });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].needsReview).toBe(true);
    });

    it('filters by amount range', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { chargedAmount: -50 });
      insertTransaction(testDb.db, account.id, { chargedAmount: -150 });
      insertTransaction(testDb.db, account.id, { chargedAmount: -250 });

      const result = listTransactions({ minAmount: -200, maxAmount: -100 });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].chargedAmount).toBe(-150);
    });

    it('filters by search text', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { description: 'Grocery Store' });
      insertTransaction(testDb.db, account.id, { description: 'Gas Station' });

      const result = listTransactions({ search: 'Grocery' });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].description).toBe('Grocery Store');
    });

    it('sorts by different columns', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, {
        chargedAmount: -50,
        description: 'B Transaction',
        date: '2026-01-10',
        processedDate: '2026-01-10',
      });
      insertTransaction(testDb.db, account.id, {
        chargedAmount: -200,
        description: 'A Transaction',
        date: '2026-01-20',
        processedDate: '2026-01-20',
      });

      // Sort by chargedAmount desc
      const byAmount = listTransactions({}, { sortBy: 'chargedAmount', sortOrder: 'desc' });
      expect(byAmount.transactions[0].chargedAmount).toBe(-50);

      // Sort by description asc
      const byDesc = listTransactions({}, { sortBy: 'description', sortOrder: 'asc' });
      expect(byDesc.transactions[0].description).toBe('A Transaction');

      // Sort by date asc
      const byDate = listTransactions({}, { sortBy: 'date', sortOrder: 'asc' });
      expect(byDate.transactions[0].date).toBe('2026-01-10');
    });

    it('returns empty when search has no matches', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { description: 'Test' });

      const result = listTransactions({ search: 'nonexistentxyz' });
      expect(result.transactions).toHaveLength(0);
    });
  });

  // ── buildTransactionFilters ──

  describe('buildTransactionFilters', () => {
    it('returns empty conditions with no params', () => {
      const result = buildTransactionFilters({});
      expect(result.conditions).toHaveLength(0);
      expect(result.empty).toBe(false);
    });

    it('returns empty=true when accountType has no matching accounts', () => {
      // No accounts in DB at all for 'credit_card'
      const result = buildTransactionFilters({ accountType: 'credit_card' });
      expect(result.empty).toBe(true);
    });

    it('builds conditions for accountType with matching accounts', () => {
      insertAccount(testDb.db, { accountType: 'bank' });
      const result = buildTransactionFilters({ accountType: 'bank' });
      expect(result.empty).toBe(false);
      expect(result.conditions.length).toBeGreaterThan(0);
    });

    it('builds conditions for date range', () => {
      const result = buildTransactionFilters({ startDate: '2026-01-01', endDate: '2026-12-31' });
      expect(result.empty).toBe(false);
      expect(result.conditions).toHaveLength(2);
    });
  });

  // ── getNeedsReviewCount ──

  describe('getNeedsReviewCount', () => {
    it('returns 0 when no transactions need review', () => {
      expect(getNeedsReviewCount()).toBe(0);
    });

    it('counts transactions that need review', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { needsReview: true });
      insertTransaction(testDb.db, account.id, { needsReview: true });
      insertTransaction(testDb.db, account.id, { needsReview: false });

      expect(getNeedsReviewCount()).toBe(2);
    });
  });

  // ── categorizeTransaction ──

  describe('categorizeTransaction', () => {
    it('categorizes a transaction with high confidence', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      const result = categorizeTransaction({
        commandId: randomUUID(),
        expectedVersion: 1,
        transactionId: tx.id,
        category: 'food',
        confidence: 0.95,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.category).toBe('food');
      }
    });

    it('marks for review when confidence < 0.8', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      const result = categorizeTransaction({
        commandId: randomUUID(),
        expectedVersion: 1,
        transactionId: tx.id,
        category: 'food',
        confidence: 0.5,
        reviewReason: 'Low confidence',
      });
      expect(result.ok).toBe(true);

      // Verify the transaction was updated with needsReview
      const listed = listTransactions({ needsReview: true });
      const found = listed.transactions.find((t) => t.id === tx.id);
      expect(found).toBeDefined();
      expect(found!.needsReview).toBe(true);
      expect(found!.reviewReason).toBe('Low confidence');
    });

    it('uses default reviewReason when not provided and confidence is low', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      categorizeTransaction({
        commandId: randomUUID(),
        expectedVersion: 1,
        transactionId: tx.id,
        category: 'food',
        confidence: 0.3,
      });

      const listed = listTransactions({ needsReview: true });
      const found = listed.transactions.find((t) => t.id === tx.id);
      expect(found!.reviewReason).toBe('Low confidence categorization');
    });

    it('returns 404 for non-existent transaction', () => {
      const result = categorizeTransaction({
        commandId: randomUUID(),
        expectedVersion: 1,
        transactionId: 99999,
        category: 'food',
        confidence: 0.9,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
      }
    });

    it('does not set needsReview when confidence is exactly 0.8', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      categorizeTransaction({
        commandId: randomUUID(),
        expectedVersion: 1,
        transactionId: tx.id,
        category: 'food',
        confidence: 0.8,
      });

      expect(getNeedsReviewCount()).toBe(0);
    });

    it('handles undefined confidence', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);

      const result = categorizeTransaction({
        commandId: randomUUID(),
        expectedVersion: 1,
        transactionId: tx.id,
        category: 'food',
      });
      expect(result.ok).toBe(true);

      // Without confidence, needsReview should be false
      expect(getNeedsReviewCount()).toBe(0);
    });
  });
});

describe('atomic financial commands', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });
  it('replays a lost outcome, rejects ID reuse and stale edits, and validates before writing', () => {
    const account = insertAccount(testDb.db);
    const row = insertTransaction(testDb.db, account.id, { needsReview: true });
    const command = {
      commandId: '00000000-0000-4000-8000-000000000001',
      expectedVersion: 1,
      patch: { category: 'food', ignored: true, reviewed: true, owner: { type: 'shared' } },
    };
    const first = commandTransaction(row.id, command, 'device-a');
    expect(first.transaction).toMatchObject({
      resourceVersion: 2,
      category: 'food',
      ignored: true,
      needsReview: false,
      expenseOwnerType: 'shared',
      date: row.date,
    });
    expect(commandTransaction(row.id, command, 'device-a')).toEqual(first);
    expect(() =>
      commandTransaction(row.id, { ...command, patch: { ignored: false } }, 'device-a'),
    ).toThrow('command_id_reused');
    expect(() =>
      commandTransaction(
        row.id,
        { ...command, commandId: '00000000-0000-4000-8000-000000000002' },
        'device-b',
      ),
    ).toThrow('mutation_conflict');
    expect(() =>
      commandTransaction(
        row.id,
        {
          ...command,
          commandId: '00000000-0000-4000-8000-000000000003',
          expectedVersion: 2,
          patch: { category: 'food', owner: { type: 'member', memberId: 9999 } },
        },
        'device-a',
      ),
    ).toThrow('validation_error');
    expect(listTransactions({}).transactions[0]).toEqual(first.transaction);
    expect(testDb.sqlite.prepare('SELECT count(*) AS n FROM mutation_receipts').get()).toEqual({
      n: 1,
    });
  });
});
