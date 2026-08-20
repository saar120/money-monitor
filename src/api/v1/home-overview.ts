import type Database from 'better-sqlite3';
import type { HomeOverviewData } from './contract.js';

type RawAccount = {
  display_name: string;
  account_type: string;
  balance: number | null;
  last_scraped_at: string | null;
  staleness_days: number | null;
};

type RawCategory = { category: string | null; amount: number; transaction_count: number };

const DAY_MS = 86_400_000;

function financialDateFor(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonths(date: string, months: number): string {
  const shifted = new Date(`${monthStart(date)}T00:00:00.000Z`);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  return shifted.toISOString().slice(0, 10);
}

function monthEnd(date: string): string {
  const shifted = new Date(`${monthStart(date)}T00:00:00.000Z`);
  shifted.setUTCMonth(shifted.getUTCMonth() + 1);
  shifted.setUTCDate(shifted.getUTCDate() - 1);
  return shifted.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number | null): { value: string; currencyCode: 'ILS' } | null {
  if (value === null || !Number.isFinite(value)) return null;
  return { value: round2(value).toFixed(2), currencyCode: 'ILS' };
}

function instant(value: string | null): string | null {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function period(startDate: string, endDate: string) {
  return { startDate, endDate };
}

function queryTotals(sqlite: Database.Database, startDate: string, endDate: string) {
  const row = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN charged_amount > 0 THEN charged_amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN charged_amount < 0 THEN ABS(charged_amount) ELSE 0 END), 0) AS expenses
       FROM transactions
       WHERE date >= ? AND date <= ? AND ignored = 0 AND type != 'transfer'
         AND charged_currency = 'ILS'`,
    )
    .get(startDate, endDate) as { income: number; expenses: number };
  return { income: row.income ?? 0, expenses: row.expenses ?? 0 };
}

function queryCategories(
  sqlite: Database.Database,
  startDate: string,
  endDate: string,
): RawCategory[] {
  return sqlite
    .prepare(
      `SELECT COALESCE(t.category, 'uncategorized') AS category,
              COALESCE(SUM(ABS(t.charged_amount)), 0) AS amount,
              COUNT(*) AS transaction_count
       FROM transactions t
       WHERE t.date >= ? AND t.date <= ? AND t.ignored = 0
         AND t.charged_amount < 0 AND t.type != 'transfer'
         AND t.charged_currency = 'ILS'
       GROUP BY COALESCE(t.category, 'uncategorized')
       ORDER BY amount DESC, category ASC`,
    )
    .all(startDate, endDate) as RawCategory[];
}

function categoryLabel(sqlite: Database.Database, name: string): string {
  const row = sqlite.prepare('SELECT label FROM categories WHERE name = ?').get(name) as
    | { label: string }
    | undefined;
  return row?.label?.trim() || name.replace(/[-_]+/g, ' ');
}

function budgetProjection(
  sqlite: Database.Database,
  financialDate: string,
): HomeOverviewData['budget'] {
  const budgets = sqlite
    .prepare(
      `SELECT name, amount, period, category_names, alert_threshold
       FROM budgets WHERE is_active = 1 ORDER BY id ASC`,
    )
    .all() as Array<{
    name: string;
    amount: number;
    period: string;
    category_names: string;
    alert_threshold: number;
  }>;
  if (budgets.length !== 1) return null;

  const budget = budgets[0];
  let categories: string[] = [];
  try {
    const parsed = JSON.parse(budget.category_names) as unknown;
    if (Array.isArray(parsed))
      categories = parsed.filter((name): name is string => typeof name === 'string');
  } catch {
    return null;
  }
  const startDate =
    budget.period === 'yearly' ? `${financialDate.slice(0, 4)}-01-01` : monthStart(financialDate);
  const spent =
    categories.length === 0
      ? 0
      : (
          sqlite
            .prepare(
              `SELECT COALESCE(SUM(ABS(charged_amount)), 0) AS spent
           FROM transactions
           WHERE date >= ? AND date <= ? AND ignored = 0 AND charged_amount < 0
             AND type != 'transfer' AND charged_currency = 'ILS'
             AND category IN (${categories.map(() => '?').join(',')})`,
            )
            .get(startDate, financialDate, ...categories) as { spent: number }
        ).spent;
  const remaining = round2(budget.amount - spent);
  const ratio = budget.amount > 0 ? spent / budget.amount : 0;
  const state =
    remaining < 0
      ? 'over_budget'
      : remaining === 0
        ? 'at_limit'
        : ratio >= (budget.alert_threshold ?? 80) / 100
          ? 'watch'
          : 'on_track';
  return {
    state,
    name: budget.name.trim() || 'Budget',
    spent: money(spent)!,
    limit: money(budget.amount)!,
    remaining: money(remaining)!,
    period: period(startDate, financialDate),
  };
}

function accountFreshness(
  sqlite: Database.Database,
  calculatedAt: Date,
): {
  values: HomeOverviewData['accountFreshness'];
  missing: boolean;
} {
  const accounts = sqlite
    .prepare(
      `SELECT display_name, account_type, balance, last_scraped_at, staleness_days
       FROM accounts WHERE is_active = 1 ORDER BY id ASC`,
    )
    .all() as RawAccount[];
  let missing = false;
  const values = accounts.map((account) => {
    const lastSuccessfulSyncAt = instant(account.last_scraped_at);
    const threshold = (account.staleness_days ?? 2) * DAY_MS;
    const status = !lastSuccessfulSyncAt
      ? ('unknown' as const)
      : calculatedAt.getTime() - Date.parse(lastSuccessfulSyncAt) > threshold
        ? ('stale' as const)
        : ('current' as const);
    if (account.account_type === 'bank' && account.balance === null) missing = true;
    return { displayName: account.display_name.trim() || 'Account', status, lastSuccessfulSyncAt };
  });
  return { values, missing };
}

function netWorth(sqlite: Database.Database): {
  value: HomeOverviewData['netWorth'];
  missing: boolean;
} {
  const bank = sqlite
    .prepare(
      `SELECT COALESCE(SUM(balance), 0) AS total, COUNT(*) AS count,
                     SUM(CASE WHEN balance IS NULL THEN 1 ELSE 0 END) AS missing
              FROM accounts WHERE is_active = 1 AND account_type = 'bank'`,
    )
    .get() as { total: number; count: number; missing: number | null };
  const assets = sqlite
    .prepare(
      `SELECT a.id, (
         SELECT s.total_value_ils FROM asset_snapshots s
         WHERE s.asset_id = a.id ORDER BY s.date DESC, s.id DESC LIMIT 1
       ) AS value
       FROM assets a WHERE a.is_active = 1`,
    )
    .all() as Array<{ id: number; value: number | null }>;
  const liabilities = sqlite
    .prepare(`SELECT current_balance, currency FROM liabilities WHERE is_active = 1`)
    .all() as Array<{ current_balance: number; currency: string }>;
  const missing =
    (bank.missing ?? 0) > 0 ||
    assets.some((asset) => asset.value === null) ||
    liabilities.some((liability) => liability.currency !== 'ILS');
  if (missing) return { value: { total: null, liquid: null }, missing: true };
  const assetTotal = assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0);
  const liabilityTotal = liabilities.reduce((sum, liability) => sum + liability.current_balance, 0);
  const total = bank.total + assetTotal - liabilityTotal;
  return {
    value: { total: money(total), liquid: money(bank.total - liabilityTotal) },
    missing: false,
  };
}

export function createHomeOverviewProjection(sqlite: Database.Database) {
  return Object.freeze({
    read(calculatedAt: Date): HomeOverviewData {
      const financialDate = financialDateFor(calculatedAt);
      const currentStart = monthStart(financialDate);
      const elapsedDays = Number(financialDate.slice(8, 10));
      const previousMonthStart = shiftMonths(financialDate, -1);
      const previousMonthEnd = monthEnd(previousMonthStart);
      const comparisonElapsedDays = Math.min(elapsedDays, Number(previousMonthEnd.slice(8, 10)));
      const comparisonEnd = shiftDays(previousMonthStart, comparisonElapsedDays - 1);
      const comparisonStart = monthStart(comparisonEnd);
      const currentTotals = queryTotals(sqlite, currentStart, financialDate);
      const comparisonTotals = queryTotals(sqlite, comparisonStart, comparisonEnd);
      const categoryRows = queryCategories(sqlite, currentStart, financialDate);
      const currentExpenses = categoryRows.reduce((sum, row) => sum + row.amount, 0);
      const categories = categoryRows.map((row) => ({
        label: categoryLabel(sqlite, row.category ?? 'uncategorized'),
        amount: money(row.amount)!,
        share: currentExpenses > 0 ? round2(row.amount / currentExpenses) : 0,
        transactionCount: row.transaction_count,
        textSummary: `${categoryLabel(sqlite, row.category ?? 'uncategorized')} accounts for ₪${round2(row.amount).toFixed(2)}, or ${currentExpenses > 0 ? ((row.amount / currentExpenses) * 100).toFixed(1) : '0.0'}% of spending.`,
        drillDown: {
          category: row.category ?? 'uncategorized',
          startDate: currentStart,
          endDate: financialDate,
        },
      }));
      const cashFlow = Array.from({ length: 12 }, (_, index) => {
        const startDate = shiftMonths(financialDate, index - 11);
        const endDate = index === 11 ? financialDate : monthEnd(startDate);
        const totals = queryTotals(sqlite, startDate, endDate);
        const label = new Intl.DateTimeFormat('en-US', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${startDate}T00:00:00.000Z`));
        return {
          period: period(startDate, endDate),
          income: money(totals.income)!,
          expenses: money(totals.expenses)!,
          net: money(totals.income - totals.expenses)!,
          textSummary: `${label}: ₪${round2(totals.income).toFixed(2)} in and ₪${round2(totals.expenses).toFixed(2)} out.`,
          drillDown: { startDate, endDate },
        };
      });
      const accounts = accountFreshness(sqlite, calculatedAt);
      const worth = netWorth(sqlite);
      const availableRow = sqlite
        .prepare(
          `SELECT SUM(balance) AS total, SUM(CASE WHEN balance IS NULL THEN 1 ELSE 0 END) AS missing
                  FROM accounts WHERE is_active = 1 AND account_type = 'bank'`,
        )
        .get() as { total: number | null; missing: number | null };
      const rowCounts = sqlite
        .prepare(
          `SELECT
                    (SELECT COUNT(*) FROM accounts WHERE is_active = 1) AS accounts,
                    (SELECT COUNT(*) FROM transactions WHERE ignored = 0) AS transactions,
                    (SELECT COUNT(*) FROM budgets WHERE is_active = 1) AS budgets,
                    (SELECT COUNT(*) FROM assets WHERE is_active = 1) AS assets,
                    (SELECT COUNT(*) FROM liabilities WHERE is_active = 1) AS liabilities`,
        )
        .get() as Record<string, number>;
      return {
        financialDate,
        calculatedAt: calculatedAt.toISOString(),
        baseCurrencyCode: 'ILS',
        availableMoney: money(availableRow.total),
        spending: {
          current: {
            amount: money(currentTotals.expenses)!,
            period: period(currentStart, financialDate),
          },
          comparison: {
            amount: money(comparisonTotals.expenses)!,
            period: period(comparisonStart, comparisonEnd),
          },
          change: money(currentTotals.expenses - comparisonTotals.expenses)!,
        },
        budget: budgetProjection(sqlite, financialDate),
        netWorth: worth.value,
        categories,
        cashFlow,
        accountFreshness: accounts.values,
        isEmpty: Object.values(rowCounts).every((count) => count === 0),
      };
    },
  });
}
