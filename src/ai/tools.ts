import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { eq, and, gte, lte, sql, count, desc, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';

export function buildFinancialMcpServer(categoryNames: string[]) {
  const categoryEnum = categoryNames.length > 0
    ? z.enum(categoryNames as [string, ...string[]])
    : z.string();

  return createSdkMcpServer({
    name: 'financial-tools',
    version: '1.0.0',
    tools: [
      tool(
        'query_transactions',
        'Search and filter transactions from the database. Use this to find specific transactions or answer questions about spending.',
        {
          account_id: z.number().optional().describe('Filter by account ID'),
          start_date: z.string().optional().describe('Start date (ISO string, e.g. "2026-01-01")'),
          end_date: z.string().optional().describe('End date (ISO string, e.g. "2026-01-31")'),
          category: z.string().optional().describe('Filter by category'),
          status: z.enum(['completed', 'pending']).optional().describe('Transaction status'),
          min_amount: z.number().optional().describe('Minimum charged amount'),
          max_amount: z.number().optional().describe('Maximum charged amount'),
          search: z.string().optional().describe('Full-text search across description and memo (supports multiple words)'),
          limit: z.number().optional().describe('Max results to return (default 50, max 200)'),
        },
        async (args) => {
          const result = queryTransactions(args);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'get_spending_summary',
        'Get aggregated spending totals. Group by category, month, or account to understand spending patterns.',
        {
          group_by: z.enum(['category', 'month', 'account']).optional().describe(
            'How to group the results (default: category)',
          ),
          account_id: z.number().optional().describe('Filter by account ID'),
          start_date: z.string().optional().describe('Start date (ISO string)'),
          end_date: z.string().optional().describe('End date (ISO string)'),
        },
        async (args) => {
          const result = getSpendingSummary(args);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'categorize_transaction',
        'Assign a category to a specific transaction by its ID.',
        {
          transaction_id: z.number().describe('The transaction ID'),
          category: categoryEnum.describe('The category to assign'),
        },
        async (args) => {
          const result = categorizeTransaction({ transaction_id: args.transaction_id, category: String(args.category) });
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'get_account_balances',
        'Get a list of all configured accounts with their latest scrape info and transaction counts.',
        {},
        async () => {
          const result = getAccountBalances();
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'compare_periods',
        'Compare spending between two time periods. Returns a side-by-side breakdown by category showing totals, transaction counts, and percentage change. Use this when the user asks to compare months, weeks, or any two date ranges.',
        {
          period1_start: z.string().describe('Start date of first period (ISO string, e.g. "2026-01-01")'),
          period1_end: z.string().describe('End date of first period (ISO string, e.g. "2026-01-31")'),
          period2_start: z.string().describe('Start date of second period (ISO string, e.g. "2026-02-01")'),
          period2_end: z.string().describe('End date of second period (ISO string, e.g. "2026-02-28")'),
          account_id: z.number().optional().describe('Filter by account ID'),
        },
        async (args) => {
          const result = comparePeriods(args);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'get_spending_trends',
        'Analyze spending trends over time. Returns monthly totals with trend direction (increasing/decreasing/stable), average, and month-over-month changes. Use this when the user asks about spending trends, whether costs are rising, or wants to see patterns over time.',
        {
          months: z.number().optional().describe('Number of months to analyze (default 6, max 24)'),
          category: z.string().optional().describe('Filter to a specific category (omit for overall spending)'),
          account_id: z.number().optional().describe('Filter by account ID'),
        },
        async (args) => {
          const result = getSpendingTrends(args);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'detect_recurring_transactions',
        'Detect recurring transactions such as subscriptions, memberships, and regular bills. Analyzes transaction history to find charges that repeat at regular intervals. Returns merchant name, amount, frequency, estimated annual cost, and last charge date.',
        {
          months_back: z.number().optional().describe('How many months of history to analyze (default 6, max 12)'),
          min_occurrences: z.number().optional().describe('Minimum times a charge must appear to be considered recurring (default 2)'),
        },
        async (args) => {
          const result = detectRecurringTransactions(args);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'get_top_merchants',
        'Get top merchants/payees ranked by total spending, transaction frequency, or average transaction amount. Use this when the user asks where they spend the most, their most frequent charges, or top spending destinations.',
        {
          start_date: z.string().optional().describe('Start date (ISO string)'),
          end_date: z.string().optional().describe('End date (ISO string)'),
          sort_by: z.enum(['total', 'count', 'average']).optional().describe('Sort by total spending (default), transaction count, or average amount'),
          limit: z.number().optional().describe('Number of top merchants to return (default 15, max 50)'),
          category: z.string().optional().describe('Filter to a specific category'),
          account_id: z.number().optional().describe('Filter by account ID'),
        },
        async (args) => {
          const result = getTopMerchants(args);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
    ],
  });
}

// ── Private query functions (unchanged Drizzle ORM logic) ──────────────────────

interface QueryTransactionsInput {
  account_id?: number;
  start_date?: string;
  end_date?: string;
  category?: string;
  status?: string;
  min_amount?: number;
  max_amount?: number;
  search?: string;
  limit?: number;
}

interface GetSpendingSummaryInput {
  group_by?: 'category' | 'month' | 'account';
  account_id?: number;
  start_date?: string;
  end_date?: string;
}

interface CategorizeTransactionInput {
  transaction_id: number;
  category: string;
}

function queryTransactions(input: QueryTransactionsInput): string {
  const conditions = [];
  if (input.account_id != null) conditions.push(eq(transactions.accountId, input.account_id));
  if (input.start_date) conditions.push(gte(transactions.date, input.start_date));
  if (input.end_date) conditions.push(lte(transactions.date, input.end_date));
  if (input.category) conditions.push(eq(transactions.category, input.category));
  if (input.status) conditions.push(eq(transactions.status, input.status));
  if (input.min_amount != null) conditions.push(gte(transactions.chargedAmount, input.min_amount));
  if (input.max_amount != null) conditions.push(lte(transactions.chargedAmount, input.max_amount));
  if (input.search) {
    const ftsIds = db.all<{ rowid: number }>(
      sql`SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ${input.search} ORDER BY rank LIMIT 1000`
    ).map(r => r.rowid);
    if (ftsIds.length === 0) {
      return JSON.stringify({ transactions: [], total: 0, returned: 0 });
    }
    conditions.push(inArray(transactions.id, ftsIds));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(input.limit ?? 50, 200);

  const rows = db.select().from(transactions)
    .where(where)
    .orderBy(desc(transactions.date))
    .limit(limit)
    .all();

  const [{ total }] = db.select({ total: count() }).from(transactions).where(where).all();

  return JSON.stringify({ transactions: rows, total, returned: rows.length });
}

function getSpendingSummary(input: GetSpendingSummaryInput): string {
  const conditions = [];
  if (input.account_id != null) conditions.push(eq(transactions.accountId, input.account_id));
  if (input.start_date) conditions.push(gte(transactions.date, input.start_date));
  if (input.end_date) conditions.push(lte(transactions.date, input.end_date));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const groupBy = input.group_by ?? 'category';

  if (groupBy === 'month') {
    const rows = db.select({
      month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as('month'),
      totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
      count: sql<number>`COUNT(*)`.as('count'),
    }).from(transactions).where(where)
      .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
      .orderBy(sql`month desc`).all();
    return JSON.stringify({ groupBy, summary: rows });
  }

  if (groupBy === 'account') {
    const rows = db.select({
      accountId: transactions.accountId,
      displayName: accounts.displayName,
      totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
      count: sql<number>`COUNT(*)`.as('count'),
    }).from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(where)
      .groupBy(transactions.accountId).all();
    return JSON.stringify({ groupBy, summary: rows });
  }

  const rows = db.select({
    category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
    totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
    count: sql<number>`COUNT(*)`.as('count'),
  }).from(transactions).where(where)
    .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
    .orderBy(sql`total_amount desc`).all();
  return JSON.stringify({ groupBy, summary: rows });
}

function categorizeTransaction(input: CategorizeTransactionInput): string {
  const existing = db.select().from(transactions).where(eq(transactions.id, input.transaction_id)).get();
  if (!existing) return JSON.stringify({ error: 'Transaction not found' });

  db.update(transactions)
    .set({ category: input.category })
    .where(eq(transactions.id, input.transaction_id))
    .run();

  return JSON.stringify({ success: true, transactionId: input.transaction_id, category: input.category });
}

function getAccountBalances(): string {
  const rows = db.select({
    id: accounts.id,
    companyId: accounts.companyId,
    displayName: accounts.displayName,
    accountNumber: accounts.accountNumber,
    isActive: accounts.isActive,
    lastScrapedAt: accounts.lastScrapedAt,
    transactionCount: sql<number>`(SELECT COUNT(*) FROM transactions WHERE account_id = ${accounts.id})`.as('transaction_count'),
    totalSpending: sql<number>`(SELECT COALESCE(SUM(charged_amount), 0) FROM transactions WHERE account_id = ${accounts.id})`.as('total_spending'),
  }).from(accounts).all();

  return JSON.stringify({ accounts: rows });
}

// ── Shared helpers ──────────────────────────────────────────────────────────────

function normalizeDescription(desc: string): string {
  return desc
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, '')   // date patterns like 01/02 or 01/02/26
    .replace(/\s*\d{5,}$/g, '')                   // trailing long reference numbers
    .replace(/\s*#\d+$/g, '')                     // trailing #123 patterns
    .trim();
}

// ── New tool query functions ────────────────────────────────────────────────────

interface ComparePeriodsInput {
  period1_start: string;
  period1_end: string;
  period2_start: string;
  period2_end: string;
  account_id?: number;
}

function comparePeriods(input: ComparePeriodsInput): string {
  function queryPeriod(start: string, end: string) {
    const conditions = [
      gte(transactions.date, start),
      lte(transactions.date, end),
      eq(transactions.ignored, false),
    ];
    if (input.account_id != null) conditions.push(eq(transactions.accountId, input.account_id));

    return db.select({
      category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
      totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
      count: sql<number>`COUNT(*)`.as('count'),
    }).from(transactions)
      .where(and(...conditions))
      .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
      .all();
  }

  const p1 = queryPeriod(input.period1_start, input.period1_end);
  const p2 = queryPeriod(input.period2_start, input.period2_end);

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
    return { category, period1_total: t1, period1_count: c1, period2_total: t2, period2_count: c2, change_amount: changeAmount, change_percent: changePercent != null ? Math.round(changePercent * 10) / 10 : null };
  }).sort((a, b) => Math.abs(b.change_amount) - Math.abs(a.change_amount));

  const p1Total = p1.reduce((s, r) => s + r.totalAmount, 0);
  const p2Total = p2.reduce((s, r) => s + r.totalAmount, 0);
  const overallChange = p2Total - p1Total;

  return JSON.stringify({
    comparison,
    summary: {
      period1: { start: input.period1_start, end: input.period1_end, total: p1Total },
      period2: { start: input.period2_start, end: input.period2_end, total: p2Total },
      change_amount: overallChange,
      change_percent: p1Total !== 0 ? Math.round(((overallChange) / Math.abs(p1Total)) * 1000) / 10 : null,
    },
  });
}

interface GetSpendingTrendsInput {
  months?: number;
  category?: string;
  account_id?: number;
}

function getSpendingTrends(input: GetSpendingTrendsInput): string {
  const months = Math.min(input.months ?? 6, 24);
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const startStr = startDate.toISOString().slice(0, 10);

  const conditions = [
    gte(transactions.date, startStr),
    eq(transactions.ignored, false),
  ];
  if (input.category) conditions.push(eq(transactions.category, input.category));
  if (input.account_id != null) conditions.push(eq(transactions.accountId, input.account_id));

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
    return JSON.stringify({ months: [], trend: 'no_data', average: 0, total_period: 0 });
  }

  const totals = rows.map(r => r.totalAmount);
  const average = totals.reduce((s, v) => s + v, 0) / totals.length;
  const minRow = rows.reduce((m, r) => r.totalAmount < m.totalAmount ? r : m);
  const maxRow = rows.reduce((m, r) => r.totalAmount > m.totalAmount ? r : m);

  // Month-over-month changes
  const mom = rows.slice(1).map((r, i) => {
    const prev = rows[i].totalAmount;
    const change = r.totalAmount - prev;
    return {
      from: rows[i].month,
      to: r.month,
      change_amount: change,
      change_percent: prev !== 0 ? Math.round((change / Math.abs(prev)) * 1000) / 10 : null,
    };
  });

  // Trend: compare first half average to second half average
  const mid = Math.floor(totals.length / 2);
  const firstHalf = totals.slice(0, mid);
  const secondHalf = totals.slice(mid);
  const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;
  const threshold = average * 0.05;
  let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (secondAvg - firstAvg > threshold) trend = 'increasing';
  else if (firstAvg - secondAvg > threshold) trend = 'decreasing';

  return JSON.stringify({
    months: rows,
    trend,
    average: Math.round(average * 100) / 100,
    min: { month: minRow.month, total: minRow.totalAmount },
    max: { month: maxRow.month, total: maxRow.totalAmount },
    total_period: totals.reduce((s, v) => s + v, 0),
    month_over_month: mom,
  });
}

interface DetectRecurringInput {
  months_back?: number;
  min_occurrences?: number;
}

function detectRecurringTransactions(input: DetectRecurringInput): string {
  const monthsBack = Math.min(input.months_back ?? 6, 12);
  const minOccurrences = input.min_occurrences ?? 2;
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const startStr = startDate.toISOString().slice(0, 10);

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

  // Group by normalized description
  const groups = new Map<string, Array<{ amount: number; date: string }>>();
  for (const row of rows) {
    const key = normalizeDescription(row.description);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ amount: row.chargedAmount, date: row.date });
  }

  const recurring: Array<Record<string, unknown>> = [];

  for (const [desc, entries] of groups) {
    if (entries.length < minOccurrences) continue;

    entries.sort((a, b) => a.date.localeCompare(b.date));
    const amounts = entries.map(e => e.amount);
    const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length;

    // Calculate intervals in days
    const intervals: number[] = [];
    for (let i = 1; i < entries.length; i++) {
      const d1 = new Date(entries[i - 1].date).getTime();
      const d2 = new Date(entries[i].date).getTime();
      intervals.push(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    }

    if (intervals.length === 0) continue;
    const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;

    // Skip if interval is too erratic (std dev > 50% of mean)
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

    // Amount consistency
    const minAmt = Math.min(...amounts);
    const maxAmt = Math.max(...amounts);
    const amountType = maxAmt - minAmt <= Math.abs(avgAmount) * 0.1 ? 'fixed' : 'variable';

    const estimatedAnnualCost = avgInterval > 0 ? avgAmount * (365 / avgInterval) : avgAmount * 12;
    const lastDate = entries[entries.length - 1].date;
    const nextDate = new Date(new Date(lastDate).getTime() + avgInterval * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    recurring.push({
      description: desc,
      occurrences: entries.length,
      avg_amount: Math.round(avgAmount * 100) / 100,
      frequency,
      amount_type: amountType,
      estimated_annual_cost: Math.round(estimatedAnnualCost * 100) / 100,
      last_charge_date: lastDate,
      next_expected_date: nextDate,
    });
  }

  recurring.sort((a, b) => (b.estimated_annual_cost as number) - (a.estimated_annual_cost as number));

  const totalAnnual = recurring.reduce((s, r) => s + (r.estimated_annual_cost as number), 0);

  return JSON.stringify({
    recurring,
    total_recurring_monthly: Math.round((totalAnnual / 12) * 100) / 100,
    total_recurring_annual: Math.round(totalAnnual * 100) / 100,
  });
}

interface GetTopMerchantsInput {
  start_date?: string;
  end_date?: string;
  sort_by?: 'total' | 'count' | 'average';
  limit?: number;
  category?: string;
  account_id?: number;
}

function getTopMerchants(input: GetTopMerchantsInput): string {
  const conditions = [
    eq(transactions.ignored, false),
    eq(transactions.status, 'completed'),
  ];
  if (input.start_date) conditions.push(gte(transactions.date, input.start_date));
  if (input.end_date) conditions.push(lte(transactions.date, input.end_date));
  if (input.category) conditions.push(eq(transactions.category, input.category));
  if (input.account_id != null) conditions.push(eq(transactions.accountId, input.account_id));

  const rows = db.select({
    description: transactions.description,
    chargedAmount: transactions.chargedAmount,
    date: transactions.date,
    category: transactions.category,
  }).from(transactions)
    .where(and(...conditions))
    .all();

  // Group by normalized description
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

    // Most common category
    const catCounts = new Map<string, number>();
    for (const e of entries) {
      const cat = e.category ?? 'uncategorized';
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }
    const topCategory = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'uncategorized';

    const dates = entries.map(e => e.date).sort();
    return {
      merchant,
      total_amount: Math.round(totalAmount * 100) / 100,
      transaction_count: entries.length,
      avg_amount: Math.round(avgAmount * 100) / 100,
      min_amount: Math.round(Math.min(...amounts) * 100) / 100,
      max_amount: Math.round(Math.max(...amounts) * 100) / 100,
      last_transaction_date: dates[dates.length - 1],
      category: topCategory,
    };
  });

  const sortBy = input.sort_by ?? 'total';
  if (sortBy === 'total') merchants.sort((a, b) => b.total_amount - a.total_amount);
  else if (sortBy === 'count') merchants.sort((a, b) => b.transaction_count - a.transaction_count);
  else merchants.sort((a, b) => b.avg_amount - a.avg_amount);

  const totalFound = merchants.length;
  const limit = Math.min(input.limit ?? 15, 50);
  merchants = merchants.slice(0, limit);

  return JSON.stringify({
    top_merchants: merchants,
    total_merchants_found: totalFound,
    period: input.start_date || input.end_date
      ? { start_date: input.start_date ?? 'all', end_date: input.end_date ?? 'all' }
      : 'all_time',
  });
}
