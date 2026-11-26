import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';

const { evaluateTypeSafeMock } = vi.hoisted(() => ({ evaluateTypeSafeMock: vi.fn() }));
vi.mock('../ai/typesafe/client.js', () => ({ evaluateTypeSafe: evaluateTypeSafeMock }));

const {
  saveRecurringPaymentDecision,
  discoverRecurringPayments,
  readRecurringPaymentDetail,
  readRecurringPayments,
} = await import('./recurring-payments.js');
import type { RecurringTransaction } from './recurring-payments.js';

const today = '2026-09-26';
const base: RecurringTransaction = {
  accountId: 1,
  accountName: 'Card',
  date: '2026-07-06',
  description: 'Example Merchant',
  amount: -50,
  currencyCode: 'ILS',
  category: 'shopping',
  installmentTotal: null,
};

function charges(description = 'Example Merchant', amounts = [50, 50, 50]) {
  return ['2026-07-06', '2026-08-06', '2026-09-06'].map((date, index) => ({
    ...base,
    date,
    description,
    amount: -amounts[index],
  }));
}

function judgment(
  rows: RecurringTransaction[],
  choice: 'subscription' | 'serviceBill' | 'ordinary' | 'other' | 'unknown',
  probability: number,
) {
  const candidate = discoverRecurringPayments(rows, today).suggestions[0];
  const key = `${candidate.accountId}\0${candidate.currencyCode}\0${candidate.merchantKey}`;
  return new Map([[key, { choice, probability }]]);
}

describe('recurring payment discovery', () => {
  it('finds repeat candidates without trusting editable categories or merchant names', () => {
    const rows = charges('Corner Cafe');
    const original = discoverRecurringPayments(rows, today);
    const changed = discoverRecurringPayments(
      rows.map((row) => ({ ...row, category: 'subscriptions' })),
      today,
    );
    expect(original.payments).toEqual([]);
    expect(original.suggestions).toMatchObject([
      { name: 'Corner Cafe', frequency: 'monthly', occurrences: 3, nextExpectedDate: '2026-10-06' },
    ]);
    expect(changed).toEqual(original);
  });

  it('includes only strong service judgments and keeps uncertain ones in Review', () => {
    const rows = charges('Any Provider');
    const automatic = discoverRecurringPayments(
      rows,
      today,
      [],
      judgment(rows, 'subscription', 0.95),
    );
    expect(automatic.payments).toMatchObject([{ kind: 'subscription', source: 'automatic' }]);
    expect(automatic.totals).toEqual([{ currencyCode: 'ILS', monthlyCost: 50, annualCost: 600 }]);
    expect(
      discoverRecurringPayments(rows, today, [], judgment(rows, 'serviceBill', 0.75)).suggestions,
    ).toMatchObject([{ source: 'suggestion', kind: 'serviceBill' }]);
    expect(
      discoverRecurringPayments(rows, today, [], judgment(rows, 'unknown', 0.98)).suggestions,
    ).toHaveLength(1);
  });

  it('hides confident ordinary purchases and other regular payments', () => {
    const rows = charges('Corner Cafe');
    for (const choice of ['ordinary', 'other'] as const) {
      const result = discoverRecurringPayments(rows, today, [], judgment(rows, choice, 0.9));
      expect(result.payments).toEqual([]);
      expect(result.suggestions).toEqual([]);
    }
    expect(
      discoverRecurringPayments(rows, today, [], judgment(rows, 'ordinary', 0.6)).suggestions,
    ).toHaveLength(1);
  });

  it('does not auto-include a service judgment after only two charges', () => {
    const rows = charges().slice(1);
    const result = discoverRecurringPayments(rows, today, [], judgment(rows, 'subscription', 0.99));
    expect(result.payments).toEqual([]);
    expect(result.suggestions).toHaveLength(1);
  });

  it('lets saved decisions override semantic judgments', () => {
    const rows = charges('Corner Cafe');
    const candidate = discoverRecurringPayments(rows, today).suggestions[0];
    const identity = {
      accountId: candidate.accountId,
      currencyCode: candidate.currencyCode,
      merchantKey: candidate.merchantKey,
    };
    const included = discoverRecurringPayments(
      rows,
      today,
      [{ ...identity, decision: 'include' }],
      judgment(rows, 'ordinary', 0.99),
    );
    expect(included.payments).toMatchObject([{ source: 'manual' }]);
    const excluded = discoverRecurringPayments(
      rows,
      today,
      [{ ...identity, decision: 'exclude' }],
      judgment(rows, 'subscription', 0.99),
    );
    expect(excluded.payments).toEqual([]);
    expect(excluded.excluded).toMatchObject([{ source: 'excluded' }]);
  });

  it('rejects credits, installments, and structured transfers', () => {
    const rows = [
      ...charges('Credit').map((row) => ({ ...row, amount: 50 })),
      ...charges('Installment').map((row) => ({ ...row, installmentTotal: 4 })),
      ...charges('Transfer').map((row) => ({ ...row, type: 'transfer' })),
    ];
    expect(discoverRecurringPayments(rows, today).suggestions).toEqual([]);
  });

  it('uses the same amount rule after a category edit', () => {
    const variable = charges('Variable Bill', [100, 160, 120]);
    expect(discoverRecurringPayments(variable, today).suggestions).toHaveLength(1);
    expect(
      discoverRecurringPayments(
        variable.map((row) => ({ ...row, category: 'utilities' })),
        today,
      ).suggestions,
    ).toHaveLength(1);
    const outlier = charges('Variable Bill', [100, 160, 500]);
    expect(discoverRecurringPayments(outlier, today).suggestions).toEqual([]);
    expect(
      discoverRecurringPayments(
        outlier.map((row) => ({ ...row, category: 'utilities' })),
        today,
      ).suggestions,
    ).toEqual([]);
  });

  it('requires three charges before accepting variable amounts and caps their spread', () => {
    const rows = charges('Variable Bill', [100, 160, 200]);
    expect(discoverRecurringPayments(rows.slice(0, 2), today).suggestions).toEqual([]);
    expect(discoverRecurringPayments(rows, today).suggestions).toHaveLength(1);
    expect(
      discoverRecurringPayments(charges('Variable Bill', [100, 160, 201]), today).suggestions,
    ).toEqual([]);
  });

  it('keeps a subscription together after a clear price change and estimates the new price', () => {
    const dates = ['2026-06-06', '2026-07-06', '2026-08-06', '2026-09-06'];
    const upgraded = dates.map((date, index) => ({
      ...base,
      date,
      description: 'Codex Subscription',
      amount: index === 3 ? -100 : -20,
    }));
    expect(discoverRecurringPayments(upgraded, today).suggestions).toMatchObject([
      { name: 'Codex Subscription', occurrences: 4, usualAmount: 100, annualCost: 1200 },
    ]);
    const withOtherCharge = [
      ...upgraded,
      { ...base, date: '2026-09-10', description: 'Codex Subscription', amount: -20 },
    ];
    expect(discoverRecurringPayments(withOtherCharge, today).suggestions).toMatchObject([
      { occurrences: 4, usualAmount: 100, annualCost: 1200 },
    ]);
    const settled = upgraded.map((row, index) => ({ ...row, amount: index < 2 ? -20 : -30 }));
    expect(discoverRecurringPayments(settled, today).suggestions).toMatchObject([
      { occurrences: 4, usualAmount: 30, annualCost: 360 },
    ]);
  });

  it('keeps the upgraded renewal in the pattern when an old-price purchase happens nearby', () => {
    const testDb = createTestDb();
    try {
      const account = insertAccount(testDb.db);
      const charges = [
        ['2026-05-06', 20],
        ['2026-06-06', 20],
        ['2026-07-06', 20],
        ['2026-08-06', 20],
        ['2026-09-06', 100],
        ['2026-09-10', 20],
        ['2026-10-06', 100],
      ] as const;
      for (const [date, amount] of charges) {
        insertTransaction(testDb.db, account.id, {
          date,
          processedDate: date,
          description: 'Codex Subscription',
          chargedAmount: -amount,
        });
      }
      const candidate = discoverRecurringPayments(
        charges.map(([date, amount]) => ({
          ...base,
          accountId: account.id,
          date,
          description: 'Codex Subscription',
          amount: -amount,
        })),
        '2026-10-26',
      ).suggestions[0];
      const detail = readRecurringPaymentDetail(testDb.db, '2026-10-26', candidate);
      expect(detail?.payment).toMatchObject({ usualAmount: 100, annualCost: 1200 });
      expect(detail?.transactions.find((row) => row.date === '2026-09-06')?.inPattern).toBe(true);
      expect(detail?.transactions.find((row) => row.date === '2026-09-10')?.inPattern).toBe(false);
    } finally {
      testDb.close();
    }
  });

  it('keeps currencies separate and combines legacy shekel symbols with ILS', () => {
    const rows = [
      ...charges('Same Merchant').map((row, index) => ({
        ...row,
        currencyCode: index === 1 ? '₪' : 'ILS',
      })),
      ...charges('Same Merchant').map((row) => ({ ...row, currencyCode: 'USD' })),
    ];
    const result = discoverRecurringPayments(rows, today);
    expect(result.suggestions).toMatchObject([
      { currencyCode: 'ILS', occurrences: 3 },
      { currencyCode: 'USD', occurrences: 3 },
    ]);
  });

  it('recognizes every two months without inventing a later date', () => {
    const rows = ['2026-05-15', '2026-07-15', '2026-09-15'].map((date) => ({ ...base, date }));
    expect(discoverRecurringPayments(rows, today).suggestions[0]).toMatchObject({
      frequency: 'everyTwoMonths',
      nextExpectedDate: '2026-11-15',
    });
    expect(discoverRecurringPayments(rows.slice(0, 2), today).suggestions).toEqual([]);
  });

  it('drops stale patterns but keeps one missed month and an extra charge', () => {
    const rows = ['2026-05-06', '2026-06-06', '2026-06-18', '2026-08-06', '2026-09-06'].map(
      (date) => ({ ...base, date }),
    );
    expect(discoverRecurringPayments(rows, today).suggestions[0]).toMatchObject({
      occurrences: 4,
      nextExpectedDate: '2026-10-06',
    });
    expect(discoverRecurringPayments(charges().slice(0, 2), '2026-09-20').suggestions).toEqual([]);
  });

  it('keeps the regular charge when the same merchant has an extra purchase nearby', () => {
    const rows = [
      ['2026-06-06', 50],
      ['2026-07-06', 50],
      ['2026-08-06', 200],
      ['2026-08-07', 50],
      ['2026-09-07', 50],
    ].map(([date, amount]) => ({ ...base, date: String(date), amount: -Number(amount) }));
    expect(discoverRecurringPayments(rows, today).suggestions[0]).toMatchObject({
      occurrences: 4,
      usualAmount: 50,
      nextExpectedDate: '2026-10-06',
    });
    const tiedDates = [
      ['2026-06-06', 50],
      ['2026-07-06', 50],
      ['2026-08-06', 75],
      ['2026-08-11', 50],
      ['2026-09-11', 50],
    ].map(([date, amount]) => ({ ...base, date: String(date), amount: -Number(amount) }));
    expect(discoverRecurringPayments(tiedDates, today).suggestions[0].usualAmount).toBe(50);
  });
});

it('recurring command receipts survive auto and reject stale decisions atomically', () => {
  const testDb = createTestDb();
  try {
    const account = insertAccount(testDb.db);
    const command = {
      accountId: account.id,
      currencyCode: 'ILS',
      merchantKey: 'a'.repeat(64),
      decision: 'include' as const,
      expectedVersion: 0,
      commandId: '00000000-0000-4000-8000-000000000001',
    };
    const accepted = saveRecurringPaymentDecision(testDb.db, command, 'device-a');
    expect(accepted.resourceVersion).toBe(1);
    expect(saveRecurringPaymentDecision(testDb.db, command, 'device-a')).toEqual(accepted);
    const auto = {
      ...command,
      commandId: '00000000-0000-4000-8000-000000000002',
      expectedVersion: 1,
      decision: 'auto' as const,
    };
    expect(saveRecurringPaymentDecision(testDb.db, auto, 'device-a').resourceVersion).toBe(2);
    expect(() =>
      saveRecurringPaymentDecision(
        testDb.db,
        { ...command, decision: 'exclude', commandId: '00000000-0000-4000-8000-000000000003' },
        'device-b',
      ),
    ).toThrow('mutation_conflict');
    expect(
      testDb.sqlite
        .prepare('SELECT decision, resource_version FROM recurring_payment_decisions')
        .get(),
    ).toEqual({ decision: 'auto', resource_version: 2 });
  } finally {
    testDb.close();
  }
});

describe('recurring payment Jev classification', () => {
  let testDb: TestDb;
  let keySeq = 0;
  let originalKey: string;

  beforeEach(() => {
    originalKey = config.TYPESAFE_API_KEY;
    config.TYPESAFE_API_KEY = `test-recurring-jev-key-${++keySeq}`;
    evaluateTypeSafeMock.mockReset();
    evaluateTypeSafeMock.mockImplementation(
      async ({ questions }: { questions: Record<string, unknown> }) => ({
        model: 'jev-test',
        answers: Object.fromEntries(
          Object.keys(questions).map((id) => [
            id,
            {
              type: 'choice',
              choice: 'subscription',
              confidence: 0.95,
              probabilities: {
                subscription: 0.95,
                serviceBill: 0.02,
                ordinary: 0.01,
                other: 0.01,
                unknown: 0.01,
              },
            },
          ]),
        ),
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    testDb = createTestDb();
  });

  afterEach(() => {
    config.TYPESAFE_API_KEY = originalKey;
    testDb.close();
  });

  function seedMonthly(accountId: number, description: string, category?: string) {
    for (const date of ['2026-07-06', '2026-08-06', '2026-09-06']) {
      insertTransaction(testDb.db, accountId, {
        date,
        processedDate: date,
        description,
        category,
        chargedAmount: -50,
      });
    }
  }

  it('uses Jev to hide repeat shopping without sending editable categories', async () => {
    const account = insertAccount(testDb.db);
    seedMonthly(account.id, 'Cafe Example', 'subscriptions');
    seedMonthly(account.id, 'Utility Example', 'shopping');
    evaluateTypeSafeMock.mockImplementation(
      async ({
        state,
        questions,
      }: {
        state: { candidates: Array<{ name: string }> };
        questions: Record<string, unknown>;
      }) => ({
        model: 'jev-test',
        answers: Object.fromEntries(
          Object.keys(questions).map((id, index) => {
            const choice = state.candidates[index].name.startsWith('Cafe')
              ? 'ordinary'
              : 'serviceBill';
            return [
              id,
              {
                type: 'choice',
                choice,
                confidence: 0.96,
                probabilities: { [choice]: 0.96, unknown: 0.04 },
              },
            ];
          }),
        ),
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const result = await readRecurringPayments(testDb.db, '2026-09-15');
    expect(result).toMatchObject({
      payments: [{ name: 'Utility Example', kind: 'serviceBill' }],
      suggestions: [],
    });
    expect(JSON.stringify(evaluateTypeSafeMock.mock.calls[0][0])).not.toContain('category');
  });

  it('keeps candidates in Review when Jev is unavailable', async () => {
    const account = insertAccount(testDb.db);
    seedMonthly(account.id, 'Unclassified Provider');
    evaluateTypeSafeMock.mockRejectedValueOnce(new Error('offline'));

    const first = await readRecurringPayments(testDb.db, '2026-09-15');
    expect(first).toMatchObject({
      payments: [],
      suggestions: [{ name: 'Unclassified Provider' }],
      totals: [],
    });
    const retry = await readRecurringPayments(testDb.db, '2026-09-15');
    expect(retry.classificationPending).toBe(false);
    expect(evaluateTypeSafeMock).toHaveBeenCalledTimes(1);
  });

  it('retries classification when the TypeSafe key changes during a failed request', async () => {
    const account = insertAccount(testDb.db);
    seedMonthly(account.id, 'Key Change Provider');
    evaluateTypeSafeMock.mockImplementationOnce(async () => {
      config.TYPESAFE_API_KEY = `replacement-key-${++keySeq}`;
      throw new Error('previous key failed');
    });

    const first = await readRecurringPayments(testDb.db, '2026-09-15');
    expect(first.suggestions).toMatchObject([{ name: 'Key Change Provider' }]);

    const retry = await readRecurringPayments(testDb.db, '2026-09-15');
    expect(retry.payments).toMatchObject([{ name: 'Key Change Provider' }]);
    expect(evaluateTypeSafeMock).toHaveBeenCalledTimes(2);
  });

  it('returns Review before a slow Jev request can time out the phone', async () => {
    const account = insertAccount(testDb.db);
    seedMonthly(account.id, 'Slow Provider');
    evaluateTypeSafeMock.mockImplementationOnce(() => new Promise(() => {}));

    const started = Date.now();
    const result = await readRecurringPayments(testDb.db, '2026-09-15');
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(result).toMatchObject({
      payments: [],
      suggestions: [{ name: 'Slow Provider' }],
      classificationPending: true,
    });
  }, 7_000);
});
