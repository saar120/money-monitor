import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertCategory, insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() { return testDb.db; },
  get sqlite() { return testDb.sqlite; },
}));

const { listCategories, createCategory, updateCategory, deleteCategory, isCategoryIgnored } =
  await import('./categories.js');

describe('categories service', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  // ── listCategories ──

  describe('listCategories', () => {
    it('returns seeded categories from migrations', () => {
      const result = listCategories();
      // Migration 0002 seeds 12 categories
      expect(result.length).toBeGreaterThanOrEqual(12);
      const names = result.map(c => c.name);
      expect(names).toContain('food');
      expect(names).toContain('transport');
    });

    it('returns newly inserted categories alongside seeded ones', () => {
      const before = listCategories().length;
      insertCategory(testDb.db, { name: 'custom-cat', label: 'Custom' });
      const after = listCategories();
      expect(after).toHaveLength(before + 1);
      expect(after.map(c => c.name)).toContain('custom-cat');
    });
  });

  // ── createCategory ──

  describe('createCategory', () => {
    it('creates a category and returns ok:true', () => {
      const result = createCategory({ name: 'groceries', label: 'Groceries' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.category.name).toBe('groceries');
        expect(result.category.label).toBe('Groceries');
        expect(result.category.id).toBeGreaterThan(0);
      }
    });

    it('returns ok:false with status 409 for duplicate name', () => {
      // 'food' already seeded by migration
      const result = createCategory({ name: 'food', label: 'Food again' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.error).toContain('already exists');
      }
    });

    it('returns 409 when creating duplicate of a newly created category', () => {
      createCategory({ name: 'new-cat', label: 'New' });
      const result = createCategory({ name: 'new-cat', label: 'New again' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
      }
    });

    it('creates category with optional color and rules', () => {
      const result = createCategory({ name: 'bills', label: 'Bills', color: '#ff0000', rules: 'electric|water' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.category.color).toBe('#ff0000');
        expect(result.category.rules).toBe('electric|water');
      }
    });
  });

  // ── updateCategory ──

  describe('updateCategory', () => {
    it('updates an existing category', () => {
      // 'food' is seeded with id=1
      const cats = listCategories();
      const foodCat = cats.find(c => c.name === 'food')!;
      const result = updateCategory(foodCat.id, { label: 'Food & Drink' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.category.label).toBe('Food & Drink');
      }
    });

    it('returns 404 for non-existent category', () => {
      const result = updateCategory(99999, { label: 'Nope' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
      }
    });

    it('propagates ignoredFromStats change to transactions', () => {
      const cats = listCategories();
      const foodCat = cats.find(c => c.name === 'food')!;
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id, { category: 'food' });
      expect(tx.ignored).toBe(false);

      updateCategory(foodCat.id, { ignoredFromStats: true });

      // Check the transaction is now ignored
      const allTx = testDb.db.select().from(schema.transactions).all();
      const updated = allTx.find(t => t.id === tx.id);
      expect(updated?.ignored).toBe(true);
    });

    it('does not modify transactions when ignoredFromStats is not in update', () => {
      const cats = listCategories();
      const foodCat = cats.find(c => c.name === 'food')!;
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id, { category: 'food' });

      updateCategory(foodCat.id, { label: 'New Label' });

      const allTx = testDb.db.select().from(schema.transactions).all();
      const updated = allTx.find(t => t.id === tx.id);
      expect(updated?.ignored).toBe(false);
    });
  });

  // ── deleteCategory ──

  describe('deleteCategory', () => {
    it('deletes an existing category', () => {
      const before = listCategories().length;
      const cats = listCategories();
      const foodCat = cats.find(c => c.name === 'food')!;
      const result = deleteCategory(foodCat.id);
      expect(result.ok).toBe(true);
      expect(listCategories()).toHaveLength(before - 1);
    });

    it('returns 404 for non-existent category', () => {
      const result = deleteCategory(99999);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
      }
    });
  });

  // ── isCategoryIgnored ──

  describe('isCategoryIgnored', () => {
    it('returns false for null category', () => {
      expect(isCategoryIgnored(null)).toBe(false);
    });

    it('returns false for non-existent category', () => {
      expect(isCategoryIgnored('nonexistent')).toBe(false);
    });

    it('returns false for category with ignoredFromStats=false', () => {
      // seeded 'food' has ignoredFromStats=false by default
      expect(isCategoryIgnored('food')).toBe(false);
    });

    it('returns true for category with ignoredFromStats=true', () => {
      insertCategory(testDb.db, { name: 'internal', label: 'Internal', ignoredFromStats: true });
      expect(isCategoryIgnored('internal')).toBe(true);
    });
  });
});
