import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts } from '../db/schema.js';
import { appendMemory } from './memory.js';
import { listTransactions, categorizeTransaction as categorizeTx } from '../services/transactions.js';
import { getSpendingSummary as getSpendingSummaryService, comparePeriods as comparePeriodsService, getSpendingTrends as getSpendingTrendsService, detectRecurringTransactions as detectRecurringService, getTopMerchants as getTopMerchantsService } from '../services/summary.js';

// ── Individual tool builders ────────────────────────────────────────────────────

export function buildQueryTransactionsTool() {
  return tool(
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
  );
}

export function buildGetSpendingSummaryTool() {
  return tool(
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
  );
}

export function buildCategorizeTransactionTool(categoryNames: string[]) {
  const categoryEnum = categoryNames.length > 0
    ? z.enum(categoryNames as [string, ...string[]])
    : z.string();

  return tool(
    'categorize_transaction',
    'Assign a category to a specific transaction by its ID. You must provide a confidence score (0-1).',
    {
      transaction_id: z.number().describe('The transaction ID'),
      category: categoryEnum.describe('The category to assign'),
      confidence: z.number().min(0).max(1).describe('Confidence level 0.0-1.0 for this categorization'),
      review_reason: z.string().optional().describe('Reason if confidence is low (<0.8)'),
    },
    async (args) => {
      const result = categorizeTransaction({
        transaction_id: args.transaction_id,
        category: String(args.category),
        confidence: args.confidence,
        review_reason: args.review_reason,
      });
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );
}

export function buildGetAccountBalancesTool() {
  return tool(
    'get_account_balances',
    'Get a list of all configured accounts with their latest scrape info and transaction counts.',
    {},
    async () => {
      const result = getAccountBalances();
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );
}

export function buildComparePeriodsTool() {
  return tool(
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
  );
}

export function buildGetSpendingTrendsTool() {
  return tool(
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
  );
}

export function buildDetectRecurringTransactionsTool() {
  return tool(
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
  );
}

export function buildGetTopMerchantsTool() {
  return tool(
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
  );
}

export function buildSaveMemoryTool() {
  return tool(
    'save_memory',
    'Save an important fact, user preference, or pattern to your long-term memory. This persists across conversations. Use this when: (1) the user explicitly asks you to remember something, (2) you discover an important user preference or financial pattern worth remembering.',
    {
      entry: z.string().min(1).max(500).describe('The fact or preference to remember. Be concise and specific.'),
    },
    async (args) => {
      appendMemory(args.entry);
      return { content: [{ type: 'text' as const, text: 'Saved to memory.' }] };
    },
  );
}

// ── MCP server builder from tool selection ──────────────────────────────────────

export function buildMcpServerFromTools(name: string, tools: Parameters<typeof createSdkMcpServer>[0]['tools']) {
  return createSdkMcpServer({
    name,
    version: '1.0.0',
    tools,
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
