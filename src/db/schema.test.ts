import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction, insertCategory, insertAsset, insertHolding, insertLiability } from '../__tests__/helpers/fixtures.js';
import * as schema from './schema.js';

describe('database schema', () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  // ── Valid data insertion ──

  describe('table insertions', () => {
    it('accepts valid account data', () => {
      const account = insertAccount(testDb.db);
      expect(account.id).toBeGreaterThan(0);
      expect(account.companyId).toBe('hapoalim');
    });

    it('accepts valid transaction data', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);
      expect(tx.id).toBeGreaterThan(0);
      expect(tx.accountId).toBe(account.id);
    });

    it('accepts valid category data', () => {
      const cat = insertCategory(testDb.db, { name: 'custom', label: 'Custom' });
      expect(cat.id).toBeGreaterThan(0);
    });

    it('accepts valid asset data', () => {
      const asset = insertAsset(testDb.db);
      expect(asset.id).toBeGreaterThan(0);
    });

    it('accepts valid holding data', () => {
      const asset = insertAsset(testDb.db);
      const holding = insertHolding(testDb.db, asset.id);
      expect(holding.id).toBeGreaterThan(0);
      expect(holding.assetId).toBe(asset.id);
    });

    it('accepts valid liability data', () => {
      const liability = insertLiability(testDb.db);
      expect(liability.id).toBeGreaterThan(0);
    });
  });

  // ── Foreign key constraints ──

  describe('foreign key constraints', () => {
    it('rejects transaction with non-existent accountId', () => {
      expect(() => {
        insertTransaction(testDb.db, 999999);
      }).toThrow();
    });

    it('rejects holding with non-existent assetId', () => {
      expect(() => {
        insertHolding(testDb.db, 999999);
      }).toThrow();
    });

    it('rejects balance history with non-existent accountId', () => {
      expect(() => {
        testDb.db.insert(schema.accountBalanceHistory).values({
          accountId: 999999,
          date: '2026-01-01',
          balance: 5000,
        }).run();
      }).toThrow();
    });

    it('rejects asset snapshot with non-existent assetId', () => {
      expect(() => {
        testDb.db.insert(schema.assetSnapshots).values({
          assetId: 999999,
          date: '2026-01-01',
          totalValueIls: 10000,
        }).run();
      }).toThrow();
    });

    it('rejects scrape log with non-existent accountId', () => {
      expect(() => {
        testDb.db.insert(schema.scrapeLogs).values({
          accountId: 999999,
          status: 'success',
        }).run();
      }).toThrow();
    });
  });

  // ── Unique constraints ──

  describe('unique constraints', () => {
    it('enforces unique category name', () => {
      insertCategory(testDb.db, { name: 'unique-cat', label: 'Test' });
      expect(() => {
        insertCategory(testDb.db, { name: 'unique-cat', label: 'Test 2' });
      }).toThrow();
    });

    it('enforces unique asset name', () => {
      insertAsset(testDb.db, { name: 'Unique Asset' });
      expect(() => {
        insertAsset(testDb.db, { name: 'Unique Asset' });
      }).toThrow();
    });

    it('enforces unique liability name', () => {
      insertLiability(testDb.db, { name: 'Unique Liability' });
      expect(() => {
        insertLiability(testDb.db, { name: 'Unique Liability' });
      }).toThrow();
    });

    it('enforces unique transaction hash', () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { hash: 'same-hash' });
      expect(() => {
        insertTransaction(testDb.db, account.id, { hash: 'same-hash' });
      }).toThrow();
    });

    it('enforces unique holding name per asset', () => {
      const asset = insertAsset(testDb.db);
      insertHolding(testDb.db, asset.id, { name: 'Same Holding' });
      expect(() => {
        insertHolding(testDb.db, asset.id, { name: 'Same Holding' });
      }).toThrow();
    });

    it('allows same holding name across different assets', () => {
      const asset1 = insertAsset(testDb.db, { name: 'Asset 1' });
      const asset2 = insertAsset(testDb.db, { name: 'Asset 2' });
      insertHolding(testDb.db, asset1.id, { name: 'Cash' });
      const h2 = insertHolding(testDb.db, asset2.id, { name: 'Cash' });
      expect(h2.id).toBeGreaterThan(0);
    });

    it('enforces unique asset snapshot per asset+date', () => {
      const asset = insertAsset(testDb.db);
      testDb.db.insert(schema.assetSnapshots).values({
        assetId: asset.id, date: '2026-01-01', totalValueIls: 10000,
      }).run();
      expect(() => {
        testDb.db.insert(schema.assetSnapshots).values({
          assetId: asset.id, date: '2026-01-01', totalValueIls: 20000,
        }).run();
      }).toThrow();
    });

    it('enforces unique balance history per account+date', () => {
      const account = insertAccount(testDb.db);
      testDb.db.insert(schema.accountBalanceHistory).values({
        accountId: account.id, date: '2026-01-01', balance: 5000,
      }).run();
      expect(() => {
        testDb.db.insert(schema.accountBalanceHistory).values({
          accountId: account.id, date: '2026-01-01', balance: 6000,
        }).run();
      }).toThrow();
    });
  });

  // ── Cascade deletes ──

  describe('cascade deletes', () => {
    it('deletes holdings when asset is deleted', () => {
      const asset = insertAsset(testDb.db);
      insertHolding(testDb.db, asset.id, { name: 'Holding 1' });
      insertHolding(testDb.db, asset.id, { name: 'Holding 2' });

      const holdingsBefore = testDb.db.select().from(schema.holdings)
        .where(eq(schema.holdings.assetId, asset.id)).all();
      expect(holdingsBefore).toHaveLength(2);

      testDb.db.delete(schema.assets).where(eq(schema.assets.id, asset.id)).run();

      const holdingsAfter = testDb.db.select().from(schema.holdings)
        .where(eq(schema.holdings.assetId, asset.id)).all();
      expect(holdingsAfter).toHaveLength(0);
    });

    it('deletes asset snapshots when asset is deleted', () => {
      const asset = insertAsset(testDb.db);
      testDb.db.insert(schema.assetSnapshots).values({
        assetId: asset.id, date: '2026-01-01', totalValueIls: 10000,
      }).run();

      testDb.db.delete(schema.assets).where(eq(schema.assets.id, asset.id)).run();

      const snapshots = testDb.db.select().from(schema.assetSnapshots)
        .where(eq(schema.assetSnapshots.assetId, asset.id)).all();
      expect(snapshots).toHaveLength(0);
    });

    it('deletes asset movements when asset is deleted', () => {
      const asset = insertAsset(testDb.db);
      testDb.db.insert(schema.assetMovements).values({
        assetId: asset.id, date: '2026-01-01', type: 'deposit',
        quantity: 100, currency: 'ILS',
      }).run();

      testDb.db.delete(schema.assets).where(eq(schema.assets.id, asset.id)).run();

      const movements = testDb.db.select().from(schema.assetMovements)
        .where(eq(schema.assetMovements.assetId, asset.id)).all();
      expect(movements).toHaveLength(0);
    });

    it('sets linkedAccountId to null when linked account is deleted', () => {
      const account = insertAccount(testDb.db, { accountType: 'bank' });
      const asset = insertAsset(testDb.db, { linkedAccountId: account.id });
      expect(asset.linkedAccountId).toBe(account.id);

      testDb.db.delete(schema.accounts).where(eq(schema.accounts.id, account.id)).run();

      const updated = testDb.db.select().from(schema.assets)
        .where(eq(schema.assets.id, asset.id)).get();
      expect(updated!.linkedAccountId).toBeNull();
    });
  });

  // ── Default values ──

  describe('default values', () => {
    it('sets isActive to true by default for accounts', () => {
      const account = insertAccount(testDb.db);
      expect(account.isActive).toBe(true);
    });

    it('sets isActive to true by default for assets', () => {
      const asset = insertAsset(testDb.db);
      expect(asset.isActive).toBe(true);
    });

    it('sets isActive to true by default for liabilities', () => {
      const liability = insertLiability(testDb.db);
      expect(liability.isActive).toBe(true);
    });

    it('sets ignored to false by default for transactions', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);
      expect(tx.ignored).toBe(false);
    });

    it('sets needsReview to false by default for transactions', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);
      expect(tx.needsReview).toBe(false);
    });

    it('sets createdAt automatically', () => {
      const account = insertAccount(testDb.db);
      expect(account.createdAt).toBeDefined();
      expect(account.createdAt.length).toBeGreaterThan(0);
    });

    it('sets accountType to bank by default', () => {
      const account = testDb.db.insert(schema.accounts).values({
        companyId: 'hapoalim',
        displayName: 'Test',
        credentialsRef: 'ref',
      }).returning().get();
      expect(account.accountType).toBe('bank');
    });

    it('sets currency to ILS by default for liabilities', () => {
      const liability = testDb.db.insert(schema.liabilities).values({
        name: 'Test Liability',
        type: 'loan',
        originalAmount: 10000,
        currentBalance: 8000,
      }).returning().get();
      expect(liability.currency).toBe('ILS');
    });

    it('sets liquidity to liquid by default for assets', () => {
      const asset = insertAsset(testDb.db);
      expect(asset.liquidity).toBe('liquid');
    });

    it('sets ignoredFromStats to false by default for categories', () => {
      const cat = insertCategory(testDb.db);
      expect(cat.ignoredFromStats).toBe(false);
    });

    it('sets status to completed by default for transactions', () => {
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id);
      expect(tx.status).toBe('completed');
    });
  });
});
