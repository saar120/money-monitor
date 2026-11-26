import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import {
  insertCategory,
  insertAccount,
  insertTransaction,
  insertMember,
} from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';

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

const { listCategories, createCategory, updateCategory, deleteCategory } =
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
      const names = result.map((c) => c.name);
      expect(names).toContain('food');
      expect(names).toContain('transport');
    });
  });

  // ── createCategory ──

  describe('createCategory', () => {
    it('creates a category with optional fields and returns ok:true', () => {
      const result = createCategory({
        name: 'bills',
        label: 'Bills',
        color: '#ff0000',
        rules: 'electric|water',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.category).toMatchObject({
          name: 'bills',
          label: 'Bills',
          color: '#ff0000',
          rules: 'electric|water',
        });
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

    it('does not accept a member default owner without an explicit owner type', () => {
      const member = insertMember(testDb.db, { name: 'Saar' });

      const result = createCategory({
        name: 'personal',
        label: 'Personal',
        defaultOwnerMemberId: member.id,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
      }
    });
  });

  // ── updateCategory ──

  describe('updateCategory', () => {
    it('updates an existing category', () => {
      // 'food' is seeded with id=1
      const cats = listCategories();
      const foodCat = cats.find((c) => c.name === 'food')!;
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
      const foodCat = cats.find((c) => c.name === 'food')!;
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id, { category: 'food' });
      expect(tx.ignored).toBe(false);

      updateCategory(foodCat.id, { ignoredFromStats: true });

      // Check the transaction is now ignored
      const allTx = testDb.db.select().from(schema.transactions).all();
      const updated = allTx.find((t) => t.id === tx.id);
      expect(updated?.ignored).toBe(true);
    });

    it('does not modify transactions when ignoredFromStats is not in update', () => {
      const cats = listCategories();
      const foodCat = cats.find((c) => c.name === 'food')!;
      const account = insertAccount(testDb.db);
      const tx = insertTransaction(testDb.db, account.id, { category: 'food' });

      updateCategory(foodCat.id, { label: 'New Label' });

      const allTx = testDb.db.select().from(schema.transactions).all();
      const updated = allTx.find((t) => t.id === tx.id);
      expect(updated?.ignored).toBe(false);
    });

    it('preserves the category default owner when owner fields are omitted', () => {
      const member = insertMember(testDb.db, { name: 'Saar' });
      const category = insertCategory(testDb.db, {
        name: 'member-cat',
        label: 'Member Cat',
        defaultOwnerType: 'member',
        defaultOwnerMemberId: member.id,
      });

      const result = updateCategory(category.id, { label: 'Renamed' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ownerChanged).toBe(false);
        expect(result.category.defaultOwnerType).toBe('member');
        expect(result.category.defaultOwnerMemberId).toBe(member.id);
      }
    });

    it('does not turn an unassigned category into a member default from member id alone', () => {
      const member = insertMember(testDb.db, { name: 'Saar' });
      const foodCat = listCategories().find((c) => c.name === 'food')!;

      const result = updateCategory(foodCat.id, { defaultOwnerMemberId: member.id });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
      }

      const updated = listCategories().find((c) => c.name === 'food')!;
      expect(updated.defaultOwnerType).toBe('unassigned');
      expect(updated.defaultOwnerMemberId).toBeNull();
    });

    it('clears stale member ids when changing a category default to shared', () => {
      const member = insertMember(testDb.db, { name: 'Saar' });
      const category = insertCategory(testDb.db, {
        name: 'old-member-cat',
        label: 'Old Member Cat',
        defaultOwnerType: 'member',
        defaultOwnerMemberId: member.id,
      });

      const result = updateCategory(category.id, { defaultOwnerType: 'shared' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ownerChanged).toBe(true);
        expect(result.category.defaultOwnerType).toBe('shared');
        expect(result.category.defaultOwnerMemberId).toBeNull();
      }
    });
  });

  // ── deleteCategory ──

  describe('deleteCategory', () => {
    it('deletes an existing category', () => {
      const before = listCategories().length;
      const cats = listCategories();
      const foodCat = cats.find((c) => c.name === 'food')!;
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
});
