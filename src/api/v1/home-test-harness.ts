import { createTestDb, type TestDb } from '../../__tests__/helpers/db.js';
import { accounts, budgets, categories, transactions } from '../../db/schema.js';
import { createCanonicalHarness, type CanonicalHarness } from './test-harness.js';

export type CanonicalHomeHarness = CanonicalHarness;

export async function createCanonicalHomeHarness(
  options: Parameters<typeof createCanonicalHarness>[0] = {},
): Promise<CanonicalHomeHarness> {
  const testDb: TestDb = createTestDb();
  testDb.db.insert(accounts).values({
    companyId: 'hapoalim',
    displayName: 'Checking',
    accountNumber: '1234',
    accountType: 'bank',
    balance: 8200,
    credentialsRef: 'fixture-credential-ref',
    lastScrapedAt: '2026-08-20 09:30:00',
  }).run();
  testDb.db.insert(categories).values({ name: 'Food', label: 'Food' }).run();
  testDb.db.insert(transactions).values([
    {
      accountId: 1,
      date: '2026-08-20',
      processedDate: '2026-08-20',
      originalAmount: -600,
      originalCurrency: 'ILS',
      chargedAmount: -600,
      chargedCurrency: 'ILS',
      description: 'Food fixture',
      category: 'Food',
      hash: 'home-food-current',
    },
    {
      accountId: 1,
      date: '2026-08-05',
      processedDate: '2026-08-05',
      originalAmount: -600,
      originalCurrency: 'ILS',
      chargedAmount: -600,
      chargedCurrency: 'ILS',
      description: 'Second food fixture',
      category: 'Food',
      hash: 'home-food-current-2',
    },
    {
      accountId: 1,
      date: '2026-07-05',
      processedDate: '2026-07-05',
      originalAmount: -900,
      originalCurrency: 'ILS',
      chargedAmount: -900,
      chargedCurrency: 'ILS',
      description: 'Food comparison fixture',
      category: 'Food',
      hash: 'home-food-comparison',
    },
    {
      accountId: 1,
      date: '2026-08-10',
      processedDate: '2026-08-10',
      originalAmount: 5000,
      originalCurrency: 'ILS',
      chargedAmount: 5000,
      chargedCurrency: 'ILS',
      description: 'Salary fixture',
      hash: 'home-income-current',
    },
  ]).run();
  testDb.db.insert(budgets).values({
    name: 'Monthly essentials',
    amount: 2000,
    period: 'monthly',
    categoryNames: JSON.stringify(['Food']),
    alertThreshold: 80,
  }).run();

  try {
    const harness = await createCanonicalHarness({ ...options, sqlite: testDb.sqlite });
    const originalClose = harness.close;
    harness.close = async () => {
      await originalClose();
      testDb.close();
    };
    return harness;
  } catch (error) {
    testDb.close();
    throw error;
  }
}
