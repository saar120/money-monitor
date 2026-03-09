import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertLiability } from '../__tests__/helpers/fixtures.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() { return testDb.db; },
  get sqlite() { return testDb.sqlite; },
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

const { listLiabilities, createLiability, updateLiability, deactivateLiability } =
  await import('./liabilities.js');

describe('liabilities service', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  // ── listLiabilities ──

  describe('listLiabilities', () => {
    it('returns empty list when no liabilities', async () => {
      const result = await listLiabilities();
      expect(result).toHaveLength(0);
    });

    it('returns only active liabilities by default', async () => {
      insertLiability(testDb.db, { name: 'Active Loan', isActive: true });
      insertLiability(testDb.db, { name: 'Inactive Loan', isActive: false });

      const result = await listLiabilities();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Active Loan');
    });

    it('returns all liabilities when includeInactive is true', async () => {
      insertLiability(testDb.db, { name: 'Active', isActive: true });
      insertLiability(testDb.db, { name: 'Inactive', isActive: false });

      const result = await listLiabilities({ includeInactive: true });
      expect(result).toHaveLength(2);
    });

    it('includes currentBalanceIls with ILS conversion', async () => {
      insertLiability(testDb.db, { name: 'USD Loan', currency: 'USD', currentBalance: 1000 });

      const result = await listLiabilities();
      expect(result).toHaveLength(1);
      expect(result[0].currentBalanceIls).toBe(3600); // 1000 * 3.6
    });

    it('passes through ILS amounts unchanged', async () => {
      insertLiability(testDb.db, { name: 'ILS Loan', currency: 'ILS', currentBalance: 5000 });

      const result = await listLiabilities();
      expect(result[0].currentBalanceIls).toBe(5000);
    });
  });

  // ── createLiability ──

  describe('createLiability', () => {
    it('creates a liability and returns ok:true', async () => {
      const result = await createLiability({
        name: 'Mortgage', type: 'mortgage', currency: 'ILS',
        originalAmount: 500000, currentBalance: 400000,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.liability.name).toBe('Mortgage');
        expect(result.liability.currentBalance).toBe(400000);
        expect(result.liability.currentBalanceIls).toBe(400000);
      }
    });

    it('returns 409 for duplicate name', async () => {
      insertLiability(testDb.db, { name: 'Home Loan' });

      const result = await createLiability({
        name: 'Home Loan', type: 'loan', currency: 'ILS',
        originalAmount: 100000, currentBalance: 80000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.error).toContain('already exists');
      }
    });

    it('creates liability with optional fields', async () => {
      const result = await createLiability({
        name: 'Car Loan', type: 'loan', currency: 'ILS',
        originalAmount: 50000, currentBalance: 30000,
        interestRate: 4.5, startDate: '2025-01-01', notes: 'Car loan note',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.liability.interestRate).toBe(4.5);
        expect(result.liability.startDate).toBe('2025-01-01');
        expect(result.liability.notes).toBe('Car loan note');
      }
    });

    it('applies ILS conversion for USD liability', async () => {
      const result = await createLiability({
        name: 'USD Debt', type: 'loan', currency: 'USD',
        originalAmount: 10000, currentBalance: 8000,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.liability.currentBalanceIls).toBe(8000 * 3.6);
      }
    });
  });

  // ── updateLiability ──

  describe('updateLiability', () => {
    it('updates an existing liability', async () => {
      const liability = insertLiability(testDb.db, { name: 'My Loan', currentBalance: 50000 });
      const result = await updateLiability(liability.id, { currentBalance: 45000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.liability.currentBalance).toBe(45000);
      }
    });

    it('returns 404 for non-existent liability', async () => {
      const result = await updateLiability(99999, { currentBalance: 1000 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
      }
    });

    it('returns 409 when renaming to an existing name', async () => {
      insertLiability(testDb.db, { name: 'Loan A' });
      const loanB = insertLiability(testDb.db, { name: 'Loan B' });

      const result = await updateLiability(loanB.id, { name: 'Loan A' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.error).toContain('already exists');
      }
    });

    it('allows renaming to same name (no-op on name check)', async () => {
      const liability = insertLiability(testDb.db, { name: 'My Loan' });
      const result = await updateLiability(liability.id, { name: 'My Loan', currentBalance: 1000 });
      expect(result.ok).toBe(true);
    });

    it('updates multiple fields at once', async () => {
      const liability = insertLiability(testDb.db, { name: 'Old Name', notes: null });
      const result = await updateLiability(liability.id, { name: 'New Name', notes: 'Updated' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.liability.name).toBe('New Name');
        expect(result.liability.notes).toBe('Updated');
      }
    });
  });

  // ── deactivateLiability ──

  describe('deactivateLiability', () => {
    it('soft-deletes a liability', async () => {
      const liability = insertLiability(testDb.db, { name: 'To Deactivate' });
      const result = await deactivateLiability(liability.id);
      expect(result.ok).toBe(true);

      // Verify it's now inactive
      const list = await listLiabilities();
      expect(list.find(l => l.name === 'To Deactivate')).toBeUndefined();

      // But still exists when including inactive
      const allList = await listLiabilities({ includeInactive: true });
      const found = allList.find(l => l.name === 'To Deactivate');
      expect(found).toBeDefined();
      expect(found!.isActive).toBe(false);
    });

    it('returns 404 for non-existent liability', async () => {
      const result = await deactivateLiability(99999);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
      }
    });
  });
});
