import { randomUUID } from 'node:crypto';
import {
  BOOTSTRAP_SCHEMA_VERSION,
  mobileFinancialDateFor,
  validateBootstrapPayload,
  type BootstrapSuccessEnvelope,
} from './bootstrap-contract.js';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE } from './contract.js';

type Awaitable<T> = T | Promise<T>;
type BootstrapData = BootstrapSuccessEnvelope['data'];
type BootstrapSection =
  BootstrapSuccessEnvelope['meta']['completeness']['sectionErrors'][number]['section'];
type BootstrapSectionError =
  BootstrapSuccessEnvelope['meta']['completeness']['sectionErrors'][number];

export interface BootstrapReadContext {
  /** One coherent point-in-time shared by every section read. */
  calculatedAt: string;
  financialDate: string;
}

export interface MobileMoneyReadModel {
  /** Canonical base-10 text. Never convert this value through a JS number. */
  value: string;
  currencyCode: string;
}

export interface MobilePeriodReadModel {
  startDate: string;
  endDate: string;
}

export interface MobileAggregateReadModel {
  amount: MobileMoneyReadModel;
  period: MobilePeriodReadModel;
  comparisonPeriod: MobilePeriodReadModel | null;
}

export interface MobileHomeReadModel {
  primaryCurrencyCode: string;
  netWorth: MobileAggregateReadModel;
  income: MobileAggregateReadModel;
  spending: MobileAggregateReadModel;
}

export interface MobileBudgetPulseReadModel {
  status: 'on_track' | 'watch' | 'over_budget' | 'unavailable' | 'unknown';
  spent: MobileMoneyReadModel | null;
  limit: MobileMoneyReadModel | null;
  remaining: MobileMoneyReadModel | null;
  period: MobilePeriodReadModel;
}

export interface MobileReviewReadModel {
  count: number;
}

export interface MobileRecentTransactionReadModel {
  /** A stable public identifier, never a database primary key. */
  publicId: string;
  occurredOn: string;
  displayName: string;
  amount: MobileMoneyReadModel;
  direction: 'debit' | 'credit' | 'unknown';
  status: 'posted' | 'pending' | 'unknown';
  category: { publicId: string; label: string } | null;
  account: {
    publicId: string;
    displayName: string;
    identifierMask: string;
  };
}

export interface MobileAccountFreshnessReadModel {
  /** A stable public identifier, never a database primary key. */
  publicId: string;
  displayName: string;
  institutionName: string;
  type: 'checking' | 'savings' | 'credit_card' | 'investment' | 'loan' | 'other' | 'unknown';
  currencyCode: string;
  identifierMask: string;
  freshness: {
    status: 'fresh' | 'stale' | 'never_synced' | 'error' | 'unknown';
    lastSuccessfulSyncAt: string | null;
  };
}

export interface MobileLatestSyncReadModel {
  status: 'succeeded' | 'partial' | 'failed' | 'never_run' | 'unknown';
  startedAt: string | null;
  completedAt: string | null;
  accountsSucceeded: number;
  accountsFailed: number;
}

/**
 * Deliberately narrow read boundary. Implementations must project into these
 * models instead of returning tables, scraper results, or service objects.
 */
export interface MobileBootstrapReadPorts {
  readHome(context: Readonly<BootstrapReadContext>): Awaitable<MobileHomeReadModel>;
  readBudgetPulse(context: Readonly<BootstrapReadContext>): Awaitable<MobileBudgetPulseReadModel>;
  readReview(context: Readonly<BootstrapReadContext>): Awaitable<MobileReviewReadModel>;
  readRecentTransactions(
    context: Readonly<BootstrapReadContext>,
  ): Awaitable<readonly MobileRecentTransactionReadModel[]>;
  readAccounts(
    context: Readonly<BootstrapReadContext>,
  ): Awaitable<readonly MobileAccountFreshnessReadModel[]>;
  readLatestSync(context: Readonly<BootstrapReadContext>): Awaitable<MobileLatestSyncReadModel>;
}

export interface MobileBootstrapServerIdentity {
  id: string;
  displayName: string;
  serverVersion: string;
  minimumClientVersion: string;
}

export interface CreateMobileBootstrapAdapterOptions {
  ports: MobileBootstrapReadPorts;
  server: MobileBootstrapServerIdentity;
  fallbackCurrencyCode: string;
  clock?: () => Date;
  /** Resolves the finance calendar date (for example in Asia/Jerusalem). */
  financialDateFor?: (instant: Date) => string;
  snapshotIdFactory?: () => string;
  completeSnapshotMaxAgeSeconds?: number;
}

export type BootstrapSectionFailureCode = BootstrapSectionError['code'];

/** A port may throw this safe classification; raw exception messages are ignored. */
export class MobileBootstrapSectionReadError extends Error {
  constructor(
    readonly code: BootstrapSectionFailureCode,
    readonly retryable: boolean,
  ) {
    super('Mobile bootstrap section read failed');
    this.name = 'MobileBootstrapSectionReadError';
  }
}

/** Indicates an adapter/programming error without exposing rejected payload details. */
export class MobileBootstrapAdapterValidationError extends Error {
  constructor() {
    super('Mobile bootstrap adapter produced an invalid public payload');
    this.name = 'MobileBootstrapAdapterValidationError';
  }
}

function mapMoney(money: MobileMoneyReadModel) {
  return { value: money.value, currencyCode: money.currencyCode };
}

function mapPeriod(period: MobilePeriodReadModel) {
  return { startDate: period.startDate, endDate: period.endDate };
}

function mapAggregate(aggregate: MobileAggregateReadModel, calculatedAt: string) {
  return {
    amount: mapMoney(aggregate.amount),
    period: mapPeriod(aggregate.period),
    comparisonPeriod: aggregate.comparisonPeriod ? mapPeriod(aggregate.comparisonPeriod) : null,
    calculatedAt,
  };
}

function mapHome(home: MobileHomeReadModel, calculatedAt: string): BootstrapData['home'] {
  return {
    primaryCurrencyCode: home.primaryCurrencyCode,
    aggregates: {
      netWorth: mapAggregate(home.netWorth, calculatedAt),
      income: mapAggregate(home.income, calculatedAt),
      spending: mapAggregate(home.spending, calculatedAt),
    },
  };
}

function mapBudgetPulse(
  pulse: MobileBudgetPulseReadModel,
  calculatedAt: string,
): BootstrapData['budgetPulse'] {
  return {
    status: pulse.status,
    spent: pulse.spent ? mapMoney(pulse.spent) : null,
    limit: pulse.limit ? mapMoney(pulse.limit) : null,
    remaining: pulse.remaining ? mapMoney(pulse.remaining) : null,
    period: mapPeriod(pulse.period),
    calculatedAt,
  };
}

function mapRecentTransactions(
  transactions: readonly MobileRecentTransactionReadModel[],
): BootstrapData['recentTransactions'] {
  return transactions.slice(0, 20).map((transaction) => ({
    id: transaction.publicId,
    occurredOn: transaction.occurredOn,
    displayName: transaction.displayName,
    amount: mapMoney(transaction.amount),
    direction: transaction.direction,
    status: transaction.status,
    category: transaction.category
      ? { id: transaction.category.publicId, label: transaction.category.label }
      : null,
    account: {
      id: transaction.account.publicId,
      displayName: transaction.account.displayName,
      identifierMask: transaction.account.identifierMask,
    },
  }));
}

function mapAccounts(
  accounts: readonly MobileAccountFreshnessReadModel[],
): BootstrapData['accounts'] {
  return accounts.map((account) => ({
    id: account.publicId,
    displayName: account.displayName,
    institutionName: account.institutionName,
    type: account.type,
    currencyCode: account.currencyCode,
    identifierMask: account.identifierMask,
    freshness: {
      status: account.freshness.status,
      lastSuccessfulSyncAt: account.freshness.lastSuccessfulSyncAt,
    },
  }));
}

function sectionError(section: BootstrapSection, reason: unknown): BootstrapSectionError {
  if (reason instanceof MobileBootstrapSectionReadError) {
    return { section, code: reason.code, retryable: reason.retryable };
  }
  return { section, code: 'unknown', retryable: true };
}

function fallbackPeriod(financialDate: string): MobilePeriodReadModel {
  return { startDate: `${financialDate.slice(0, 7)}-01`, endDate: financialDate };
}

function fallbackHome(
  currencyCode: string,
  financialDate: string,
  calculatedAt: string,
): BootstrapData['home'] {
  const amount = { value: '0.00', currencyCode };
  const today = { startDate: financialDate, endDate: financialDate };
  const month = fallbackPeriod(financialDate);
  return {
    primaryCurrencyCode: currencyCode,
    aggregates: {
      netWorth: { amount, period: today, comparisonPeriod: null, calculatedAt },
      income: { amount, period: month, comparisonPeriod: null, calculatedAt },
      spending: { amount, period: month, comparisonPeriod: null, calculatedAt },
    },
  };
}

function fallbackBudgetPulse(
  financialDate: string,
  calculatedAt: string,
): BootstrapData['budgetPulse'] {
  return {
    status: 'unavailable',
    spent: null,
    limit: null,
    remaining: null,
    period: fallbackPeriod(financialDate),
    calculatedAt,
  };
}

export function createMobileBootstrapAdapter(options: CreateMobileBootstrapAdapterOptions) {
  const clock = options.clock ?? (() => new Date());
  const snapshotIdFactory = options.snapshotIdFactory ?? randomUUID;
  const completeMaxAge = options.completeSnapshotMaxAgeSeconds ?? 300;

  return async function provideMobileBootstrap(): Promise<BootstrapSuccessEnvelope> {
    const calculationInstant = clock();
    const calculatedAt = calculationInstant.toISOString();
    const context: Readonly<BootstrapReadContext> = Object.freeze({
      calculatedAt,
      financialDate:
        options.financialDateFor?.(calculationInstant) ??
        mobileFinancialDateFor(calculationInstant),
    });

    // Deferring invocation into a promise also captures ports that throw
    // synchronously before returning their advertised Awaitable value.
    const invoke = <T>(read: () => Awaitable<T>): Promise<T> => Promise.resolve().then(read);
    const [home, budget, review, transactions, accounts, latestSync] = await Promise.allSettled([
      invoke(() => options.ports.readHome(context)),
      invoke(() => options.ports.readBudgetPulse(context)),
      invoke(() => options.ports.readReview(context)),
      invoke(() => options.ports.readRecentTransactions(context)),
      invoke(() => options.ports.readAccounts(context)),
      invoke(() => options.ports.readLatestSync(context)),
    ]);

    const sectionErrors: BootstrapSectionError[] = [];
    if (home.status === 'rejected') sectionErrors.push(sectionError('home', home.reason));
    if (budget.status === 'rejected') {
      sectionErrors.push(sectionError('budget_pulse', budget.reason));
    }
    if (review.status === 'rejected') sectionErrors.push(sectionError('review', review.reason));
    if (transactions.status === 'rejected') {
      sectionErrors.push(sectionError('recent_transactions', transactions.reason));
    }
    if (accounts.status === 'rejected') {
      sectionErrors.push(sectionError('accounts', accounts.reason));
    }
    if (latestSync.status === 'rejected') {
      sectionErrors.push(sectionError('latest_sync', latestSync.reason));
    }

    const partial = sectionErrors.length > 0;
    const generatedAt = clock().toISOString();
    const candidate = {
      data: {
        home:
          home.status === 'fulfilled'
            ? mapHome(home.value, calculatedAt)
            : fallbackHome(options.fallbackCurrencyCode, context.financialDate, calculatedAt),
        budgetPulse:
          budget.status === 'fulfilled'
            ? mapBudgetPulse(budget.value, calculatedAt)
            : fallbackBudgetPulse(context.financialDate, calculatedAt),
        review: {
          count: review.status === 'fulfilled' ? review.value.count : 0,
          calculatedAt,
        },
        recentTransactions:
          transactions.status === 'fulfilled' ? mapRecentTransactions(transactions.value) : [],
        accounts: accounts.status === 'fulfilled' ? mapAccounts(accounts.value) : [],
        latestSync:
          latestSync.status === 'fulfilled'
            ? {
                status: latestSync.value.status,
                startedAt: latestSync.value.startedAt,
                completedAt: latestSync.value.completedAt,
                accountsSucceeded: latestSync.value.accountsSucceeded,
                accountsFailed: latestSync.value.accountsFailed,
              }
            : {
                status: 'never_run' as const,
                startedAt: null,
                completedAt: null,
                accountsSucceeded: 0,
                accountsFailed: 0,
              },
      },
      meta: {
        apiVersion: MOBILE_API_VERSION,
        generatedAt,
        calculatedAt,
        financialDate: context.financialDate,
        source: MOBILE_RESPONSE_SOURCE,
        bootstrapSchemaVersion: BOOTSTRAP_SCHEMA_VERSION,
        snapshotId: snapshotIdFactory(),
        server: {
          id: options.server.id,
          displayName: options.server.displayName,
          serverVersion: options.server.serverVersion,
          protocolVersion: MOBILE_PROTOCOL_VERSION,
          minimumClientVersion: options.server.minimumClientVersion,
          capabilities: ['mobile.read' as const],
          // Bootstrap does not receive a client app version, so the server
          // cannot honestly claim it evaluated minimumClientVersion here.
          compatibility: { status: 'not_evaluated' as const, reason: null },
        },
        cacheability: partial
          ? { status: 'not_cacheable' as const, maxAgeSeconds: 0 }
          : { status: 'cacheable' as const, maxAgeSeconds: completeMaxAge },
        completeness: {
          status: partial ? ('partial' as const) : ('complete' as const),
          sectionErrors,
        },
      },
    };

    const validation = validateBootstrapPayload(candidate);
    if (!validation.success) throw new MobileBootstrapAdapterValidationError();
    return validation.data;
  };
}
