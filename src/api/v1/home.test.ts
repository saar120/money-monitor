import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../__tests__/helpers/db.js';
import { accounts, transactions } from '../../db/schema.js';
import { homeOverviewResponseSchema } from './contract.js';
import { createCanonicalHomeHarness, type CanonicalHomeHarness } from './home-test-harness.js';
import { createHomeOverviewProjection } from './home-overview.js';

const GENERATED_AT = new Date('2026-08-20T10:00:00.000Z');

describe('canonical Home overview projection', () => {
  const harnesses: CanonicalHomeHarness[] = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  });

  it('accepts the independent Home projection literal with chart drill-down meaning', () => {
    const candidate = {
      data: {
        financialDate: '2026-08-20',
        calculatedAt: GENERATED_AT.toISOString(),
        baseCurrencyCode: 'ILS',
        availableMoney: { value: '8200.00', currencyCode: 'ILS' },
        spending: {
          current: {
            amount: { value: '1200.00', currencyCode: 'ILS' },
            period: { startDate: '2026-08-01', endDate: '2026-08-20' },
          },
          comparison: {
            amount: { value: '900.00', currencyCode: 'ILS' },
            period: { startDate: '2026-07-01', endDate: '2026-07-20' },
          },
          change: { value: '300.00', currencyCode: 'ILS' },
        },
        budget: {
          state: 'on_track',
          name: 'Monthly essentials',
          spent: { value: '1200.00', currencyCode: 'ILS' },
          limit: { value: '2000.00', currencyCode: 'ILS' },
          remaining: { value: '800.00', currencyCode: 'ILS' },
          period: { startDate: '2026-08-01', endDate: '2026-08-20' },
        },
        netWorth: {
          total: { value: '150000.00', currencyCode: 'ILS' },
          liquid: { value: '8200.00', currencyCode: 'ILS' },
        },
        categories: [
          {
            label: 'Food',
            amount: { value: '600.00', currencyCode: 'ILS' },
            share: 0.5,
            transactionCount: 3,
            textSummary: 'Food accounts for ₪600.00, or 50.0% of spending.',
            drillDown: { category: 'Food', startDate: '2026-08-01', endDate: '2026-08-20' },
          },
        ],
        cashFlow: [
          {
            period: { startDate: '2026-08-01', endDate: '2026-08-20' },
            income: { value: '5000.00', currencyCode: 'ILS' },
            expenses: { value: '1200.00', currencyCode: 'ILS' },
            net: { value: '3800.00', currencyCode: 'ILS' },
            textSummary: 'August 2026: ₪5,000.00 in and ₪1,200.00 out.',
            drillDown: { startDate: '2026-08-01', endDate: '2026-08-20' },
          },
        ],
        accountFreshness: [
          {
            displayName: 'Checking',
            status: 'current',
            lastSuccessfulSyncAt: '2026-08-20T09:30:00.000Z',
          },
        ],
        isEmpty: false,
      },
      meta: {
        apiVersion: '1',
        generatedAt: GENERATED_AT.toISOString(),
        source: 'mac-authoritative',
        calculationVersion: 'home-overview-1',
        completeness: 'complete',
        estimated: false,
        missingSections: [],
      },
    };

    expect(homeOverviewResponseSchema.parse(candidate)).toEqual(candidate);
  });

  it('returns one identical validated projection through Mac and paired-iPhone clients', async () => {
    const harness = await createCanonicalHomeHarness({
      clock: () => GENERATED_AT,
      startListeners: false,
    });
    harnesses.push(harness);

    const [macResponse, iPhoneResponse] = await Promise.all([
      harness.macServer.app.inject({
        method: 'GET',
        url: '/api/v1/home',
        headers: { authorization: `Bearer ${harness.macToken}` },
      }),
      harness.iPhoneServer.app.inject({
        method: 'GET',
        url: '/api/v1/home',
        headers: { authorization: `Bearer ${harness.iPhoneToken}` },
      }),
    ]);
    expect(macResponse.statusCode).toBe(200);
    expect(iPhoneResponse.statusCode).toBe(200);
    const mac = homeOverviewResponseSchema.parse(JSON.parse(macResponse.body));
    const iPhone = homeOverviewResponseSchema.parse(JSON.parse(iPhoneResponse.body));

    expect(mac).toEqual(iPhone);
    expect(mac.data.financialDate).toBe('2026-08-20');
    expect(mac.data.categories[0]?.drillDown).toEqual({
      category: 'Food',
      startDate: '2026-08-01',
      endDate: '2026-08-20',
    });
  });

  it('serves converted non-ILS values from the Mac rate provider', async () => {
    const harness = await createCanonicalHomeHarness({
      clock: () => GENERATED_AT,
      startListeners: false,
      homeExchangeRates: async () => ({
        rates: { ILS: 1, USD: 3.6 },
        stale: false,
        fetchedAt: GENERATED_AT.toISOString(),
      }),
    });
    harnesses.push(harness);
    harness.sqlite
      .prepare(
        `INSERT INTO transactions
         (account_id, date, processed_date, original_amount, original_currency,
          charged_amount, charged_currency, description, category, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        1,
        '2026-08-10',
        '2026-08-10',
        -90,
        'USD',
        -90,
        'USD',
        'Foreign fixture',
        'Travel',
        'foreign-route',
      );

    const response = await harness.macServer.app.inject({
      method: 'GET',
      url: '/api/v1/home',
      headers: { authorization: `Bearer ${harness.macToken}` },
    });
    const home = homeOverviewResponseSchema.parse(JSON.parse(response.body));
    expect(response.statusCode).toBe(200);
    expect(home.data.spending.current.amount.value).toBe('1524.00');
    expect(home.data.categories.map((category) => category.amount.value)).toEqual([
      '1200.00',
      '324.00',
    ]);
    expect(home.meta.completeness).toBe('complete');
    expect(home.meta.estimated).toBe(false);
    expect(home.meta.missingSections).toEqual([]);
  });

  it('marks unavailable non-ILS conversion as partial instead of omitting it silently', async () => {
    const harness = await createCanonicalHomeHarness({
      clock: () => GENERATED_AT,
      startListeners: false,
      homeExchangeRates: async () => ({
        rates: { ILS: 1 },
        stale: true,
        fetchedAt: GENERATED_AT.toISOString(),
      }),
    });
    harnesses.push(harness);
    harness.sqlite
      .prepare(
        `INSERT INTO transactions
         (account_id, date, processed_date, original_amount, original_currency,
          charged_amount, charged_currency, description, category, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        1,
        '2026-08-10',
        '2026-08-10',
        -90,
        'USD',
        -90,
        'USD',
        'Unknown-rate fixture',
        'Food',
        'unknown-rate-route',
      );

    const response = await harness.macServer.app.inject({
      method: 'GET',
      url: '/api/v1/home',
      headers: { authorization: `Bearer ${harness.macToken}` },
    });
    const home = homeOverviewResponseSchema.parse(JSON.parse(response.body));
    expect(response.statusCode).toBe(200);
    expect(home.meta.completeness).toBe('partial');
    expect(home.meta.estimated).toBe(true);
    expect(home.meta.missingSections).toEqual(
      expect.arrayContaining(['spending', 'categories', 'cashFlow', 'budget']),
    );
    expect(home.data.budget).toBeNull();
  });

  it('marks a missing account balance as a partial Home projection', async () => {
    const harness = await createCanonicalHomeHarness({
      clock: () => GENERATED_AT,
      startListeners: false,
      accountBalance: null,
    });
    harnesses.push(harness);

    const response = await harness.macServer.app.inject({
      method: 'GET',
      url: '/api/v1/home',
      headers: { authorization: `Bearer ${harness.macToken}` },
    });
    const home = homeOverviewResponseSchema.parse(JSON.parse(response.body));
    expect(response.statusCode).toBe(200);
    expect(home.data.availableMoney).toBeNull();
    expect(home.meta.completeness).toBe('partial');
    expect(home.meta.missingSections).toContain('availableMoney');
  });

  it.each([
    ['non-leap March', '2026-03-31T10:00:00.000Z', '2026-02-28'],
    ['leap March', '2028-03-31T10:00:00.000Z', '2028-02-29'],
  ])('caps the elapsed comparison period for %s', (_label, instant, expectedEnd) => {
    const testDb = createTestDb();
    try {
      testDb.db
        .insert(accounts)
        .values({
          companyId: 'period-fixture',
          displayName: 'Checking',
          accountNumber: '1234',
          accountType: 'bank',
          balance: 1000,
          credentialsRef: 'fixture',
        })
        .run();
      testDb.db
        .insert(transactions)
        .values([
          {
            accountId: 1,
            date: expectedEnd,
            processedDate: expectedEnd,
            originalAmount: -100,
            originalCurrency: 'ILS',
            chargedAmount: -100,
            chargedCurrency: 'ILS',
            description: 'Last day of prior month',
            hash: `period-${expectedEnd}`,
          },
          {
            accountId: 1,
            date: `${expectedEnd.slice(0, 4)}-03-01`,
            processedDate: `${expectedEnd.slice(0, 4)}-03-01`,
            originalAmount: -999,
            originalCurrency: 'ILS',
            chargedAmount: -999,
            chargedCurrency: 'ILS',
            description: 'Overflow sentinel',
            hash: `overflow-${expectedEnd}`,
          },
        ])
        .run();

      const projection = createHomeOverviewProjection(testDb.sqlite).read(new Date(instant));
      expect(projection.spending.comparison.period).toEqual({
        startDate: expectedEnd.slice(0, 7) + '-01',
        endDate: expectedEnd,
      });
      expect(projection.spending.comparison.amount.value).toBe('100.00');
    } finally {
      testDb.close();
    }
  });

  it('converts non-ILS transaction values with the Mac-authoritative rate set', () => {
    const testDb = createTestDb();
    try {
      testDb.db
        .insert(accounts)
        .values({
          companyId: 'filter-fixture',
          displayName: 'Checking',
          accountNumber: '5678',
          accountType: 'bank',
          balance: 1000,
          credentialsRef: 'fixture',
        })
        .run();
      testDb.db
        .insert(transactions)
        .values([
          {
            accountId: 1,
            date: '2026-08-10',
            processedDate: '2026-08-10',
            originalAmount: -50,
            originalCurrency: 'ILS',
            chargedAmount: -50,
            chargedCurrency: 'ILS',
            description: 'Included ILS expense',
            hash: 'filters-included',
          },
          {
            accountId: 1,
            date: '2026-08-11',
            processedDate: '2026-08-11',
            originalAmount: -60,
            originalCurrency: 'ILS',
            chargedAmount: -60,
            chargedCurrency: 'ILS',
            description: 'Ignored expense',
            ignored: true,
            hash: 'filters-ignored',
          },
          {
            accountId: 1,
            date: '2026-08-12',
            processedDate: '2026-08-12',
            originalAmount: -70,
            originalCurrency: 'ILS',
            chargedAmount: -70,
            chargedCurrency: 'ILS',
            description: 'Transfer expense',
            type: 'transfer',
            hash: 'filters-transfer',
          },
          {
            accountId: 1,
            date: '2026-08-21',
            processedDate: '2026-08-21',
            originalAmount: -80,
            originalCurrency: 'ILS',
            chargedAmount: -80,
            chargedCurrency: 'ILS',
            description: 'Future expense',
            hash: 'filters-future',
          },
          {
            accountId: 1,
            date: '2026-08-13',
            processedDate: '2026-08-13',
            originalAmount: -90,
            originalCurrency: 'USD',
            chargedAmount: -90,
            chargedCurrency: 'USD',
            description: 'Foreign currency expense',
            category: 'Travel',
            hash: 'filters-foreign',
          },
        ])
        .run();

      const projection = createHomeOverviewProjection(testDb.sqlite);
      const readWithRates = projection.read as unknown as (
        calculatedAt: Date,
        options: { rates: Record<string, number> },
      ) => ReturnType<typeof projection.read>;
      const home = readWithRates(GENERATED_AT, { rates: { ILS: 1, USD: 3.6 } });
      expect(home.spending.current.amount.value).toBe('374.00');
      expect(home.categories).toHaveLength(2);
      expect(home.categories.map((category) => category.amount.value)).toEqual(['324.00', '50.00']);
    } finally {
      testDb.close();
    }
  });
});
