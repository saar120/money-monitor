import { randomUUID } from 'node:crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

type Db = BetterSQLite3Database<typeof schema>;

let txCounter = 0;

export function insertAccount(db: Db, overrides: Partial<typeof schema.accounts.$inferInsert> = {}) {
  return db.insert(schema.accounts).values({
    companyId: 'hapoalim',
    displayName: 'Test Bank',
    credentialsRef: randomUUID(),
    accountType: 'bank',
    ...overrides,
  }).returning().get();
}

export function insertTransaction(db: Db, accountId: number, overrides: Partial<typeof schema.transactions.$inferInsert> = {}) {
  txCounter++;
  return db.insert(schema.transactions).values({
    accountId,
    date: '2026-01-15',
    processedDate: '2026-01-15',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: `Test Transaction ${txCounter}`,
    hash: overrides.hash ?? randomUUID(),
    ...overrides,
  }).returning().get();
}

export function insertCategory(db: Db, overrides: Partial<typeof schema.categories.$inferInsert> = {}) {
  return db.insert(schema.categories).values({
    name: overrides.name ?? `cat_${randomUUID().slice(0, 8)}`,
    label: 'Test Category',
    ...overrides,
  }).returning().get();
}

export function insertAsset(db: Db, overrides: Partial<typeof schema.assets.$inferInsert> = {}) {
  return db.insert(schema.assets).values({
    name: overrides.name ?? `Asset ${randomUUID().slice(0, 8)}`,
    type: 'brokerage',
    currency: 'ILS',
    ...overrides,
  }).returning().get();
}

export function insertHolding(db: Db, assetId: number, overrides: Partial<typeof schema.holdings.$inferInsert> = {}) {
  return db.insert(schema.holdings).values({
    assetId,
    name: overrides.name ?? `Holding ${randomUUID().slice(0, 8)}`,
    type: 'stock',
    currency: 'ILS',
    quantity: 10,
    costBasis: 1000,
    lastPrice: 110,
    ...overrides,
  }).returning().get();
}

export function insertLiability(db: Db, overrides: Partial<typeof schema.liabilities.$inferInsert> = {}) {
  return db.insert(schema.liabilities).values({
    name: overrides.name ?? `Liability ${randomUUID().slice(0, 8)}`,
    type: 'loan',
    currency: 'ILS',
    originalAmount: 100000,
    currentBalance: 80000,
    ...overrides,
  }).returning().get();
}

export function insertAssetSnapshot(db: Db, assetId: number, overrides: Partial<typeof schema.assetSnapshots.$inferInsert> = {}) {
  return db.insert(schema.assetSnapshots).values({
    assetId,
    date: '2026-01-01',
    totalValueIls: 10000,
    ...overrides,
  }).returning().get();
}

export function insertBalanceHistory(db: Db, accountId: number, overrides: Partial<typeof schema.accountBalanceHistory.$inferInsert> = {}) {
  return db.insert(schema.accountBalanceHistory).values({
    accountId,
    date: '2026-01-01',
    balance: 5000,
    ...overrides,
  }).returning().get();
}
