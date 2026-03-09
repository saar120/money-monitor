import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertLiability, insertAsset, insertHolding, insertBalanceHistory, insertAssetSnapshot } from '../__tests__/helpers/fixtures.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() { return testDb.db; },
  get sqlite() { return testDb.sqlite; },
  isDemoMode: () => false,
  closeAll: () => {},
}));

vi.mock('./exchange-rates.js', () => ({
  getExchangeRates: vi.fn().mockResolvedValue({ rates: { ILS: 1, USD: 3.6, EUR: 3.9 }, stale: false, fetchedAt: new Date().toISOString() }),
  convertToIls: vi.fn((amount: number, currency: string, rates: Record<string, number>) => {
    if (currency === 'ILS') return amount;
    const rate = rates[currency];
    if (rate === undefined) return 0;
    return amount * rate;
  }),
}));

const { generateDatePoints, getNetWorth } =
  await import('./net-worth.js');

describe('net-worth service', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  // ── generateDatePoints ──

  describe('generateDatePoints', () => {
    it('generates monthly date points', () => {
      const dates = generateDatePoints('2026-01-01', '2026-04-01', 'monthly');
      expect(dates).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    });

    it('generates daily date points', () => {
      const dates = generateDatePoints('2026-01-01', '2026-01-05', 'daily');
      expect(dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);
    });

    it('generates weekly date points', () => {
      const dates = generateDatePoints('2026-01-01', '2026-01-31', 'weekly');
      // 2026-01-01 is a Thursday. The code advances to the next Monday.
      // 2026-01-05 is Monday
      expect(dates.length).toBeGreaterThan(0);
      // Each date should be a Monday
      for (const d of dates) {
        const day = new Date(d + 'T00:00:00').getDay();
        expect(day).toBe(1); // Monday
      }
    });

    it('returns empty array when start > end', () => {
      const dates = generateDatePoints('2026-12-01', '2026-01-01', 'monthly');
      expect(dates).toHaveLength(0);
    });

    it('returns single date when start === end for daily', () => {
      const dates = generateDatePoints('2026-01-15', '2026-01-15', 'daily');
      expect(dates).toEqual(['2026-01-15']);
    });

    it('handles year boundary', () => {
      const dates = generateDatePoints('2025-11-01', '2026-02-01', 'monthly');
      expect(dates).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
    });
  });

  // ── getNetWorth ──

  describe('getNetWorth', () => {
    it('returns zero totals with empty DB', async () => {
      const result = await getNetWorth();
      expect(result.total).toBe(0);
      expect(result.liquidTotal).toBe(0);
      expect(result.banksTotal).toBe(0);
      expect(result.assetsTotal).toBe(0);
      expect(result.liabilitiesTotal).toBe(0);
      expect(result.banks).toHaveLength(0);
      expect(result.assets).toHaveLength(0);
      expect(result.liabilities).toHaveLength(0);
      expect(result.calculatedAt).toBeDefined();
    });

    it('sums bank balances', async () => {
      insertAccount(testDb.db, { displayName: 'Bank A', accountType: 'bank', balance: 10000, isActive: true });
      insertAccount(testDb.db, { displayName: 'Bank B', accountType: 'bank', balance: 20000, isActive: true });

      const result = await getNetWorth();
      expect(result.banksTotal).toBe(30000);
      expect(result.banks).toHaveLength(2);
      expect(result.total).toBe(30000);
    });

    it('excludes inactive bank accounts', async () => {
      insertAccount(testDb.db, { displayName: 'Active Bank', accountType: 'bank', balance: 10000, isActive: true });
      insertAccount(testDb.db, { displayName: 'Inactive Bank', accountType: 'bank', balance: 50000, isActive: false });

      const result = await getNetWorth();
      expect(result.banksTotal).toBe(10000);
      expect(result.banks).toHaveLength(1);
    });

    it('excludes credit card accounts from bank totals', async () => {
      insertAccount(testDb.db, { displayName: 'Bank', accountType: 'bank', balance: 10000, isActive: true });
      insertAccount(testDb.db, { displayName: 'Credit Card', accountType: 'credit_card', companyId: 'max', balance: -5000, isActive: true });

      const result = await getNetWorth();
      expect(result.banksTotal).toBe(10000);
      expect(result.banks).toHaveLength(1);
    });

    it('subtracts liabilities from total', async () => {
      insertAccount(testDb.db, { displayName: 'Bank', accountType: 'bank', balance: 100000, isActive: true });
      insertLiability(testDb.db, { name: 'Mortgage', currency: 'ILS', currentBalance: 40000, isActive: true });

      const result = await getNetWorth();
      expect(result.banksTotal).toBe(100000);
      expect(result.liabilitiesTotal).toBe(40000);
      expect(result.total).toBe(60000); // 100000 - 40000
    });

    it('converts liability currency to ILS', async () => {
      insertLiability(testDb.db, { name: 'USD Loan', currency: 'USD', currentBalance: 1000, isActive: true });

      const result = await getNetWorth();
      expect(result.liabilitiesTotal).toBe(3600); // 1000 * 3.6
    });

    it('excludes inactive liabilities', async () => {
      insertLiability(testDb.db, { name: 'Active', currency: 'ILS', currentBalance: 10000, isActive: true });
      insertLiability(testDb.db, { name: 'Inactive', currency: 'ILS', currentBalance: 50000, isActive: false });

      const result = await getNetWorth();
      expect(result.liabilitiesTotal).toBe(10000);
      expect(result.liabilities).toHaveLength(1);
    });

    it('includes exchange rates in response', async () => {
      const result = await getNetWorth();
      expect(result.exchangeRates).toBeDefined();
      expect(result.exchangeRates.ILS).toBe(1);
      expect(result.exchangeRates.USD).toBe(3.6);
    });

    it('handles bank with null balance', async () => {
      insertAccount(testDb.db, { displayName: 'No Balance', accountType: 'bank', balance: null, isActive: true });

      const result = await getNetWorth();
      expect(result.banksTotal).toBe(0);
      expect(result.banks[0].balance).toBe(0);
    });

    it('excludes inactive assets', async () => {
      insertAsset(testDb.db, { name: 'Active Asset', isActive: true });
      insertAsset(testDb.db, { name: 'Inactive Asset', isActive: false });

      const result = await getNetWorth();
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].name).toBe('Active Asset');
    });
  });
});
