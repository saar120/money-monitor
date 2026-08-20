import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import * as schema from '../db/schema.js';
import { createProductionMobileNetWorthHistoryPorts } from './net-worth-history-production-ports.js';

describe('production mobile net-worth history ports', () => {
  const databases: TestDb[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it('projects aggregate ILS values over the selected range and discloses estimated history', () => {
    const database = createTestDb();
    databases.push(database);
    const account = database.db.insert(schema.accounts).values({ companyId: 'hapoalim', displayName: 'Main', accountType: 'bank', credentialsRef: 'keychain:bank' }).returning().get();
    const asset = database.db.insert(schema.assets).values({ name: 'Savings', type: 'cash' }).returning().get();
    database.db.insert(schema.accountBalanceHistory).values([
      { accountId: account.id, date: '2026-04-16', balance: 40 },
      { accountId: account.id, date: '2026-07-16', balance: 50 },
    ]).run();
    database.db.insert(schema.assetSnapshots).values([
      { assetId: asset.id, date: '2026-04-16', totalValueIls: 60 },
      { assetId: asset.id, date: '2026-07-16', totalValueIls: 70 },
    ]).run();
    database.db.insert(schema.liabilities).values({ name: 'Loan', type: 'loan', currentBalance: 10, originalAmount: 20, startDate: '2026-04-16' }).run();

    const result = createProductionMobileNetWorthHistoryPorts({ db: database.db }).read(
      { range: '3M' },
      { financialDate: '2026-07-16' },
    );

    expect(result).toMatchObject({
      financialDate: '2026-07-16', range: '3M', period: { startDate: '2026-04-16', endDate: '2026-07-16' },
      baseCurrencyCode: 'ILS', estimatedHistory: true, estimationMethod: 'latest_known_values_carried_forward',
    });
    expect(result.points.at(-1)).toEqual({
      date: '2026-07-16', total: { value: '110.00', currencyCode: 'ILS' }, assetsTotal: { value: '70.00', currencyCode: 'ILS' },
      liabilitiesTotal: { value: '10.00', currencyCode: 'ILS' }, bankBalancesTotal: { value: '50.00', currencyCode: 'ILS' },
    });
    expect(JSON.stringify(result)).not.toContain('keychain:bank');
  });

  it('uses the earliest aggregate-safe source date for All', () => {
    const database = createTestDb();
    databases.push(database);
    const account = database.db.insert(schema.accounts).values({ companyId: 'hapoalim', displayName: 'Main', accountType: 'bank', credentialsRef: 'keychain:bank' }).returning().get();
    database.db.insert(schema.accountBalanceHistory).values({ accountId: account.id, date: '2023-02-01', balance: 100 }).run();

    const result = createProductionMobileNetWorthHistoryPorts({ db: database.db }).read({ range: 'All' }, { financialDate: '2026-07-16' });
    expect(result.period).toEqual({ startDate: '2023-02-01', endDate: '2026-07-16' });
    expect(result.points[0]?.date).toBe('2023-02-01');
  });
});
