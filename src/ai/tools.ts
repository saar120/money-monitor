import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts } from '../db/schema.js';
import { appendMemory } from './memory.js';
import { listTransactions, categorizeTransaction as categorizeTx } from '../services/transactions.js';
import { getSpendingSummary as getSpendingSummaryService, comparePeriods as comparePeriodsService, getSpendingTrends as getSpendingTrendsService, detectRecurringTransactions as detectRecurringService, getTopMerchants as getTopMerchantsService } from '../services/summary.js';
import { createAgentTool } from './tool-adapter.js';

// ── Individual tool builders ────────────────────────────────────────────────────

export function buildQueryTransactionsTool() {
  return createAgentTool({
    name: 'query_transactions',
    description: 'Search and filter transactions from the database. Use this to find specific transactions or answer questions about spending.',
    label: 'Searching transactions',
    parameters: Type.Object({
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
      start_date: Type.Optional(Type.String({ description: 'Start date (ISO string, e.g. "2026-01-01")' })),
      end_date: Type.Optional(Type.String({ description: 'End date (ISO string, e.g. "2026-01-31")' })),
      category: Type.Optional(Type.String({ description: 'Filter by category' })),
      status: Type.Optional(StringEnum(['completed', 'pending'], { description: 'Transaction status' })),
      min_amount: Type.Optional(Type.Number({ description: 'Minimum charged amount' })),
      max_amount: Type.Optional(Type.Number({ description: 'Maximum charged amount' })),
      search: Type.Optional(Type.String({ description: 'Full-text search across description and memo (supports multiple words)' })),
      limit: Type.Optional(Type.Number({ description: 'Max results to return (default 50, max 200)' })),
    }),
    execute: async (args) => queryTransactions(args),
  });
}

export function buildGetSpendingSummaryTool() {
  return createAgentTool({
    name: 'get_spending_summary',
    description: 'Get aggregated spending totals. Group by category, month, or account to understand spending patterns.',
    label: 'Analyzing spending',
    parameters: Type.Object({
      group_by: Type.Optional(StringEnum(['category', 'month', 'account'], { description: 'How to group the results (default: category)' })),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
      start_date: Type.Optional(Type.String({ description: 'Start date (ISO string)' })),
      end_date: Type.Optional(Type.String({ description: 'End date (ISO string)' })),
    }),
    execute: async (args) => getSpendingSummary(args as Parameters<typeof getSpendingSummary>[0]),
  });
}

export function buildCategorizeTransactionTool(categoryNames: string[]) {
  const categorySchema = categoryNames.length > 0
    ? StringEnum(categoryNames as unknown as string[], { description: 'The category to assign' })
    : Type.String({ description: 'The category to assign' });

  return createAgentTool({
    name: 'categorize_transaction',
    description: 'Assign a category to a specific transaction by its ID. You must provide a confidence score (0-1).',
    label: 'Categorizing transaction',
    parameters: Type.Object({
      transaction_id: Type.Number({ description: 'The transaction ID' }),
      category: categorySchema,
      confidence: Type.Number({ minimum: 0, maximum: 1, description: 'Confidence level 0.0-1.0 for this categorization' }),
      review_reason: Type.Optional(Type.String({ description: 'Reason if confidence is low (<0.8)' })),
    }),
    execute: async (args) => categorizeTransaction({
      transaction_id: args.transaction_id,
      category: String(args.category),
      confidence: args.confidence,
      review_reason: args.review_reason,
    }),
  });
}

export function buildGetAccountBalancesTool() {
  return createAgentTool({
    name: 'get_account_balances',
    description: 'Get a list of all configured accounts with their latest scrape info and transaction counts.',
    label: 'Checking account balances',
    parameters: Type.Object({}),
    execute: async () => getAccountBalances(),
  });
}

export function buildComparePeriodsTool() {
  return createAgentTool({
    name: 'compare_periods',
    description: 'Compare spending between two time periods. Returns a side-by-side breakdown by category showing totals, transaction counts, and percentage change. Use this when the user asks to compare months, weeks, or any two date ranges.',
    label: 'Comparing periods',
    parameters: Type.Object({
      period1_start: Type.String({ description: 'Start date of first period (ISO string, e.g. "2026-01-01")' }),
      period1_end: Type.String({ description: 'End date of first period (ISO string, e.g. "2026-01-31")' }),
      period2_start: Type.String({ description: 'Start date of second period (ISO string, e.g. "2026-02-01")' }),
      period2_end: Type.String({ description: 'End date of second period (ISO string, e.g. "2026-02-28")' }),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
    }),
    execute: async (args) => comparePeriods(args),
  });
}

export function buildGetSpendingTrendsTool() {
  return createAgentTool({
    name: 'get_spending_trends',
    description: 'Analyze spending trends over time. Returns monthly totals with trend direction (increasing/decreasing/stable), average, and month-over-month changes. Use this when the user asks about spending trends, whether costs are rising, or wants to see patterns over time.',
    label: 'Analyzing trends',
    parameters: Type.Object({
      months: Type.Optional(Type.Number({ description: 'Number of months to analyze (default 6, max 24)' })),
      category: Type.Optional(Type.String({ description: 'Filter to a specific category (omit for overall spending)' })),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
    }),
    execute: async (args) => getSpendingTrends(args),
  });
}

export function buildDetectRecurringTransactionsTool() {
  return createAgentTool({
    name: 'detect_recurring_transactions',
    description: 'Detect recurring transactions such as subscriptions, memberships, and regular bills. Analyzes transaction history to find charges that repeat at regular intervals. Returns merchant name, amount, frequency, estimated annual cost, and last charge date.',
    label: 'Detecting recurring charges',
    parameters: Type.Object({
      months_back: Type.Optional(Type.Number({ description: 'How many months of history to analyze (default 6, max 12)' })),
      min_occurrences: Type.Optional(Type.Number({ description: 'Minimum times a charge must appear to be considered recurring (default 2)' })),
    }),
    execute: async (args) => detectRecurringTransactions(args),
  });
}

export function buildGetTopMerchantsTool() {
  return createAgentTool({
    name: 'get_top_merchants',
    description: 'Get top merchants/payees ranked by total spending, transaction frequency, or average transaction amount. Use this when the user asks where they spend the most, their most frequent charges, or top spending destinations.',
    label: 'Finding top merchants',
    parameters: Type.Object({
      start_date: Type.Optional(Type.String({ description: 'Start date (ISO string)' })),
      end_date: Type.Optional(Type.String({ description: 'End date (ISO string)' })),
      sort_by: Type.Optional(StringEnum(['total', 'count', 'average'], { description: 'Sort by total spending (default), transaction count, or average amount' })),
      limit: Type.Optional(Type.Number({ description: 'Number of top merchants to return (default 15, max 50)' })),
      category: Type.Optional(Type.String({ description: 'Filter to a specific category' })),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
    }),
    execute: async (args) => getTopMerchants(args as Parameters<typeof getTopMerchants>[0]),
  });
}

export function buildSaveMemoryTool() {
  return createAgentTool({
    name: 'save_memory',
    description: 'Save an important fact, user preference, or pattern to your long-term memory. This persists across conversations. Use this when: (1) the user explicitly asks you to remember something, (2) you discover an important user preference or financial pattern worth remembering.',
    label: 'Saving to memory',
    parameters: Type.Object({
      entry: Type.String({ minLength: 1, maxLength: 500, description: 'The fact or preference to remember. Be concise and specific.' }),
    }),
    execute: async (args) => {
      appendMemory(args.entry);
      return 'Saved to memory.';
    },
  });
}

// ── Thin wrappers that delegate to service layer ────────────────────────────────

export function queryTransactions(input: { account_id?: number; start_date?: string; end_date?: string; category?: string; status?: string; min_amount?: number; max_amount?: number; search?: string; limit?: number }): string {
  const limit = Math.min(input.limit ?? 50, 200);
  const result = listTransactions(
    { accountId: input.account_id, startDate: input.start_date, endDate: input.end_date, category: input.category, status: input.status, minAmount: input.min_amount, maxAmount: input.max_amount, search: input.search },
    { limit, sortBy: 'date', sortOrder: 'desc' },
  );
  return JSON.stringify({ transactions: result.transactions, total: result.pagination.total, returned: result.transactions.length });
}

export function getSpendingSummary(input: { group_by?: 'category' | 'month' | 'account'; account_id?: number; start_date?: string; end_date?: string }): string {
  const result = getSpendingSummaryService({ accountId: input.account_id, startDate: input.start_date, endDate: input.end_date }, input.group_by ?? 'category');
  return JSON.stringify(result);
}

export function categorizeTransaction(input: { transaction_id: number; category: string; confidence?: number; review_reason?: string }): string {
  const result = categorizeTx({ transactionId: input.transaction_id, category: input.category, confidence: input.confidence, reviewReason: input.review_reason });
  if (!result.ok) return JSON.stringify({ error: result.error });
  return JSON.stringify({ success: true, transactionId: result.transactionId, category: result.category });
}

export function comparePeriods(input: { period1_start: string; period1_end: string; period2_start: string; period2_end: string; account_id?: number }): string {
  const result = comparePeriodsService({ period1Start: input.period1_start, period1End: input.period1_end, period2Start: input.period2_start, period2End: input.period2_end, accountId: input.account_id });
  return JSON.stringify(result);
}

export function getSpendingTrends(input: { months?: number; category?: string; account_id?: number }): string {
  const result = getSpendingTrendsService({ months: input.months, category: input.category, accountId: input.account_id });
  return JSON.stringify(result);
}

export function detectRecurringTransactions(input: { months_back?: number; min_occurrences?: number }): string {
  const result = detectRecurringService({ monthsBack: input.months_back, minOccurrences: input.min_occurrences });
  return JSON.stringify(result);
}

export function getTopMerchants(input: { start_date?: string; end_date?: string; sort_by?: 'total' | 'count' | 'average'; limit?: number; category?: string; account_id?: number }): string {
  const result = getTopMerchantsService({ startDate: input.start_date, endDate: input.end_date, sortBy: input.sort_by, limit: input.limit, category: input.category, accountId: input.account_id });
  return JSON.stringify(result);
}

// ── Direct DB query (only used by AI tools, not duplicated in services) ─────────

export function getAccountBalances(): string {
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
