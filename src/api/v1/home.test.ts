import { afterEach, describe, expect, it } from 'vitest';
import { homeOverviewResponseSchema } from './contract.js';
import { createCanonicalHomeHarness, type CanonicalHomeHarness } from './home-test-harness.js';

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
    const harness = await createCanonicalHomeHarness({ clock: () => GENERATED_AT, startListeners: false });
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
});
