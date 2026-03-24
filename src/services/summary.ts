import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';
import { buildTransactionFilters, type TransactionFilterParams } from './transactions.js';
import { monthsAgoStart, toIsraelDateStr } from '../shared/dates.js';

// ── Helpers ──

const round2 = (n: number): number => Math.round(n * 100) / 100;

function normalizeDescription(desc: string): string {
  return desc
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, '')
    .replace(/\s*\d{5,}$/g, '')
    .replace(/\s*#\d+$/g, '')
    .trim();
}

// ── Spending Summary ──

export function getSpendingSummary(
  filters: TransactionFilterParams,
  groupBy: 'category' | 'month' | 'account' | 'cashflow' | 'cashflow-detail',
) {
  const { conditions, empty } = buildTransactionFilters(filters);
  if (empty) return { groupBy, summary: [] };
  conditions.push(eq(transactions.ignored, false));

  const where = and(...conditions);

  if (groupBy === 'cashflow') {
    const rows = db.select({
      month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as('month'),
      income: sql<number>`SUM(CASE WHEN ${transactions.chargedAmount} > 0 THEN ${transactions.chargedAmount} ELSE 0 END)`.as('income'),
      expense: sql<number>`SUM(CASE WHEN ${transactions.chargedAmount} < 0 THEN ABS(${transactions.chargedAmount}) ELSE 0 END)`.as('expense'),
    }).from(transactions).where(where)
      .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
      .orderBy(sql`month desc`).all();
    return { groupBy: 'cashflow' as const, summary: rows };
  }

  if (groupBy === 'cashflow-detail') {
    const income = db.select({
      category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
      amount: sql<number>`SUM(${transactions.chargedAmount})`.as('amount'),
    }).from(transactions).where(and(...conditions, sql`${transactions.chargedAmount} > 0`))
      .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
      .orderBy(sql`amount desc`).all();

    const expenses = db.select({
      category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
      amount: sql<number>`SUM(ABS(${transactions.chargedAmount}))`.as('amount'),
    }).from(transactions).where(and(...conditions, sql`${transactions.chargedAmount} < 0`))
      .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
      .orderBy(sql`amount desc`).all();

    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
    const surplus = round2(totalIncome - totalExpenses);

    return {
      groupBy: 'cashflow-detail' as const,
      summary: { income, expenses, totalIncome: round2(totalIncome), totalExpenses: round2(totalExpenses), surplus },
    };
  }

  if (groupBy === 'month') {
    const rows = db.select({
      month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as('month'),
      totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
      transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
    }).from(transactions).where(where)
      .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
      .orderBy(sql`month desc`).all();
    return { groupBy: 'month' as const, summary: rows };
  }

  if (groupBy === 'account') {
    const rows = db.select({
      accountId: transactions.accountId,
      displayName: accounts.displayName,
      companyId: accounts.companyId,
      totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
      transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
    }).from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(where)
      .groupBy(transactions.accountId).all();
    return { groupBy: 'account' as const, summary: rows };
  }

  // Default: category
  const rows = db.select({
    category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
    totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
    transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
  }).from(transactions).where(where)
    .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
    .orderBy(sql`total_amount desc`).all();
  return { groupBy: 'category' as const, summary: rows };
}

// ── Compare Periods ──

export function comparePeriods(input: {
  period1Start: string; period1End: string;
  period2Start: string; period2End: string;
  accountId?: number;
}) {
  function queryPeriod(start: string, end: string) {
    const conditions = [
      gte(transactions.date, start),
      lte(transactions.date, end),
      eq(transactions.ignored, false),
    ];
    if (input.accountId != null) conditions.push(eq(transactions.accountId, input.accountId));

    return db.select({
      category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
      totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
      count: sql<number>`COUNT(*)`.as('count'),
    }).from(transactions)
      .where(and(...conditions))
      .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
      .all();
  }

  const p1 = queryPeriod(input.period1Start, input.period1End);
  const p2 = queryPeriod(input.period2Start, input.period2End);

  interface PeriodRow { category: string; totalAmount: number; count: number }
  const p1Map = new Map<string, PeriodRow>();
  for (const r of p1) p1Map.set(r.category, r as PeriodRow);
  const p2Map = new Map<string, PeriodRow>();
  for (const r of p2) p2Map.set(r.category, r as PeriodRow);
  const allCategories = new Set([...p1Map.keys(), ...p2Map.keys()]);

  const comparison = [...allCategories].map(category => {
    const t1 = p1Map.get(category)?.totalAmount ?? 0;
    const t2 = p2Map.get(category)?.totalAmount ?? 0;
    const c1 = p1Map.get(category)?.count ?? 0;
    const c2 = p2Map.get(category)?.count ?? 0;
    const changeAmount = t2 - t1;
    const changePercent = t1 !== 0 ? (changeAmount / Math.abs(t1)) * 100 : null;
    return {
      category,
      period1_total: round2(t1), period1_count: c1,
      period2_total: round2(t2), period2_count: c2,
      change_amount: round2(changeAmount),
      change_percent: changePercent != null ? Math.round(changePercent * 10) / 10 : null,
    };
  }).sort((a, b) => Math.abs(b.change_amount) - Math.abs(a.change_amount));

  const p1Total = p1.reduce((s, r) => s + r.totalAmount, 0);
  const p2Total = p2.reduce((s, r) => s + r.totalAmount, 0);
  const overallChange = p2Total - p1Total;

  return {
    comparison,
    summary: {
      period1: { start: input.period1Start, end: input.period1End, total: round2(p1Total) },
      period2: { start: input.period2Start, end: input.period2End, total: round2(p2Total) },
      change_amount: round2(overallChange),
      change_percent: p1Total !== 0 ? Math.round((overallChange / Math.abs(p1Total)) * 100 * 10) / 10 : null,
    },
  };
}

// ── Spending Trends ──

export function getSpendingTrends(input: {
  months?: number;
  category?: string;
  accountId?: number;
}) {
  const months = Math.min(input.months ?? 6, 24);
  const startStr = monthsAgoStart(months);

  const conditions = [
    gte(transactions.date, startStr),
    eq(transactions.ignored, false),
  ];
  if (input.category) conditions.push(eq(transactions.category, input.category));
  if (input.accountId != null) conditions.push(eq(transactions.accountId, input.accountId));

  const rows = db.select({
    month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as('month'),
    totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
    count: sql<number>`COUNT(*)`.as('count'),
  }).from(transactions)
    .where(and(...conditions))
    .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
    .orderBy(sql`month asc`)
    .all();

  if (rows.length === 0) {
    return { months: [] as typeof rows, trend: 'no_data' as const, average: 0, total_period: 0 };
  }

  const totals = rows.map(r => r.totalAmount);
  const totalSum = totals.reduce((s, v) => s + v, 0);
  const average = totalSum / totals.length;
  const minRow = rows.reduce((m, r) => r.totalAmount < m.totalAmount ? r : m);
  const maxRow = rows.reduce((m, r) => r.totalAmount > m.totalAmount ? r : m);

  const mom = rows.slice(1).map((r, i) => {
    const prev = rows[i].totalAmount;
    const change = r.totalAmount - prev;
    return {
      from: rows[i].month, to: r.month,
      change_amount: change,
      change_percent: prev !== 0 ? Math.round((change / Math.abs(prev)) * 100 * 10) / 10 : null,
    };
  });

  const mid = Math.floor(totals.length / 2);
  const firstHalf = totals.slice(0, mid);
  const secondHalf = totals.slice(mid);
  const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;
  const threshold = average * 0.05;
  let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (secondAvg - firstAvg > threshold) trend = 'increasing';
  else if (firstAvg - secondAvg > threshold) trend = 'decreasing';

  return {
    months: rows, trend,
    average: round2(average),
    min: { month: minRow.month, total: minRow.totalAmount },
    max: { month: maxRow.month, total: maxRow.totalAmount },
    total_period: totalSum,
    month_over_month: mom,
  };
}

// ── Recurring Transactions ──

export function detectRecurringTransactions(input: {
  monthsBack?: number;
  minOccurrences?: number;
}) {
  const monthsBack = Math.min(input.monthsBack ?? 6, 12);
  const minOccurrences = input.minOccurrences ?? 2;
  const startStr = monthsAgoStart(monthsBack);

  const rows = db.select({
    description: transactions.description,
    chargedAmount: transactions.chargedAmount,
    date: transactions.date,
  }).from(transactions)
    .where(and(
      gte(transactions.date, startStr),
      eq(transactions.ignored, false),
      eq(transactions.status, 'completed'),
    ))
    .orderBy(transactions.description, transactions.date)
    .all();

  const groups = new Map<string, Array<{ amount: number; date: string }>>();
  for (const row of rows) {
    const key = normalizeDescription(row.description);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ amount: row.chargedAmount, date: row.date });
  }

  const recurring: Array<{
    description: string; occurrences: number; avg_amount: number;
    frequency: string; amount_type: 'fixed' | 'variable';
    estimated_annual_cost: number; last_charge_date: string; next_expected_date: string;
  }> = [];

  for (const [desc, entries] of groups) {
    if (entries.length < minOccurrences) continue;
    entries.sort((a, b) => a.date.localeCompare(b.date));
    const amounts = entries.map(e => e.amount);
    const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length;

    const intervals: number[] = [];
    for (let i = 1; i < entries.length; i++) {
      const d1 = new Date(entries[i - 1].date).getTime();
      const d2 = new Date(entries[i].date).getTime();
      intervals.push(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    }
    if (intervals.length === 0) continue;
    const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;

    const variance = intervals.reduce((s, v) => s + (v - avgInterval) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    if (avgInterval > 0 && stdDev / avgInterval > 0.5) continue;

    let frequency: string;
    if (avgInterval <= 10) frequency = 'weekly';
    else if (avgInterval <= 20) frequency = 'bi-weekly';
    else if (avgInterval <= 45) frequency = 'monthly';
    else if (avgInterval <= 100) frequency = 'quarterly';
    else if (avgInterval <= 200) frequency = 'semi-annual';
    else frequency = 'annual';

    const minAmt = Math.min(...amounts);
    const maxAmt = Math.max(...amounts);
    const amountType = maxAmt - minAmt <= Math.abs(avgAmount) * 0.1 ? 'fixed' : 'variable';
    const estimatedAnnualCost = avgInterval > 0 ? avgAmount * (365 / avgInterval) : avgAmount * 12;
    const lastDate = entries[entries.length - 1].date;
    const nextDate = toIsraelDateStr(
      new Date(new Date(lastDate).getTime() + avgInterval * 24 * 60 * 60 * 1000).toISOString()
    );

    recurring.push({
      description: desc, occurrences: entries.length,
      avg_amount: round2(avgAmount), frequency, amount_type: amountType,
      estimated_annual_cost: round2(estimatedAnnualCost),
      last_charge_date: lastDate, next_expected_date: nextDate,
    });
  }

  recurring.sort((a, b) => b.estimated_annual_cost - a.estimated_annual_cost);
  const totalAnnual = recurring.reduce((s, r) => s + r.estimated_annual_cost, 0);

  return {
    recurring,
    total_recurring_monthly: round2(totalAnnual / 12),
    total_recurring_annual: round2(totalAnnual),
  };
}

// ── Top Merchants ──

export function getTopMerchants(input: {
  startDate?: string; endDate?: string;
  sortBy?: 'total' | 'count' | 'average';
  limit?: number; category?: string; accountId?: number;
}) {
  const conditions = [
    eq(transactions.ignored, false),
    eq(transactions.status, 'completed'),
  ];
  if (input.startDate) conditions.push(gte(transactions.date, input.startDate));
  if (input.endDate) conditions.push(lte(transactions.date, input.endDate));
  if (input.category) conditions.push(eq(transactions.category, input.category));
  if (input.accountId != null) conditions.push(eq(transactions.accountId, input.accountId));

  const rows = db.select({
    description: transactions.description,
    chargedAmount: transactions.chargedAmount,
    date: transactions.date,
    category: transactions.category,
  }).from(transactions)
    .where(and(...conditions))
    .all();

  const groups = new Map<string, Array<{ amount: number; date: string; category: string | null }>>();
  for (const row of rows) {
    const key = normalizeDescription(row.description);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ amount: row.chargedAmount, date: row.date, category: row.category });
  }

  let merchants = [...groups.entries()].map(([merchant, entries]) => {
    const amounts = entries.map(e => e.amount);
    const totalAmount = amounts.reduce((s, v) => s + v, 0);
    const avgAmount = totalAmount / amounts.length;

    const catCounts = new Map<string, number>();
    for (const e of entries) {
      const cat = e.category ?? 'uncategorized';
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }
    const topCategory = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'uncategorized';
    const dates = entries.map(e => e.date).sort();

    return {
      merchant, total_amount: round2(totalAmount),
      transaction_count: entries.length, avg_amount: round2(avgAmount),
      min_amount: round2(Math.min(...amounts)), max_amount: round2(Math.max(...amounts)),
      last_transaction_date: dates[dates.length - 1], category: topCategory,
    };
  });

  const sortBy = input.sortBy ?? 'total';
  if (sortBy === 'total') merchants.sort((a, b) => b.total_amount - a.total_amount);
  else if (sortBy === 'count') merchants.sort((a, b) => b.transaction_count - a.transaction_count);
  else merchants.sort((a, b) => b.avg_amount - a.avg_amount);

  const totalFound = merchants.length;
  const limit = Math.min(input.limit ?? 15, 50);
  merchants = merchants.slice(0, limit);

  return {
    top_merchants: merchants,
    total_merchants_found: totalFound,
    period: input.startDate || input.endDate
      ? { start_date: input.startDate ?? 'all', end_date: input.endDate ?? 'all' }
      : 'all_time' as const,
  };
}
