import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
}));

const { getBudgetProgress, manageBudget } = await import('./budget-tools.js');

function insertBudget(overrides: Partial<typeof schema.budgets.$inferInsert> = {}) {
  return testDb.db
    .insert(schema.budgets)
    .values({
      name: 'Test Budget',
      amount: 1000,
      period: 'monthly',
      categoryNames: JSON.stringify(['food']),
      alertThreshold: 80,
      alertEnabled: true,
      ...overrides,
    })
    .returning()
    .get();
}

describe('getBudgetProgress', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('returns all active budgets with progress when no budget_id given', async () => {
    insertBudget({ name: 'Food Budget' });
    insertBudget({ name: 'Inactive', isActive: false });

    const result = JSON.parse(await getBudgetProgress({}));
    expect(result).toHaveLength(1);
    expect(result[0].budget.name).toBe('Food Budget');
    expect(result[0]).toHaveProperty('spent');
    expect(result[0]).toHaveProperty('percentage');
    expect(result[0]).toHaveProperty('remaining');
  });

  it('returns single budget progress when budget_id given', async () => {
    const budget = insertBudget({ name: 'Transport' });

    const result = JSON.parse(await getBudgetProgress({ budget_id: budget.id }));
    expect(result.budget.name).toBe('Transport');
    expect(result.spent).toBe(0);
    expect(result.percentage).toBe(0);
    expect(result.remaining).toBe(1000);
  });

  it('returns error for non-existent budget_id', async () => {
    const result = JSON.parse(await getBudgetProgress({ budget_id: 999 }));
    expect(result).toEqual({ error: 'Budget not found' });
  });

  it('returns monthly breakdown for yearly budget with monthly_view', async () => {
    const account = insertAccount(testDb.db);
    const budget = insertBudget({
      name: 'Annual Food',
      amount: 12000,
      period: 'yearly',
      categoryNames: JSON.stringify(['food']),
    });

    insertTransaction(testDb.db, account.id, {
      date: '2026-01-15',
      chargedAmount: -200,
      category: 'food',
    });

    const result = JSON.parse(
      await getBudgetProgress({ budget_id: budget.id, monthly_view: true }),
    );
    expect(result.budget.name).toBe('Annual Food');
    expect(result.spent).toBe(200);
    expect(result.monthlyView).toBeDefined();
    expect(result.monthlyView.monthlyBudget).toBe(1000);
    expect(result.monthlyView.breakdown).toBeInstanceOf(Array);
  });

  it('returns past month progress with reference_date', async () => {
    const account = insertAccount(testDb.db);
    const budget = insertBudget({
      name: 'Food',
      amount: 500,
      period: 'monthly',
      categoryNames: JSON.stringify(['food']),
    });

    // Transaction in March 2026
    insertTransaction(testDb.db, account.id, {
      date: '2026-03-10',
      chargedAmount: -150,
      category: 'food',
    });

    // Query March specifically
    const result = JSON.parse(
      await getBudgetProgress({ budget_id: budget.id, reference_date: '2026-03-15' }),
    );
    expect(result.spent).toBe(150);
    expect(result.period.startDate).toBe('2026-03-01');
    expect(result.period.endDate).toBe('2026-03-31');
  });
});

describe('manageBudget', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  // ── create ──

  it('creates a budget with required fields', async () => {
    const result = JSON.parse(
      await manageBudget({
        action: 'create',
        name: 'Food',
        amount: 500,
        category_names: ['food', 'groceries'],
      }),
    );
    expect(result.name).toBe('Food');
    expect(result.amount).toBe(500);
    expect(result.categoryNames).toEqual(['food', 'groceries']);
    expect(result.period).toBe('monthly');
    expect(result.alertThreshold).toBe(80);
  });

  it('creates a budget with optional fields', async () => {
    const result = JSON.parse(
      await manageBudget({
        action: 'create',
        name: 'Yearly Transport',
        amount: 6000,
        category_names: ['transport'],
        period: 'yearly',
        alert_threshold: 90,
        alert_enabled: false,
        color: '#FF5733',
      }),
    );
    expect(result.period).toBe('yearly');
    expect(result.alertThreshold).toBe(90);
    expect(result.alertEnabled).toBe(false);
    expect(result.color).toBe('#FF5733');
  });

  it('returns error when create is missing required fields', async () => {
    const result = JSON.parse(await manageBudget({ action: 'create', name: 'Food' }));
    expect(result.error).toContain('amount');
  });

  it('returns error when create has empty category_names', async () => {
    const result = JSON.parse(
      await manageBudget({
        action: 'create',
        name: 'Food',
        amount: 500,
        category_names: [],
      }),
    );
    expect(result.error).toContain('category');
  });

  // ── update ──

  it('updates a budget', async () => {
    const budget = insertBudget({ name: 'Old Name' });

    const result = JSON.parse(
      await manageBudget({
        action: 'update',
        budget_id: budget.id,
        name: 'New Name',
        amount: 2000,
      }),
    );
    expect(result.name).toBe('New Name');
    expect(result.amount).toBe(2000);
  });

  it('returns error when update is missing budget_id', async () => {
    const result = JSON.parse(await manageBudget({ action: 'update', name: 'New Name' }));
    expect(result.error).toContain('budget_id');
  });

  it('returns error when updating non-existent budget', async () => {
    const result = JSON.parse(await manageBudget({ action: 'update', budget_id: 999, name: 'X' }));
    expect(result.error).toContain('not found');
  });

  // ── delete ──

  it('deletes a budget', async () => {
    const budget = insertBudget();

    const result = JSON.parse(await manageBudget({ action: 'delete', budget_id: budget.id }));
    expect(result.success).toBe(true);
  });

  it('returns error when delete is missing budget_id', async () => {
    const result = JSON.parse(await manageBudget({ action: 'delete' }));
    expect(result.error).toContain('budget_id');
  });

  it('returns error when deleting non-existent budget', async () => {
    const result = JSON.parse(await manageBudget({ action: 'delete', budget_id: 999 }));
    expect(result.error).toContain('not found');
  });

  // ── unknown action ──

  it('returns error for unknown action', async () => {
    const result = JSON.parse(await manageBudget({ action: 'archive' } as any));
    expect(result.error).toContain('Unknown action');
  });
});
