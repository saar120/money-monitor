import { describe, expect, it, vi } from 'vitest';
import { findBootstrapRedactionViolations } from './bootstrap-contract.js';
import {
  MobileBootstrapAdapterValidationError,
  MobileBootstrapSectionReadError,
  createMobileBootstrapAdapter,
  type MobileBootstrapReadPorts,
  type MobileRecentTransactionReadModel,
} from './bootstrap-adapter.js';

const CALCULATED_AT = '2026-07-15T10:00:00.000Z';
const GENERATED_AT = '2026-07-15T10:00:01.000Z';

function money(value: string) {
  return { value, currencyCode: 'ILS' };
}

function aggregate(value: string, startDate = '2026-07-01') {
  return {
    amount: money(value),
    period: { startDate, endDate: '2026-07-15' },
    comparisonPeriod: null,
  };
}

function transaction(index = 1): MobileRecentTransactionReadModel {
  return {
    publicId: `transaction_${String(index).padStart(2, '0')}`,
    occurredOn: '2026-07-15',
    displayName: 'Neighborhood Market',
    amount: money('245.9000'),
    direction: 'debit',
    status: 'posted',
    category: { publicId: 'category_food_01', label: 'Groceries' },
    account: {
      publicId: 'account_checking_01',
      displayName: 'Everyday Checking',
      identifierMask: '•••• 4321',
    },
  };
}

function makePorts(): MobileBootstrapReadPorts {
  return {
    readHome: vi.fn(() => ({
      primaryCurrencyCode: 'ILS',
      netWorth: aggregate('128430.2700', '2026-07-15'),
      income: aggregate('12500.00'),
      spending: aggregate('4560.30'),
    })),
    readBudgetPulse: vi.fn(() => ({
      status: 'on_track' as const,
      spent: money('4560.30'),
      limit: money('9000.00'),
      remaining: money('4439.70'),
      period: { startDate: '2026-07-01', endDate: '2026-07-15' },
    })),
    readReview: vi.fn(() => ({ count: 3 })),
    readRecentTransactions: vi.fn(() => [transaction()]),
    readAccounts: vi.fn(() => [
      {
        publicId: 'account_checking_01',
        displayName: 'Everyday Checking',
        institutionName: 'Example Bank',
        type: 'checking' as const,
        currencyCode: 'ILS',
        identifierMask: '•••• 4321',
        freshness: {
          status: 'fresh' as const,
          lastSuccessfulSyncAt: '2026-07-15T09:58:00.000Z',
        },
      },
    ]),
    readLatestSync: vi.fn(() => ({
      status: 'succeeded' as const,
      startedAt: '2026-07-15T09:56:00.000Z',
      completedAt: '2026-07-15T09:58:00.000Z',
      accountsSucceeded: 1,
      accountsFailed: 0,
    })),
  };
}

function makeAdapter(ports = makePorts()) {
  const instants = [new Date(CALCULATED_AT), new Date(GENERATED_AT)];
  return createMobileBootstrapAdapter({
    ports,
    server: {
      id: '11111111-1111-4111-8111-111111111111',
      displayName: 'Saar’s Mac',
      serverVersion: '0.3.5',
      minimumClientVersion: '0.1.0',
    },
    fallbackCurrencyCode: 'ILS',
    clock: () => instants.shift() ?? new Date(GENERATED_AT),
    snapshotIdFactory: () => 'snapshot_adapter_01',
  });
}

describe('mobile bootstrap adapter', () => {
  it('constructs a coherent v1 envelope without claiming unevaluated client compatibility', async () => {
    const ports = makePorts();
    const result = await makeAdapter(ports)();

    expect(result.meta).toEqual({
      apiVersion: '1',
      generatedAt: GENERATED_AT,
      calculatedAt: CALCULATED_AT,
      financialDate: '2026-07-15',
      source: 'live',
      bootstrapSchemaVersion: 1,
      snapshotId: 'snapshot_adapter_01',
      server: {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Saar’s Mac',
        serverVersion: '0.3.5',
        protocolVersion: 1,
        minimumClientVersion: '0.1.0',
        capabilities: ['mobile.read'],
        compatibility: { status: 'not_evaluated', reason: null },
      },
      cacheability: { status: 'cacheable', maxAgeSeconds: 300 },
      completeness: { status: 'complete', sectionErrors: [] },
    });
    expect(result.data.home.aggregates.netWorth.amount.value).toBe('128430.2700');
    expect(result.data.recentTransactions[0].amount.value).toBe('245.9000');
    expect(result.data.home.aggregates.netWorth.calculatedAt).toBe(CALCULATED_AT);
    expect(result.data.budgetPulse.calculatedAt).toBe(CALCULATED_AT);
    expect(result.data.review.calculatedAt).toBe(CALCULATED_AT);

    const contexts = Object.values(ports).map((read) => vi.mocked(read).mock.calls[0][0]);
    expect(contexts.every((context) => context === contexts[0])).toBe(true);
    expect(contexts[0]).toEqual({ calculatedAt: CALCULATED_AT, financialDate: '2026-07-15' });
    expect(Object.isFrozen(contexts[0])).toBe(true);
    expect(findBootstrapRedactionViolations(result)).toEqual([]);
  });

  it.each([
    ['summer', '2026-07-14T21:30:00.000Z', '2026-07-15'],
    ['winter', '2026-12-14T22:30:00.000Z', '2026-12-15'],
  ])(
    'uses the Asia/Jerusalem finance day across UTC midnight in %s',
    async (_season, calculatedAt, expectedFinancialDate) => {
      const calculationInstant = new Date(calculatedAt);
      const ports = makePorts();
      ports.readAccounts = vi.fn(() => []);
      ports.readLatestSync = vi.fn(() => ({
        status: 'never_run' as const,
        startedAt: null,
        completedAt: null,
        accountsSucceeded: 0,
        accountsFailed: 0,
      }));
      const provide = createMobileBootstrapAdapter({
        ports,
        server: {
          id: '11111111-1111-4111-8111-111111111111',
          displayName: 'Saar’s Mac',
          serverVersion: '0.3.5',
          minimumClientVersion: '0.1.0',
        },
        fallbackCurrencyCode: 'ILS',
        clock: () => calculationInstant,
        snapshotIdFactory: () => 'snapshot_midnight_01',
      });

      const result = await provide();

      expect(result.meta.financialDate).toBe(expectedFinancialDate);
      expect(vi.mocked(ports.readHome).mock.calls[0][0]?.financialDate).toBe(expectedFinancialDate);
    },
  );

  it('classifies failed sections without exposing exception details and prevents partial caching', async () => {
    const ports = makePorts();
    ports.readBudgetPulse = vi.fn(() => {
      throw new MobileBootstrapSectionReadError('calculation_failed', true);
    });
    ports.readRecentTransactions = vi.fn(() => {
      throw new Error('Bearer secret-token at /Users/private/finance.sqlite');
    });

    const result = await makeAdapter(ports)();

    expect(result.meta.cacheability).toEqual({ status: 'not_cacheable', maxAgeSeconds: 0 });
    expect(result.meta.completeness).toEqual({
      status: 'partial',
      sectionErrors: [
        { section: 'budget_pulse', code: 'calculation_failed', retryable: true },
        { section: 'recent_transactions', code: 'unknown', retryable: true },
      ],
    });
    expect(result.data.budgetPulse).toMatchObject({
      status: 'unavailable',
      spent: null,
      limit: null,
      remaining: null,
    });
    expect(result.data.recentTransactions).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(JSON.stringify(result)).not.toContain('/Users/private');
  });

  it('copies only allowlisted fields from port projections', async () => {
    const ports = makePorts();
    ports.readRecentTransactions = vi.fn(() => [
      {
        ...transaction(),
        databaseId: 42,
        accountNumber: '1234567890123456',
        credential: 'Bearer should-never-leave-the-port',
        rawRow: { private: true },
      },
    ]);

    const result = await makeAdapter(ports)();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('databaseId');
    expect(serialized).not.toContain('accountNumber');
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('rawRow');
    expect(serialized).not.toContain('1234567890123456');
  });

  it('caps recent transactions at the contract maximum', async () => {
    const ports = makePorts();
    ports.readRecentTransactions = vi.fn(() =>
      Array.from({ length: 25 }, (_, index) => transaction(index + 1)),
    );

    const result = await makeAdapter(ports)();

    expect(result.data.recentTransactions).toHaveLength(20);
    expect(result.data.recentTransactions.at(-1)?.id).toBe('transaction_20');
  });

  it.each([
    ['numeric database identifier', () => ({ ...transaction(), publicId: '42' })],
    ['non-canonical money', () => ({ ...transaction(), amount: money('245.90000') })],
  ])('fails closed when a port returns %s', async (_name, invalidTransaction) => {
    const ports = makePorts();
    ports.readRecentTransactions = vi.fn(() => [invalidTransaction()]);

    await expect(makeAdapter(ports)()).rejects.toBeInstanceOf(
      MobileBootstrapAdapterValidationError,
    );
  });
});
