import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertCategory, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';
import { mobileOverviewDataSchema, validateMobileOverviewEnvelope } from './overview-contract.js';
import { createMobileOverviewProvider } from './overview-production-ports.js';

describe('mobile overview projection', () => {
  const databases: TestDb[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it('calculates pace, category changes, budgets, and visit activity on the Mac', async () => {
    const testDb = createTestDb();
    databases.push(testDb);
    const account = insertAccount(testDb.db);
    insertCategory(testDb.db, { name: 'dining', label: 'Dining', color: '#9C5B67' });
    insertTransaction(testDb.db, account.id, {
      date: '2026-09-02',
      processedDate: '2026-09-02',
      chargedAmount: -300,
      category: 'dining',
      description: 'Wolt',
      needsReview: true,
      createdAt: '2026-09-08T08:00:00.000Z',
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-08-02',
      processedDate: '2026-08-02',
      chargedAmount: -220,
      category: 'dining',
      description: 'Wolt',
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-08-15',
      processedDate: '2026-08-15',
      chargedAmount: -50,
      category: 'dining',
      description: 'Old review item',
      needsReview: true,
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-09-20',
      processedDate: '2026-09-20',
      chargedAmount: -70,
      category: 'dining',
      description: 'Future review item',
      needsReview: true,
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-09-01',
      processedDate: '2026-09-01',
      chargedAmount: 1000,
      category: 'income',
      description: 'Salary',
    });
    testDb.db
      .insert(schema.budgets)
      .values({ name: 'Dining', amount: 800, categoryNames: '["dining"]' })
      .run();

    const provide = createMobileOverviewProvider({
      db: testDb.db,
      readNetWorth: () => ({ total: 1200, assetsTotal: 1500, liabilitiesTotal: 300 }),
      readNetWorthHistory: async () => [
        { date: '2026-08-01', total: 1100 },
        { date: '2026-09-01', total: 1200 },
      ],
    });
    const result = await provide(
      { since: '2026-09-08T07:00:00.000Z' },
      { generatedAt: '2026-09-08T10:00:00.000Z', financialDate: '2026-09-08' },
    );

    expect(mobileOverviewDataSchema.safeParse(result).success).toBe(true);
    expect(result.cashflow).toMatchObject({
      spending: { value: '300.00' },
      income: { value: '1000.00' },
      previousSpending: { value: '220.00' },
      paceDelta: { value: '80.00' },
      spendingVsIncomePercent: 30,
    });
    expect(result.categories[0]).toMatchObject({
      label: 'Dining',
      current: { value: '300.00' },
      delta: { value: '80.00' },
    });
    expect(result.budgets[0]).toMatchObject({ name: 'Dining', remaining: { value: '500.00' } });
    expect(result.reviewCount).toBe(2);
    expect(result.sinceLastVisit).toMatchObject({ transactions: 1, spent: { value: '300.00' } });
    expect(result.netWorth).toMatchObject({
      total: { value: '1200.00' },
      assets: { value: '1500.00' },
      liabilities: { value: '300.00' },
    });
  });

  it('nets categorized credits against category spending', async () => {
    const testDb = createTestDb();
    databases.push(testDb);
    const account = insertAccount(testDb.db);
    insertCategory(testDb.db, { name: 'holiday', label: 'Holiday' });
    insertTransaction(testDb.db, account.id, {
      date: '2026-09-03',
      processedDate: '2026-09-03',
      chargedAmount: -2868.72,
      category: 'holiday',
      description: 'Trip payments',
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-09-10',
      processedDate: '2026-09-10',
      chargedAmount: 1045.29,
      category: 'holiday',
      description: 'Friends paid me back',
    });

    const provide = createMobileOverviewProvider({
      db: testDb.db,
      readNetWorth: () => ({ total: 0, assetsTotal: 0, liabilitiesTotal: 0 }),
      readNetWorthHistory: async () => [],
    });
    const result = await provide(
      {},
      { generatedAt: '2026-09-12T10:00:00.000Z', financialDate: '2026-09-12' },
    );

    expect(result.categories.find((category) => category.name === 'holiday')).toMatchObject({
      current: { value: '1823.43' },
      delta: { value: '1823.43' },
    });
    expect(result.merchants.filter((merchant) => merchant.category === 'Holiday')).toHaveLength(2);
  });

  it('produces a safe public envelope for decimal ratios and numeric merchant references', async () => {
    const testDb = createTestDb();
    databases.push(testDb);
    const account = insertAccount(testDb.db);
    insertCategory(testDb.db, { name: 'dining', label: 'Dining', color: '#9C5B67' });
    insertTransaction(testDb.db, account.id, {
      date: '2026-09-02',
      processedDate: '2026-09-02',
      chargedAmount: -333,
      category: 'dining',
      description: '12345678/12/3490123456 Restaurant',
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-09-01',
      processedDate: '2026-09-01',
      chargedAmount: 1000,
      category: 'income',
      description: 'Salary',
    });
    testDb.db
      .insert(schema.budgets)
      .values({ name: 'Dining', amount: 800, categoryNames: '["dining"]' })
      .run();

    const provide = createMobileOverviewProvider({
      db: testDb.db,
      readNetWorth: () => ({ total: 1200, assetsTotal: 1500, liabilitiesTotal: 300 }),
      readNetWorthHistory: async () => [],
    });
    const data = await provide(
      {},
      { generatedAt: '2026-09-08T10:00:00.000Z', financialDate: '2026-09-08' },
    );

    const envelope = validateMobileOverviewEnvelope({
      data,
      meta: {
        apiVersion: '1',
        generatedAt: '2026-09-08T10:00:00.000Z',
        source: 'live',
        server: {
          id: '11111111-1111-4111-8111-111111111111',
          protocolVersion: 1,
        },
      },
    });

    expect(envelope).not.toBeNull();
    expect(data.cashflow.spendingVsIncomePercent).toBe(33);
    expect(data.budgets[0]).toMatchObject({ usedPercent: 42, elapsedPercent: 27 });
    expect(data.merchants[0]?.name).toBe('•••• 3456 Restaurant');
  });
});
