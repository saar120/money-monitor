import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import {
  boundedMobileText,
  mobileTransactionDisplayName,
  projectMobileMoney,
} from './mobile-transaction-projection.js';
import type { MobileOverviewData, MobileOverviewQuery } from './overview-contract.js';
import type { MobileTransactionReadContext } from './transaction-routes.js';

type Database = BetterSQLite3Database<typeof schema>;
type NetWorthDetails = {
  total: number;
  assetsTotal: number;
  liabilitiesTotal: number;
};

export interface MobileOverviewPortsOptions {
  db: Database;
  readNetWorth: () => NetWorthDetails | Promise<NetWorthDetails>;
  readNetWorthHistory: (
    startDate: string,
    endDate: string,
  ) => Promise<Array<{ date: string; total: number }>>;
}

function monthRange(month: string, financialDate: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const isCurrent = financialDate.startsWith(month);
  const endDay = isCurrent ? Number(financialDate.slice(8, 10)) : lastDay;
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${String(endDay).padStart(2, '0')}`,
    daysInMonth: lastDay,
    elapsedDays: endDay,
  };
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function money(value: number) {
  return projectMobileMoney(Math.round(value * 100) / 100, 'ILS');
}

function normalizeMerchant(value: string) {
  const normalized = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d{2}\/\d{2}(?:\/\d{2,4})?/g, '')
    .replace(/\s*#?\d{5,}$/g, '')
    .trim();
  return mobileTransactionDisplayName(normalized);
}

function categoryNames(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : [];
  } catch {
    return [];
  }
}

export function createMobileOverviewProvider(options: MobileOverviewPortsOptions) {
  function periodRows(startDate: string, endDate: string) {
    return options.db
      .select({
        date: schema.transactions.reportingDate,
        amount: schema.transactions.chargedAmount,
        description: schema.transactions.description,
        category: schema.transactions.category,
      })
      .from(schema.transactions)
      .where(
        and(
          gte(schema.transactions.reportingDate, startDate),
          lte(schema.transactions.reportingDate, endDate),
          eq(schema.transactions.ignored, false),
        ),
      )
      .all();
  }

  return async function provideOverview(
    query: Readonly<MobileOverviewQuery>,
    context: Readonly<MobileTransactionReadContext>,
  ): Promise<MobileOverviewData> {
    const requestedMonth = query.month ?? context.financialDate.slice(0, 7);
    if (requestedMonth > context.financialDate.slice(0, 7)) throw new Error('Future month');
    const range = monthRange(requestedMonth, context.financialDate);
    const previous = monthRange(previousMonth(requestedMonth), context.financialDate);
    previous.endDate = `${previous.startDate.slice(0, 7)}-${String(Math.min(range.elapsedDays, previous.daysInMonth)).padStart(2, '0')}`;

    const [currentRows, previousRows, netWorth, netWorthHistory] = await Promise.all([
      Promise.resolve(periodRows(range.startDate, range.endDate)),
      Promise.resolve(periodRows(previous.startDate, previous.endDate)),
      options.readNetWorth(),
      options.readNetWorthHistory(
        `${Number(requestedMonth.slice(0, 4)) - 1}-${requestedMonth.slice(5)}-01`,
        range.endDate,
      ),
    ]);
    const currentExpenses = currentRows.filter((row) => row.amount < 0);
    const previousExpenses = previousRows.filter((row) => row.amount < 0);
    const categoryRows = (rows: typeof currentRows) =>
      rows.filter((row) => row.category !== 'income' && (row.amount < 0 || row.category !== null));
    const currentCategoryRows = categoryRows(currentRows);
    const previousCategoryRows = categoryRows(previousRows);

    const income =
      options.db
        .select({ total: sql<number>`COALESCE(SUM(${schema.transactions.chargedAmount}), 0)` })
        .from(schema.transactions)
        .where(
          and(
            gte(schema.transactions.reportingDate, range.startDate),
            lte(schema.transactions.reportingDate, range.endDate),
            eq(schema.transactions.ignored, false),
            sql`${schema.transactions.chargedAmount} > 0`,
          ),
        )
        .get()?.total ?? 0;

    const currentTotal = currentExpenses.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    const previousTotal = previousExpenses.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    const categoryMeta = new Map(
      options.db
        .select({
          name: schema.categories.name,
          label: schema.categories.label,
          color: schema.categories.color,
        })
        .from(schema.categories)
        .all()
        .map((category) => [category.name, category] as const),
    );
    const categoryLabel = (name: string) => categoryMeta.get(name)?.label ?? name;
    const categoryTotals = (rows: typeof currentCategoryRows) => {
      const totals = new Map<string, number>();
      for (const row of rows) {
        const category = row.category ?? 'Uncategorized';
        totals.set(category, (totals.get(category) ?? 0) - row.amount);
      }
      return totals;
    };
    const currentCategories = categoryTotals(currentCategoryRows);
    const previousCategories = categoryTotals(previousCategoryRows);
    const categories = [...new Set([...currentCategories.keys(), ...previousCategories.keys()])]
      .map((name) => {
        const current = currentCategories.get(name) ?? 0;
        const previousValue = previousCategories.get(name) ?? 0;
        const meta = categoryMeta.get(name);
        return {
          name,
          label: boundedMobileText(meta?.label ?? name, 'Category', 80),
          color: meta?.color ?? null,
          current: money(current),
          previous: money(previousValue),
          delta: money(current - previousValue),
        };
      })
      .sort((a, b) => Math.abs(Number(b.current.value)) - Math.abs(Number(a.current.value)))
      .slice(0, 30);

    const merchantTotals = (rows: typeof currentCategoryRows) => {
      const totals = new Map<string, { amount: number; category: string; count: number }>();
      for (const row of rows) {
        const name = normalizeMerchant(row.description) || 'Transaction';
        const existing = totals.get(name) ?? {
          amount: 0,
          category: row.category ?? 'Uncategorized',
          count: 0,
        };
        existing.amount -= row.amount;
        existing.count += 1;
        totals.set(name, existing);
      }
      return totals;
    };
    const currentMerchants = merchantTotals(currentCategoryRows);
    const previousMerchants = merchantTotals(previousCategoryRows);
    const merchants = [...new Set([...currentMerchants.keys(), ...previousMerchants.keys()])]
      .map((name) => {
        const current = currentMerchants.get(name);
        const previousValue = previousMerchants.get(name);
        const currentAmount = current?.amount ?? 0;
        const previousAmount = previousValue?.amount ?? 0;
        return {
          name: boundedMobileText(name, 'Merchant', 160),
          category: boundedMobileText(
            categoryLabel(current?.category ?? previousValue?.category ?? 'Uncategorized'),
            'Category',
            80,
          ),
          current: money(currentAmount),
          previous: money(previousAmount),
          delta: money(currentAmount - previousAmount),
          transactionCount: current?.count ?? 0,
        };
      })
      .sort((a, b) => Math.abs(Number(b.delta.value)) - Math.abs(Number(a.delta.value)))
      .slice(0, 30);

    const cumulative = (rows: typeof currentExpenses, days: number) => {
      const byDay = new Map<number, number>();
      for (const row of rows) {
        const day = Number(row.date.slice(8, 10));
        byDay.set(day, (byDay.get(day) ?? 0) + Math.abs(row.amount));
      }
      let total = 0;
      return Array.from({ length: days }, (_, index) => {
        total += byDay.get(index + 1) ?? 0;
        return total;
      });
    };
    const currentDaily = cumulative(currentExpenses, range.elapsedDays);
    const previousDaily = cumulative(previousExpenses, range.elapsedDays);

    const budgets = options.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.isActive, true))
      .all()
      .map((budget) => {
        const names = categoryNames(budget.categoryNames);
        if (budget.period !== 'monthly') return null;
        const spent = currentExpenses
          .filter((row) => names.includes(row.category ?? ''))
          .reduce((sum, row) => sum + Math.abs(row.amount), 0);
        const usedPercent = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
        return {
          name: boundedMobileText(budget.name, 'Budget', 80),
          spent: money(spent),
          limit: money(budget.amount),
          remaining: money(budget.amount - spent),
          usedPercent: Math.round(usedPercent),
          elapsedPercent: Math.round((range.elapsedDays / range.daysInMonth) * 100),
          status:
            spent > budget.amount
              ? ('over_budget' as const)
              : usedPercent > (range.elapsedDays / range.daysInMonth) * 100 + 10
                ? ('watch' as const)
                : ('on_track' as const),
        };
      })
      .filter((budget): budget is NonNullable<typeof budget> => budget !== null)
      .sort((a, b) =>
        a.status === 'over_budget'
          ? -1
          : b.status === 'over_budget'
            ? 1
            : b.usedPercent - a.usedPercent,
      )
      .slice(0, 20);

    const reviewCount =
      options.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.needsReview, true),
            lte(schema.transactions.date, context.financialDate),
          ),
        )
        .get()?.count ?? 0;
    const sinceLastVisit = query.since
      ? options.db
          .select({
            transactions: sql<number>`COUNT(*)`,
            spent: sql<number>`COALESCE(SUM(CASE WHEN ${schema.transactions.chargedAmount} < 0 THEN ABS(${schema.transactions.chargedAmount}) ELSE 0 END), 0)`,
          })
          .from(schema.transactions)
          .where(
            and(
              sql`datetime(${schema.transactions.createdAt}) >= datetime(${query.since})`,
              sql`datetime(${schema.transactions.createdAt}) <= datetime(${context.generatedAt})`,
            ),
          )
          .get()
      : null;

    const history = netWorthHistory
      .slice(-36)
      .map((point) => ({ date: point.date.slice(0, 10), total: money(point.total) }));
    const prior = history.length > 1 ? Number(history.at(-2)?.total.value ?? netWorth.total) : null;
    return {
      financialDate: context.financialDate,
      currencyCode: 'ILS',
      period: {
        month: requestedMonth,
        label: new Intl.DateTimeFormat('en', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${requestedMonth}-01T12:00:00Z`)),
        startDate: range.startDate,
        endDate: range.endDate,
        elapsedPercent: Math.round((range.elapsedDays / range.daysInMonth) * 100),
      },
      cashflow: {
        spending: money(currentTotal),
        income: money(income),
        previousSpending: money(previousTotal),
        paceDelta: money(currentTotal - previousTotal),
        spendingVsIncomePercent: income > 0 ? Math.round((currentTotal / income) * 100) : null,
      },
      daily: currentDaily.map((current, index) => ({
        day: index + 1,
        current: money(current),
        previous: money(previousDaily[index] ?? 0),
      })),
      categories,
      merchants,
      budgets,
      reviewCount,
      sinceLastVisit: sinceLastVisit
        ? { transactions: sinceLastVisit.transactions, spent: money(sinceLastVisit.spent) }
        : null,
      netWorth: {
        total: money(netWorth.total),
        change: prior === null ? null : money(netWorth.total - prior),
        assets: money(netWorth.assetsTotal),
        liabilities: money(netWorth.liabilitiesTotal),
        history,
      },
    };
  };
}
