import { createHmac } from 'node:crypto';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { mobileFinancialDateFor } from './bootstrap-contract.js';
import {
  MobileBootstrapSectionReadError,
  type BootstrapReadContext,
  type MobileAccountFreshnessReadModel,
  type MobileBootstrapReadPorts,
  type MobileHomeReadModel,
  type MobileLatestSyncReadModel,
  type MobileMoneyReadModel,
  type MobileRecentTransactionReadModel,
} from './bootstrap-adapter.js';

type MoneyMonitorDatabase = BetterSQLite3Database<typeof schema>;
type Awaitable<T> = T | Promise<T>;
const ISO_CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));
const LEGACY_CURRENCY_CODE_PROJECTION: Readonly<Record<string, string>> = {
  '₪': 'ILS',
};

export { MOBILE_FINANCE_TIME_ZONE } from './bootstrap-contract.js';

export interface ProductionMobileBootstrapPortOptions {
  db: MoneyMonitorDatabase;
  /** A private key used only to pseudonymize local primary keys. */
  publicIdKey: string;
  /** Existing net-worth service projected to its single public aggregate. */
  readNetWorthIls: (context: Readonly<BootstrapReadContext>) => Awaitable<number>;
}

export function financialDateInIsrael(instant: Date): string {
  return mobileFinancialDateFor(instant);
}

function bounded(value: string, fallback: string, maximum: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return (normalized || fallback).slice(0, maximum);
}

function decimalMoney(value: number, currencyCode = 'ILS'): MobileMoneyReadModel {
  if (!Number.isFinite(value)) {
    throw new MobileBootstrapSectionReadError('calculation_failed', false);
  }
  if (!/^[A-Z]{3}$/.test(currencyCode) || !ISO_CURRENCY_CODES.has(currencyCode)) {
    throw new MobileBootstrapSectionReadError('source_unavailable', false);
  }
  const normalized = Math.abs(value) < 0.005 ? 0 : Math.round(value * 100) / 100;
  return { value: normalized.toFixed(2), currencyCode };
}

function projectedCurrencyCode(persistedCurrency: string): string {
  return LEGACY_CURRENCY_CODE_PROJECTION[persistedCurrency] ?? persistedCurrency;
}

function normalizeInstant(value: string | null): string | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const candidate = hasZone ? value : `${value.replace(' ', 'T')}Z`;
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) {
    throw new MobileBootstrapSectionReadError('source_unavailable', false);
  }
  return new Date(timestamp).toISOString();
}

function accountType(value: string): MobileAccountFreshnessReadModel['type'] {
  if (value === 'credit_card') return 'credit_card';
  return 'unknown';
}

const INSTITUTION_NAMES: Readonly<Record<string, string>> = {
  hapoalim: 'Bank Hapoalim',
  leumi: 'Bank Leumi',
  discount: 'Israel Discount Bank',
  mizrahi: 'Mizrahi-Tefahot',
  otsarHahayal: 'Otsar HaHayal',
  beinleumi: 'First International Bank',
  massad: 'Bank Massad',
  yahav: 'Bank Yahav',
  union: 'Union Bank',
  isracard: 'Isracard',
  amex: 'American Express',
  max: 'Max',
  visaCal: 'CAL',
};

function institutionName(companyId: string): string {
  return (
    INSTITUTION_NAMES[companyId] ?? bounded(companyId.replace(/[-_]+/g, ' '), 'Institution', 80)
  );
}

/** Produces a display-only suffix on the server; the raw identifier never crosses the port. */
export function maskAccountIdentifier(accountNumber: string | null): string {
  const characters = (accountNumber ?? '').replace(/[^A-Za-z0-9]/g, '');
  const suffix = characters.length >= 2 ? characters.slice(-4) : 'NA';
  return `•••• ${suffix}`;
}

function previousMonthPeriod(financialDate: string) {
  const [year, month, day] = financialDate.split('-').map(Number);
  const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
  const endDay = Math.min(day, previousMonthEnd.getUTCDate());
  const previousYear = previousMonthEnd.getUTCFullYear();
  const previousMonth = String(previousMonthEnd.getUTCMonth() + 1).padStart(2, '0');
  return {
    startDate: `${previousYear}-${previousMonth}-01`,
    endDate: `${previousYear}-${previousMonth}-${String(endDay).padStart(2, '0')}`,
  };
}

function currentMonthPeriod(financialDate: string) {
  return { startDate: `${financialDate.slice(0, 7)}-01`, endDate: financialDate };
}

function yearlyPeriod(financialDate: string) {
  return { startDate: `${financialDate.slice(0, 4)}-01-01`, endDate: financialDate };
}

function asSafeSectionRead<T>(read: () => Awaitable<T>): Promise<T> {
  return Promise.resolve()
    .then(read)
    .catch((error: unknown) => {
      if (error instanceof MobileBootstrapSectionReadError) throw error;
      throw new MobileBootstrapSectionReadError('source_unavailable', true);
    });
}

export function createProductionMobileBootstrapPorts(
  options: ProductionMobileBootstrapPortOptions,
): MobileBootstrapReadPorts {
  if (options.publicIdKey.length < 32) {
    throw new Error('Mobile public ID key must contain at least 32 characters');
  }

  const publicId = (kind: 'account' | 'category' | 'transaction', localId: number | string) => {
    const digest = createHmac('sha256', options.publicIdKey)
      .update(`${kind}:${String(localId)}`)
      .digest('base64url')
      .slice(0, 22);
    return `${kind}_${digest}`;
  };

  function cashflow(period: { startDate: string; endDate: string }) {
    const result = options.db
      .select({
        income: sql<number>`COALESCE(SUM(CASE WHEN ${schema.transactions.chargedAmount} > 0 THEN ${schema.transactions.chargedAmount} ELSE 0 END), 0)`,
        spending: sql<number>`COALESCE(SUM(CASE WHEN ${schema.transactions.chargedAmount} < 0 THEN ABS(${schema.transactions.chargedAmount}) ELSE 0 END), 0)`,
      })
      .from(schema.transactions)
      .where(
        and(
          gte(schema.transactions.date, period.startDate),
          lte(schema.transactions.date, period.endDate),
          eq(schema.transactions.ignored, false),
        ),
      )
      .get();
    return { income: result?.income ?? 0, spending: result?.spending ?? 0 };
  }

  return {
    readHome: (context) =>
      asSafeSectionRead(async (): Promise<MobileHomeReadModel> => {
        const period = currentMonthPeriod(context.financialDate);
        const comparisonPeriod = previousMonthPeriod(context.financialDate);
        const current = cashflow(period);
        const netWorth = await options.readNetWorthIls(context);
        return {
          primaryCurrencyCode: 'ILS',
          netWorth: {
            amount: decimalMoney(netWorth),
            period: {
              startDate: context.financialDate,
              endDate: context.financialDate,
            },
            comparisonPeriod: null,
          },
          income: {
            amount: decimalMoney(current.income),
            period,
            comparisonPeriod,
          },
          spending: {
            amount: decimalMoney(current.spending),
            period,
            comparisonPeriod,
          },
        };
      }),

    readBudgetPulse: (context) =>
      asSafeSectionRead(() => {
        const activeBudgets = options.db
          .select({
            amount: schema.budgets.amount,
            period: schema.budgets.period,
            categoryNames: schema.budgets.categoryNames,
            alertThreshold: schema.budgets.alertThreshold,
          })
          .from(schema.budgets)
          .where(eq(schema.budgets.isActive, true))
          .all();

        // The v1 contract has one pulse, while the desktop supports multiple
        // overlapping budgets. Do not invent a misleading aggregate.
        if (activeBudgets.length !== 1) {
          return {
            status: 'unavailable' as const,
            spent: null,
            limit: null,
            remaining: null,
            period: currentMonthPeriod(context.financialDate),
          };
        }

        const budget = activeBudgets[0];
        const period =
          budget.period === 'yearly'
            ? yearlyPeriod(context.financialDate)
            : currentMonthPeriod(context.financialDate);
        const parsed = JSON.parse(budget.categoryNames) as unknown;
        if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== 'string')) {
          throw new MobileBootstrapSectionReadError('calculation_failed', false);
        }
        const categoryNames = parsed as string[];
        const spent =
          categoryNames.length === 0
            ? 0
            : (options.db
                .select({
                  total: sql<number>`COALESCE(SUM(ABS(${schema.transactions.chargedAmount})), 0)`,
                })
                .from(schema.transactions)
                .where(
                  and(
                    sql`${schema.transactions.category} IN (${sql.join(
                      categoryNames.map((name) => sql`${name}`),
                      sql`, `,
                    )})`,
                    gte(schema.transactions.date, period.startDate),
                    lte(schema.transactions.date, period.endDate),
                    eq(schema.transactions.ignored, false),
                    sql`${schema.transactions.chargedAmount} < 0`,
                  ),
                )
                .get()?.total ?? 0);
        const remaining = budget.amount - spent;
        const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
        const status =
          remaining < 0
            ? ('over_budget' as const)
            : percentage >= budget.alertThreshold
              ? ('watch' as const)
              : ('on_track' as const);
        return {
          status,
          spent: decimalMoney(spent),
          limit: decimalMoney(budget.amount),
          remaining: decimalMoney(remaining),
          period,
        };
      }),

    readReview: () =>
      asSafeSectionRead(() => {
        const row = options.db
          .select({ count: sql<number>`COUNT(*)` })
          .from(schema.transactions)
          .where(eq(schema.transactions.needsReview, true))
          .get();
        return { count: row?.count ?? 0 };
      }),

    readRecentTransactions: (context) =>
      asSafeSectionRead((): MobileRecentTransactionReadModel[] => {
        const rows = options.db
          .select({
            transactionId: schema.transactions.id,
            occurredOn: schema.transactions.date,
            description: schema.transactions.description,
            chargedAmount: schema.transactions.chargedAmount,
            chargedCurrency: schema.transactions.chargedCurrency,
            transactionStatus: schema.transactions.status,
            categoryName: schema.transactions.category,
            categoryId: schema.categories.id,
            categoryLabel: schema.categories.label,
            accountId: schema.accounts.id,
            accountName: schema.accounts.displayName,
            accountNumber: schema.accounts.accountNumber,
          })
          .from(schema.transactions)
          .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
          .leftJoin(schema.categories, eq(schema.transactions.category, schema.categories.name))
          // Installment schedules can contain future-dated rows. Apply the
          // finance-day ceiling before ordering and limiting so they cannot
          // displace transactions that have actually occurred.
          .where(lte(schema.transactions.date, context.financialDate))
          .orderBy(desc(schema.transactions.date), desc(schema.transactions.id))
          .limit(20)
          .all();

        return rows.map((row) => ({
          publicId: publicId('transaction', row.transactionId),
          occurredOn: row.occurredOn.slice(0, 10),
          displayName: bounded(row.description, 'Transaction', 160),
          amount: decimalMoney(
            Math.abs(row.chargedAmount),
            projectedCurrencyCode(row.chargedCurrency),
          ),
          direction: row.chargedAmount < 0 ? 'debit' : row.chargedAmount > 0 ? 'credit' : 'unknown',
          status:
            row.transactionStatus === 'pending'
              ? 'pending'
              : row.transactionStatus === 'completed'
                ? 'posted'
                : 'unknown',
          category:
            row.categoryName && row.categoryId != null
              ? {
                  publicId: publicId('category', row.categoryId),
                  label: bounded(row.categoryLabel ?? row.categoryName, 'Category', 80),
                }
              : null,
          account: {
            publicId: publicId('account', row.accountId),
            displayName: bounded(row.accountName, 'Account', 80),
            identifierMask: maskAccountIdentifier(row.accountNumber),
          },
        }));
      }),

    readAccounts: (context) =>
      asSafeSectionRead((): MobileAccountFreshnessReadModel[] => {
        const rows = options.db
          .select({
            id: schema.accounts.id,
            displayName: schema.accounts.displayName,
            companyId: schema.accounts.companyId,
            accountType: schema.accounts.accountType,
            accountNumber: schema.accounts.accountNumber,
            lastScrapedAt: schema.accounts.lastScrapedAt,
            stalenessDays: schema.accounts.stalenessDays,
          })
          .from(schema.accounts)
          .where(eq(schema.accounts.isActive, true))
          .orderBy(schema.accounts.id)
          .all();

        return rows.map((row) => {
          const lastSuccessfulSyncAt = normalizeInstant(row.lastScrapedAt);
          let freshness: MobileAccountFreshnessReadModel['freshness']['status'] = 'never_synced';
          if (lastSuccessfulSyncAt) {
            const ageMs = Math.max(
              0,
              Date.parse(context.calculatedAt) - Date.parse(lastSuccessfulSyncAt),
            );
            const allowedDays = row.stalenessDays ?? 2;
            freshness = ageMs > allowedDays * 86_400_000 ? 'stale' : 'fresh';
          }
          return {
            publicId: publicId('account', row.id),
            displayName: bounded(row.displayName, 'Account', 80),
            institutionName: institutionName(row.companyId),
            type: accountType(row.accountType),
            currencyCode: 'ILS',
            identifierMask: maskAccountIdentifier(row.accountNumber),
            freshness: { status: freshness, lastSuccessfulSyncAt },
          };
        });
      }),

    readLatestSync: () =>
      asSafeSectionRead((): MobileLatestSyncReadModel => {
        const session = options.db
          .select({
            id: schema.scrapeSessions.id,
            status: schema.scrapeSessions.status,
            accountIds: schema.scrapeSessions.accountIds,
            startedAt: schema.scrapeSessions.startedAt,
            completedAt: schema.scrapeSessions.completedAt,
          })
          .from(schema.scrapeSessions)
          .where(sql`${schema.scrapeSessions.completedAt} IS NOT NULL`)
          .orderBy(desc(schema.scrapeSessions.completedAt), desc(schema.scrapeSessions.id))
          .limit(1)
          .get();
        if (!session) {
          return {
            status: 'never_run',
            startedAt: null,
            completedAt: null,
            accountsSucceeded: 0,
            accountsFailed: 0,
          };
        }
        const logs = options.db
          .select({ status: schema.scrapeLogs.status })
          .from(schema.scrapeLogs)
          .where(eq(schema.scrapeLogs.sessionId, session.id))
          .all();
        const succeeded = logs.filter((log) => log.status === 'success').length;
        const loggedFailures = logs.filter((log) => log.status === 'error').length;
        const targets = JSON.parse(session.accountIds) as unknown;
        const targetCount = Array.isArray(targets) ? targets.length : 0;
        const failed = Math.max(
          loggedFailures,
          targetCount - succeeded,
          session.status === 'completed' ? 0 : 1,
        );
        const status: MobileLatestSyncReadModel['status'] =
          failed === 0 ? 'succeeded' : succeeded > 0 ? 'partial' : 'failed';
        return {
          status,
          startedAt: normalizeInstant(session.startedAt),
          completedAt: normalizeInstant(session.completedAt),
          accountsSucceeded: succeeded,
          accountsFailed: failed,
        };
      }),
  };
}
