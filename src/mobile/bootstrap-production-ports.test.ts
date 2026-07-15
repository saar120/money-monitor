import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertCategory, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';
import {
  createMobileBootstrapAdapter,
  MobileBootstrapSectionReadError,
} from './bootstrap-adapter.js';
import {
  createProductionMobileBootstrapPorts,
  financialDateInIsrael,
  maskAccountIdentifier,
} from './bootstrap-production-ports.js';

const KEY = 'production-mobile-public-id-key-32-chars-minimum';
const CONTEXT = {
  calculatedAt: '2026-07-15T10:00:00.000Z',
  financialDate: '2026-07-15',
} as const;

describe('production mobile bootstrap ports', () => {
  const databases: TestDb[] = [];

  function database() {
    const value = createTestDb();
    databases.push(value);
    return value.db;
  }

  afterEach(() => databases.splice(0).forEach((value) => value.close()));

  it('produces a valid complete bootstrap for an empty database', async () => {
    const db = database();
    const ports = createProductionMobileBootstrapPorts({
      db,
      publicIdKey: KEY,
      readNetWorthIls: () => 0,
    });
    const instants = [new Date(CONTEXT.calculatedAt), new Date('2026-07-15T10:00:01.000Z')];
    const provide = createMobileBootstrapAdapter({
      ports,
      server: {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Money Monitor Mac',
        serverVersion: '0.3.5',
        minimumClientVersion: '0.1.0',
      },
      fallbackCurrencyCode: 'ILS',
      clock: () => instants.shift() ?? new Date('2026-07-15T10:00:01.000Z'),
      financialDateFor: financialDateInIsrael,
      snapshotIdFactory: () => 'snapshot_production_empty',
    });

    const result = await provide();

    expect(result.meta.completeness.status).toBe('complete');
    expect(result.data.home.aggregates.netWorth.amount.value).toBe('0.00');
    expect(result.data.budgetPulse.status).toBe('unavailable');
    expect(result.data.review.count).toBe(0);
    expect(result.data.recentTransactions).toEqual([]);
    expect(result.data.accounts).toEqual([]);
    expect(result.data.latestSync.status).toBe('never_run');
  });

  it('projects populated tables through masks, opaque IDs, decimal strings, and safe sync counts', async () => {
    const db = database();
    const account = insertAccount(db, {
      memberId: 1,
      companyId: 'hapoalim',
      displayName: 'Primary Account',
      accountNumber: '123-4567890123456',
      credentialsRef: 'FORBIDDEN_SECRET_SENTINEL',
      lastScrapedAt: '2026-07-15T09:30:00.000Z',
      stalenessDays: 2,
    });
    insertCategory(db, { name: 'groceries', label: 'Groceries' });
    const transaction = insertTransaction(db, account.id, {
      date: '2026-07-15',
      processedDate: '2026-07-15',
      chargedAmount: -125.5,
      originalAmount: -125.5,
      originalCurrency: 'EUR',
      chargedCurrency: 'USD',
      description: 'Neighborhood Market',
      category: 'groceries',
      needsReview: true,
      status: 'completed',
    });
    db.insert(schema.budgets)
      .values({
        name: 'Groceries',
        amount: 1000,
        categoryNames: '["groceries"]',
        alertThreshold: 80,
      })
      .run();
    const session = db
      .insert(schema.scrapeSessions)
      .values({
        trigger: 'scheduled',
        status: 'completed',
        accountIds: JSON.stringify([account.id]),
        startedAt: '2026-07-15T09:29:00.000Z',
        completedAt: '2026-07-15T09:30:00.000Z',
      })
      .returning()
      .get();
    db.insert(schema.scrapeLogs)
      .values({
        accountId: account.id,
        sessionId: session.id,
        status: 'success',
        startedAt: '2026-07-15T09:29:00.000Z',
        completedAt: '2026-07-15T09:30:00.000Z',
      })
      .run();

    const ports = createProductionMobileBootstrapPorts({
      db,
      publicIdKey: KEY,
      readNetWorthIls: () => 250000.275,
    });
    const firstTransactions = await ports.readRecentTransactions(CONTEXT);
    const secondTransactions = await ports.readRecentTransactions(CONTEXT);
    const accounts = await ports.readAccounts(CONTEXT);
    const home = await ports.readHome(CONTEXT);
    const budget = await ports.readBudgetPulse(CONTEXT);
    const review = await ports.readReview(CONTEXT);
    const latestSync = await ports.readLatestSync(CONTEXT);

    expect(firstTransactions).toEqual(secondTransactions);
    expect(firstTransactions[0]).toMatchObject({
      occurredOn: '2026-07-15',
      amount: { value: '125.50', currencyCode: 'USD' },
      direction: 'debit',
      status: 'posted',
      category: { label: 'Groceries' },
      account: { identifierMask: '•••• 3456' },
    });
    expect(firstTransactions[0].publicId).not.toBe(String(transaction.id));
    expect(firstTransactions[0].publicId).toMatch(/^transaction_[A-Za-z0-9_-]{22}$/);
    expect(accounts[0]).toMatchObject({
      institutionName: 'Bank Hapoalim',
      type: 'unknown',
      identifierMask: '•••• 3456',
      freshness: { status: 'fresh', lastSuccessfulSyncAt: '2026-07-15T09:30:00.000Z' },
    });
    expect(home.netWorth.amount.value).toBe('250000.28');
    expect(home.income.amount.value).toBe('0.00');
    expect(home.spending.amount.value).toBe('125.50');
    expect(budget).toMatchObject({
      status: 'on_track',
      spent: { value: '125.50' },
      limit: { value: '1000.00' },
      remaining: { value: '874.50' },
    });
    expect(review.count).toBe(1);
    expect(latestSync).toEqual({
      status: 'succeeded',
      startedAt: '2026-07-15T09:29:00.000Z',
      completedAt: '2026-07-15T09:30:00.000Z',
      accountsSucceeded: 1,
      accountsFailed: 0,
    });
    const serialized = JSON.stringify({ firstTransactions, accounts });
    expect(serialized).not.toContain('FORBIDDEN_SECRET_SENTINEL');
    expect(serialized).not.toContain('123-4567890123456');
    expect(serialized).not.toContain('credentialsRef');
  });

  it('filters future installment rows before ordering and limiting recent transactions', async () => {
    const db = database();
    const account = insertAccount(db);
    const occurred = insertTransaction(db, account.id, {
      date: CONTEXT.financialDate,
      processedDate: CONTEXT.financialDate,
      description: 'Occurred today',
    });
    for (let index = 1; index <= 25; index += 1) {
      insertTransaction(db, account.id, {
        date: `2026-08-${String(index).padStart(2, '0')}`,
        processedDate: `2026-08-${String(index).padStart(2, '0')}`,
        description: `Future installment ${index}`,
        installmentNumber: index,
        installmentTotal: 25,
      });
    }
    const ports = createProductionMobileBootstrapPorts({
      db,
      publicIdKey: KEY,
      readNetWorthIls: () => 0,
    });

    const transactions = await ports.readRecentTransactions(CONTEXT);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      occurredOn: CONTEXT.financialDate,
      displayName: 'Occurred today',
    });
    expect(transactions[0].publicId).not.toBe(String(occurred.id));
  });

  it('degrades an unsupported persisted currency to a safe non-cacheable section error', async () => {
    const db = database();
    const account = insertAccount(db);
    insertTransaction(db, account.id, {
      date: CONTEXT.financialDate,
      processedDate: CONTEXT.financialDate,
      chargedCurrency: 'ZZZ',
    });
    const ports = createProductionMobileBootstrapPorts({
      db,
      publicIdKey: KEY,
      readNetWorthIls: () => 0,
    });
    const instants = [new Date(CONTEXT.calculatedAt), new Date('2026-07-15T10:00:01.000Z')];
    const provide = createMobileBootstrapAdapter({
      ports,
      server: {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Money Monitor Mac',
        serverVersion: '0.3.5',
        minimumClientVersion: '0.1.0',
      },
      fallbackCurrencyCode: 'ILS',
      clock: () => instants.shift() ?? new Date('2026-07-15T10:00:01.000Z'),
      snapshotIdFactory: () => 'snapshot_invalid_currency',
    });

    const result = await provide();

    expect(result.meta.cacheability).toEqual({ status: 'not_cacheable', maxAgeSeconds: 0 });
    expect(result.meta.completeness).toEqual({
      status: 'partial',
      sectionErrors: [
        { section: 'recent_transactions', code: 'source_unavailable', retryable: false },
      ],
    });
    expect(result.data.recentTransactions).toEqual([]);
  });

  it('does not fabricate one pulse from multiple potentially overlapping budgets', async () => {
    const db = database();
    db.insert(schema.budgets)
      .values([
        { name: 'Food', amount: 500, categoryNames: '["food"]' },
        { name: 'Dining', amount: 300, categoryNames: '["dining"]' },
      ])
      .run();
    const ports = createProductionMobileBootstrapPorts({
      db,
      publicIdKey: KEY,
      readNetWorthIls: () => 0,
    });

    await expect(ports.readBudgetPulse(CONTEXT)).resolves.toMatchObject({
      status: 'unavailable',
      spent: null,
      limit: null,
      remaining: null,
    });
  });

  it('turns raw domain failures into safe section classifications', async () => {
    const db = database();
    const ports = createProductionMobileBootstrapPorts({
      db,
      publicIdKey: KEY,
      readNetWorthIls: () => {
        throw new Error('API key and /Users/private/finance.sqlite');
      },
    });

    const error = await Promise.resolve(ports.readHome(CONTEXT)).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MobileBootstrapSectionReadError);
    expect(error).toMatchObject({ code: 'source_unavailable', retryable: true });
    expect(JSON.stringify(error)).not.toContain('/Users/private');
  });

  it('uses the Israel finance calendar and masks identifiers on the server', () => {
    expect(financialDateInIsrael(new Date('2026-07-14T21:30:00.000Z'))).toBe('2026-07-15');
    expect(financialDateInIsrael(new Date('2026-12-14T22:30:00.000Z'))).toBe('2026-12-15');
    expect(maskAccountIdentifier(null)).toBe('•••• NA');
    expect(maskAccountIdentifier('1')).toBe('•••• NA');
    expect(maskAccountIdentifier('1234-5678-9012')).toBe('•••• 9012');
  });
});
