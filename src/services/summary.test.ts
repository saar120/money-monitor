import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction, insertCategory } from '../__tests__/helpers/fixtures.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() { return testDb.db; },
  get sqlite() { return testDb.sqlite; },
}));

const { getSpendingSummary, comparePeriods, getTopMerchants } =
  await import('./summary.js');

describe('summary service', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  // ── getSpendingSummary ──

  describe('getSpendingSummary', () => {
    it('returns empty summary when no transactions', () => {
      const result = getSpendingSummary({}, 'category');
      expect(result.groupBy).toBe('category');
      expect(result.summary).toHaveLength(0);
    });

    it('groups by category', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { category: 'food', chargedAmount: -100 });
      insertTransaction(testDb.db, account.id, { category: 'food', chargedAmount: -50 });
      insertTransaction(testDb.db, account.id, { category: 'transport', chargedAmount: -30 });

      const result = getSpendingSummary({}, 'category');
      expect(result.groupBy).toBe('category');
      expect(result.summary.length).toBeGreaterThanOrEqual(2);

      const food = (result.summary as any[]).find(s => s.category === 'food');
      expect(food).toBeDefined();
      expect(food.totalAmount).toBe(-150);
      expect(food.transactionCount).toBe(2);
    });

    it('groups by month', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', chargedAmount: -100 });
      insertTransaction(testDb.db, account.id, { date: '2026-02-15', processedDate: '2026-02-15', chargedAmount: -200 });

      const result = getSpendingSummary({}, 'month');
      expect(result.groupBy).toBe('month');
      expect(result.summary).toHaveLength(2);

      const jan = (result.summary as any[]).find(s => s.month === '2026-01');
      expect(jan).toBeDefined();
      expect(jan.totalAmount).toBe(-100);
    });

    it('groups by account', () => {
      const a1 = insertAccount(testDb.db, { displayName: 'Bank A' });
      const a2 = insertAccount(testDb.db, { displayName: 'Bank B' });
      insertTransaction(testDb.db, a1.id, { chargedAmount: -100 });
      insertTransaction(testDb.db, a2.id, { chargedAmount: -200 });

      const result = getSpendingSummary({}, 'account');
      expect(result.groupBy).toBe('account');
      expect(result.summary).toHaveLength(2);

      const bankA = (result.summary as any[]).find(s => s.displayName === 'Bank A');
      expect(bankA).toBeDefined();
      expect(bankA.totalAmount).toBe(-100);
    });

    it('groups by cashflow showing income and expense', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', chargedAmount: 5000 });
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', chargedAmount: -2000 });
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', chargedAmount: -1000 });

      const result = getSpendingSummary({}, 'cashflow');
      expect(result.groupBy).toBe('cashflow');
      expect(result.summary).toHaveLength(1);

      const jan = result.summary[0] as { month: string; income: number; expense: number };
      expect(jan.month).toBe('2026-01');
      expect(jan.income).toBe(5000);
      expect(jan.expense).toBe(3000);
    });

    it('excludes ignored transactions', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { category: 'food', chargedAmount: -100, ignored: false });
      insertTransaction(testDb.db, account.id, { category: 'food', chargedAmount: -50, ignored: true });

      const result = getSpendingSummary({}, 'category');
      const food = (result.summary as any[]).find(s => s.category === 'food');
      expect(food).toBeDefined();
      expect(food.totalAmount).toBe(-100);
      expect(food.transactionCount).toBe(1);
    });

    it('returns empty when accountType has no matching accounts', () => {
      const account = insertAccount(testDb.db, { accountType: 'bank' });
      insertTransaction(testDb.db, account.id, { chargedAmount: -100 });

      const result = getSpendingSummary({ accountType: 'credit_card' }, 'category');
      expect(result.summary).toHaveLength(0);
    });

    it('treats uncategorized transactions as "uncategorized"', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { category: null, chargedAmount: -100 });

      const result = getSpendingSummary({}, 'category');
      const uncategorized = (result.summary as any[]).find(s => s.category === 'uncategorized');
      expect(uncategorized).toBeDefined();
      expect(uncategorized.totalAmount).toBe(-100);
    });

    it('filters by date range', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', chargedAmount: -100 });
      insertTransaction(testDb.db, account.id, { date: '2026-03-15', processedDate: '2026-03-15', chargedAmount: -200 });

      const result = getSpendingSummary({ startDate: '2026-01-01', endDate: '2026-01-31' }, 'category');
      const total = (result.summary as any[]).reduce((sum: number, s: any) => sum + s.totalAmount, 0);
      expect(total).toBe(-100);
    });
  });

  // ── comparePeriods ──

  describe('comparePeriods', () => {
    it('calculates change amounts and percentages', () => {
      const account = insertAccount(testDb.db);
      // Period 1: Jan
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', category: 'food', chargedAmount: -100 });
      // Period 2: Feb (higher spending)
      insertTransaction(testDb.db, account.id, { date: '2026-02-15', processedDate: '2026-02-15', category: 'food', chargedAmount: -150 });

      const result = comparePeriods({
        period1Start: '2026-01-01', period1End: '2026-01-31',
        period2Start: '2026-02-01', period2End: '2026-02-28',
      });

      expect(result.comparison).toHaveLength(1);
      const food = result.comparison[0];
      expect(food.category).toBe('food');
      expect(food.period1_total).toBe(-100);
      expect(food.period2_total).toBe(-150);
      expect(food.change_amount).toBe(-50); // -150 - (-100) = -50
      expect(food.change_percent).toBe(-50); // -50 / abs(-100) * 100 = -50%

      expect(result.summary.period1.total).toBe(-100);
      expect(result.summary.period2.total).toBe(-150);
      expect(result.summary.change_amount).toBe(-50);
    });

    it('handles categories appearing in only one period', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', category: 'food', chargedAmount: -100 });
      insertTransaction(testDb.db, account.id, { date: '2026-02-15', processedDate: '2026-02-15', category: 'transport', chargedAmount: -50 });

      const result = comparePeriods({
        period1Start: '2026-01-01', period1End: '2026-01-31',
        period2Start: '2026-02-01', period2End: '2026-02-28',
      });

      expect(result.comparison).toHaveLength(2);
      const food = result.comparison.find(c => c.category === 'food');
      expect(food!.period1_total).toBe(-100);
      expect(food!.period2_total).toBe(0);

      const transport = result.comparison.find(c => c.category === 'transport');
      expect(transport!.period1_total).toBe(0);
      expect(transport!.period2_total).toBe(-50);
      // change_percent is null when period1 total is 0
      expect(transport!.change_percent).toBeNull();
    });

    it('excludes ignored transactions', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', category: 'food', chargedAmount: -100, ignored: false });
      insertTransaction(testDb.db, account.id, { date: '2026-01-15', processedDate: '2026-01-15', category: 'food', chargedAmount: -50, ignored: true });

      const result = comparePeriods({
        period1Start: '2026-01-01', period1End: '2026-01-31',
        period2Start: '2026-02-01', period2End: '2026-02-28',
      });

      expect(result.summary.period1.total).toBe(-100);
    });

    it('returns empty comparison when no transactions in either period', () => {
      const result = comparePeriods({
        period1Start: '2026-01-01', period1End: '2026-01-31',
        period2Start: '2026-02-01', period2End: '2026-02-28',
      });

      expect(result.comparison).toHaveLength(0);
      expect(result.summary.period1.total).toBe(0);
      expect(result.summary.period2.total).toBe(0);
      expect(result.summary.change_amount).toBe(0);
      expect(result.summary.change_percent).toBeNull();
    });
  });

  // ── getTopMerchants ──

  describe('getTopMerchants', () => {
    it('ranks merchants by total amount (descending)', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { description: 'Supermarket A', chargedAmount: -200, status: 'completed' });
      insertTransaction(testDb.db, account.id, { description: 'Supermarket A', chargedAmount: -100, status: 'completed' });
      insertTransaction(testDb.db, account.id, { description: 'Gas Station B', chargedAmount: -50, status: 'completed' });

      const result = getTopMerchants({});
      expect(result.top_merchants.length).toBeGreaterThanOrEqual(2);

      // Sort is b.total_amount - a.total_amount (descending), so -50 > -300 means Gas Station first
      const supermarket = result.top_merchants.find(m => m.merchant === 'Supermarket A');
      expect(supermarket).toBeDefined();
      expect(supermarket!.total_amount).toBe(-300);
      expect(supermarket!.transaction_count).toBe(2);

      const gas = result.top_merchants.find(m => m.merchant === 'Gas Station B');
      expect(gas).toBeDefined();
      expect(gas!.total_amount).toBe(-50);
    });

    it('normalizes descriptions (strips trailing numbers)', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { description: 'Coffee Shop 12345', chargedAmount: -20, status: 'completed' });
      insertTransaction(testDb.db, account.id, { description: 'Coffee Shop 67890', chargedAmount: -25, status: 'completed' });

      const result = getTopMerchants({});
      const coffee = result.top_merchants.find(m => m.merchant === 'Coffee Shop');
      expect(coffee).toBeDefined();
      expect(coffee!.transaction_count).toBe(2);
    });

    it('respects limit parameter', () => {
      const account = insertAccount(testDb.db);
      for (let i = 0; i < 5; i++) {
        insertTransaction(testDb.db, account.id, { description: `Store ${i}`, chargedAmount: -(i + 1) * 10, status: 'completed' });
      }

      const result = getTopMerchants({ limit: 3 });
      expect(result.top_merchants).toHaveLength(3);
    });

    it('excludes ignored transactions', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { description: 'Store A', chargedAmount: -100, status: 'completed', ignored: false });
      insertTransaction(testDb.db, account.id, { description: 'Store B', chargedAmount: -200, status: 'completed', ignored: true });

      const result = getTopMerchants({});
      const storeB = result.top_merchants.find(m => m.merchant === 'Store B');
      expect(storeB).toBeUndefined();
    });

    it('filters by date range', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { description: 'Store', chargedAmount: -100, date: '2026-01-15', processedDate: '2026-01-15', status: 'completed' });
      insertTransaction(testDb.db, account.id, { description: 'Store', chargedAmount: -200, date: '2026-03-15', processedDate: '2026-03-15', status: 'completed' });

      const result = getTopMerchants({ startDate: '2026-01-01', endDate: '2026-01-31' });
      expect(result.top_merchants).toHaveLength(1);
      expect(result.top_merchants[0].total_amount).toBe(-100);
    });

    it('sorts by count when specified', () => {
      const account = insertAccount(testDb.db);
      // Store A: 1 tx, high amount
      insertTransaction(testDb.db, account.id, { description: 'Store A', chargedAmount: -500, status: 'completed' });
      // Store B: 3 tx, lower total
      for (let i = 0; i < 3; i++) {
        insertTransaction(testDb.db, account.id, { description: 'Store B', chargedAmount: -10, status: 'completed' });
      }

      const result = getTopMerchants({ sortBy: 'count' });
      expect(result.top_merchants[0].merchant).toBe('Store B');
    });

    it('returns period info when date range is specified', () => {
      const result = getTopMerchants({ startDate: '2026-01-01', endDate: '2026-12-31' });
      expect(result.period).toEqual({ start_date: '2026-01-01', end_date: '2026-12-31' });
    });

    it('returns all_time when no date range', () => {
      const result = getTopMerchants({});
      expect(result.period).toBe('all_time');
    });
  });
});
