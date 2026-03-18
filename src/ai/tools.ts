import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import { sql, eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions, scrapeSessions, scrapeLogs } from '../db/schema.js';
import { appendMemory, writeMemory } from './memory.js';
import {
  listTransactions,
  categorizeTransaction as categorizeTx,
} from '../services/transactions.js';
import {
  createCategory as createCategoryService,
  updateCategory as updateCategoryService,
  listCategories,
} from '../services/categories.js';
import {
  getSpendingSummary as getSpendingSummaryService,
  comparePeriods as comparePeriodsService,
  getSpendingTrends as getSpendingTrendsService,
  detectRecurringTransactions as detectRecurringService,
  getTopMerchants as getTopMerchantsService,
} from '../services/summary.js';
import { createAgentTool } from './tool-adapter.js';

// ── Individual tool builders ────────────────────────────────────────────────────

export function buildQueryTransactionsTool() {
  return createAgentTool({
    name: 'query_transactions',
    description:
      'Search and filter transactions from the database. Use this to find specific transactions or answer questions about spending. Each transaction includes needsReview (true if low-confidence categorization needing user review), confidence (0-1 score), and reviewReason fields.',
    label: 'Searching transactions',
    parameters: Type.Object({
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
      start_date: Type.Optional(
        Type.String({ description: 'Start date (ISO string, e.g. "2026-01-01")' }),
      ),
      end_date: Type.Optional(
        Type.String({ description: 'End date (ISO string, e.g. "2026-01-31")' }),
      ),
      category: Type.Optional(Type.String({ description: 'Filter by category' })),
      status: Type.Optional(
        StringEnum(['completed', 'pending'], { description: 'Transaction status' }),
      ),
      min_amount: Type.Optional(Type.Number({ description: 'Minimum charged amount' })),
      max_amount: Type.Optional(Type.Number({ description: 'Maximum charged amount' })),
      search: Type.Optional(
        Type.String({
          description: 'Full-text search across description and memo (supports multiple words)',
        }),
      ),
      needs_review: Type.Optional(
        Type.Boolean({
          description:
            'Filter by review status. true = transactions needing review (low confidence), false = already reviewed/confirmed transactions',
        }),
      ),
      limit: Type.Optional(
        Type.Number({ description: 'Max results to return (default 50, max 200)' }),
      ),
    }),
    execute: async (args) => queryTransactions(args),
  });
}

export function buildGetSpendingSummaryTool() {
  return createAgentTool({
    name: 'get_spending_summary',
    description:
      'Get aggregated spending totals. Group by category, month, or account to understand spending patterns.',
    label: 'Analyzing spending',
    parameters: Type.Object({
      group_by: Type.Optional(
        StringEnum(['category', 'month', 'account'], {
          description: 'How to group the results (default: category)',
        }),
      ),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
      start_date: Type.Optional(Type.String({ description: 'Start date (ISO string)' })),
      end_date: Type.Optional(Type.String({ description: 'End date (ISO string)' })),
    }),
    execute: async (args) => getSpendingSummary(args as Parameters<typeof getSpendingSummary>[0]),
  });
}

export function buildCategorizeTransactionTool(categoryNames: string[]) {
  const categorySchema =
    categoryNames.length > 0
      ? StringEnum(categoryNames as unknown as string[], { description: 'The category to assign' })
      : Type.String({ description: 'The category to assign' });

  return createAgentTool({
    name: 'categorize_transaction',
    description:
      'Assign a category to a specific transaction by its ID. You must provide a confidence score (0-1).',
    label: 'Categorizing transaction',
    parameters: Type.Object({
      transaction_id: Type.Number({ description: 'The transaction ID' }),
      category: categorySchema,
      confidence: Type.Number({
        minimum: 0,
        maximum: 1,
        description: 'Confidence level 0.0-1.0 for this categorization',
      }),
      review_reason: Type.Optional(
        Type.String({ description: 'Reason if confidence is low (<0.8)' }),
      ),
    }),
    execute: async (args) =>
      categorizeTransaction({
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
    description:
      'Get a list of all configured accounts with their latest scrape info and transaction counts.',
    label: 'Checking account balances',
    parameters: Type.Object({}),
    execute: async () => getAccountBalances(),
  });
}

export function buildComparePeriodsTool() {
  return createAgentTool({
    name: 'compare_periods',
    description:
      'Compare spending between two time periods. Returns a side-by-side breakdown by category showing totals, transaction counts, and percentage change. Use this when the user asks to compare months, weeks, or any two date ranges.',
    label: 'Comparing periods',
    parameters: Type.Object({
      period1_start: Type.String({
        description: 'Start date of first period (ISO string, e.g. "2026-01-01")',
      }),
      period1_end: Type.String({
        description: 'End date of first period (ISO string, e.g. "2026-01-31")',
      }),
      period2_start: Type.String({
        description: 'Start date of second period (ISO string, e.g. "2026-02-01")',
      }),
      period2_end: Type.String({
        description: 'End date of second period (ISO string, e.g. "2026-02-28")',
      }),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
    }),
    execute: async (args) => comparePeriods(args),
  });
}

export function buildGetSpendingTrendsTool() {
  return createAgentTool({
    name: 'get_spending_trends',
    description:
      'Analyze spending trends over time. Returns monthly totals with trend direction (increasing/decreasing/stable), average, and month-over-month changes. Use this when the user asks about spending trends, whether costs are rising, or wants to see patterns over time.',
    label: 'Analyzing trends',
    parameters: Type.Object({
      months: Type.Optional(
        Type.Number({ description: 'Number of months to analyze (default 6, max 24)' }),
      ),
      category: Type.Optional(
        Type.String({ description: 'Filter to a specific category (omit for overall spending)' }),
      ),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
    }),
    execute: async (args) => getSpendingTrends(args),
  });
}

export function buildDetectRecurringTransactionsTool() {
  return createAgentTool({
    name: 'detect_recurring_transactions',
    description:
      'Detect recurring transactions such as subscriptions, memberships, and regular bills. Analyzes transaction history to find charges that repeat at regular intervals. Returns merchant name, amount, frequency, estimated annual cost, and last charge date.',
    label: 'Detecting recurring charges',
    parameters: Type.Object({
      months_back: Type.Optional(
        Type.Number({ description: 'How many months of history to analyze (default 6, max 12)' }),
      ),
      min_occurrences: Type.Optional(
        Type.Number({
          description: 'Minimum times a charge must appear to be considered recurring (default 2)',
        }),
      ),
    }),
    execute: async (args) => detectRecurringTransactions(args),
  });
}

export function buildGetTopMerchantsTool() {
  return createAgentTool({
    name: 'get_top_merchants',
    description:
      'Get top merchants/payees ranked by total spending, transaction frequency, or average transaction amount. Use this when the user asks where they spend the most, their most frequent charges, or top spending destinations.',
    label: 'Finding top merchants',
    parameters: Type.Object({
      start_date: Type.Optional(Type.String({ description: 'Start date (ISO string)' })),
      end_date: Type.Optional(Type.String({ description: 'End date (ISO string)' })),
      sort_by: Type.Optional(
        StringEnum(['total', 'count', 'average'], {
          description: 'Sort by total spending (default), transaction count, or average amount',
        }),
      ),
      limit: Type.Optional(
        Type.Number({ description: 'Number of top merchants to return (default 15, max 50)' }),
      ),
      category: Type.Optional(Type.String({ description: 'Filter to a specific category' })),
      account_id: Type.Optional(Type.Number({ description: 'Filter by account ID' })),
    }),
    execute: async (args) => getTopMerchants(args as Parameters<typeof getTopMerchants>[0]),
  });
}

export function buildSaveMemoryTool() {
  return createAgentTool({
    name: 'save_memory',
    description:
      'Save an important fact, user preference, or pattern to your long-term memory. This persists across conversations. Use this when: (1) the user explicitly asks you to remember something, (2) you discover an important user preference or financial pattern worth remembering.',
    label: 'Saving to memory',
    parameters: Type.Object({
      entry: Type.String({
        minLength: 1,
        maxLength: 500,
        description: 'The fact or preference to remember. Be concise and specific.',
      }),
    }),
    execute: async (args) => {
      appendMemory(args.entry);
      return 'Saved to memory.';
    },
  });
}

export function buildUpdateMemoryTool() {
  return createAgentTool({
    name: 'update_memory',
    description:
      'Replace your entire long-term memory with updated content. Use this when you need to correct, consolidate, or remove outdated memory entries. Read your current memory first, then provide the full updated version.',
    label: 'Updating memory',
    parameters: Type.Object({
      content: Type.String({
        minLength: 1,
        description:
          'The full updated memory content. This replaces all existing memory, so include everything you want to keep.',
      }),
    }),
    execute: async (args) => {
      writeMemory(args.content);
      return 'Memory updated.';
    },
  });
}

export function buildAddCategoryTool() {
  return createAgentTool({
    name: 'add_category',
    description:
      'Create a new spending category. Requires a unique machine-friendly name (lowercase, dashes/underscores) and a human-readable label. Optionally set a color and categorization rules.',
    label: 'Adding category',
    parameters: Type.Object({
      name: Type.String({
        pattern: '^[a-z0-9][a-z0-9_-]*$',
        description:
          'Unique machine name (lowercase, dashes/underscores, e.g. "groceries" or "eating-out")',
      }),
      label: Type.String({ description: 'Human-readable display name (e.g. "Groceries & Food")' }),
      color: Type.Optional(Type.String({ description: 'Hex color code (e.g. "#4CAF50")' })),
      rules: Type.Optional(
        Type.String({
          description:
            'Categorization hints for the AI (e.g. "Supermarkets, markets, food delivery")',
        }),
      ),
    }),
    execute: async (args) => addCategory(args),
  });
}

export function buildUpdateCategoryRulesTool() {
  return createAgentTool({
    name: 'update_category_rules',
    description:
      'Update the categorization rules for an existing category. Rules are hints that guide AI categorization (e.g. "Supermarkets, markets, food delivery"). Use this to refine how transactions get auto-categorized. Returns the current rules before updating so you can see what exists.',
    label: 'Updating category rules',
    parameters: Type.Object({
      category_name: Type.String({
        description: 'The machine name of the category to update (e.g. "groceries", "eating-out")',
      }),
      rules: Type.String({
        description:
          'New categorization rules/hints for the AI (e.g. "Supermarkets, grocery stores, food delivery apps like Wolt")',
      }),
    }),
    execute: async (args) => updateCategoryRules(args),
  });
}

export function buildGetLatestScrapeTransactionsTool() {
  return createAgentTool({
    name: 'get_latest_scrape_transactions',
    description:
      "Get all transactions that were newly found in the latest scrape session. Use this when the user asks what was scraped, what's new, or what transactions were found.",
    label: 'Looking up latest scrape results',
    parameters: Type.Object({}),
    execute: async () => getLatestScrapeTransactions(),
  });
}

// ── Thin wrappers that delegate to service layer ────────────────────────────────

export function queryTransactions(input: {
  account_id?: number;
  start_date?: string;
  end_date?: string;
  category?: string;
  status?: string;
  min_amount?: number;
  max_amount?: number;
  search?: string;
  needs_review?: boolean;
  limit?: number;
}): string {
  const limit = Math.min(input.limit ?? 50, 200);
  const result = listTransactions(
    {
      accountId: input.account_id,
      startDate: input.start_date,
      endDate: input.end_date,
      category: input.category,
      status: input.status,
      minAmount: input.min_amount,
      maxAmount: input.max_amount,
      search: input.search,
      needsReview: input.needs_review,
    },
    { limit, sortBy: 'date', sortOrder: 'desc' },
  );
  return JSON.stringify({
    transactions: result.transactions,
    total: result.pagination.total,
    returned: result.transactions.length,
  });
}

export function addCategory(input: {
  name: string;
  label: string;
  color?: string;
  rules?: string;
}): string {
  const result = createCategoryService(input);
  if (!result.ok) return JSON.stringify({ error: result.error });
  return JSON.stringify({ success: true, category: result.category });
}

export function updateCategoryRules(input: {
  category_name: string;
  rules: string;
}): string {
  const allCats = listCategories();
  const cat = allCats.find((c) => c.name === input.category_name);
  if (!cat) return JSON.stringify({ error: `Category "${input.category_name}" not found` });

  const previousRules = cat.rules ?? null;
  const result = updateCategoryService(cat.id, { rules: input.rules });
  if (!result.ok) return JSON.stringify({ error: result.error });
  return JSON.stringify({
    success: true,
    category: input.category_name,
    previousRules,
    newRules: input.rules,
  });
}

export function getSpendingSummary(input: {
  group_by?: 'category' | 'month' | 'account';
  account_id?: number;
  start_date?: string;
  end_date?: string;
}): string {
  const result = getSpendingSummaryService(
    { accountId: input.account_id, startDate: input.start_date, endDate: input.end_date },
    input.group_by ?? 'category',
  );
  return JSON.stringify(result);
}

export function categorizeTransaction(input: {
  transaction_id: number;
  category: string;
  confidence?: number;
  review_reason?: string;
}): string {
  const result = categorizeTx({
    transactionId: input.transaction_id,
    category: input.category,
    confidence: input.confidence,
    reviewReason: input.review_reason,
  });
  if (!result.ok) return JSON.stringify({ error: result.error });
  return JSON.stringify({
    success: true,
    transactionId: result.transactionId,
    category: result.category,
  });
}

export function comparePeriods(input: {
  period1_start: string;
  period1_end: string;
  period2_start: string;
  period2_end: string;
  account_id?: number;
}): string {
  const result = comparePeriodsService({
    period1Start: input.period1_start,
    period1End: input.period1_end,
    period2Start: input.period2_start,
    period2End: input.period2_end,
    accountId: input.account_id,
  });
  return JSON.stringify(result);
}

export function getSpendingTrends(input: {
  months?: number;
  category?: string;
  account_id?: number;
}): string {
  const result = getSpendingTrendsService({
    months: input.months,
    category: input.category,
    accountId: input.account_id,
  });
  return JSON.stringify(result);
}

export function detectRecurringTransactions(input: {
  months_back?: number;
  min_occurrences?: number;
}): string {
  const result = detectRecurringService({
    monthsBack: input.months_back,
    minOccurrences: input.min_occurrences,
  });
  return JSON.stringify(result);
}

export function getTopMerchants(input: {
  start_date?: string;
  end_date?: string;
  sort_by?: 'total' | 'count' | 'average';
  limit?: number;
  category?: string;
  account_id?: number;
}): string {
  const result = getTopMerchantsService({
    startDate: input.start_date,
    endDate: input.end_date,
    sortBy: input.sort_by,
    limit: input.limit,
    category: input.category,
    accountId: input.account_id,
  });
  return JSON.stringify(result);
}

// ── Direct DB query (only used by AI tools, not duplicated in services) ─────────

export function getAccountBalances(): string {
  const rows = db
    .select({
      id: accounts.id,
      companyId: accounts.companyId,
      displayName: accounts.displayName,
      accountNumber: accounts.accountNumber,
      isActive: accounts.isActive,
      lastScrapedAt: accounts.lastScrapedAt,
      transactionCount:
        sql<number>`(SELECT COUNT(*) FROM transactions WHERE account_id = ${accounts.id})`.as(
          'transaction_count',
        ),
      totalSpending:
        sql<number>`(SELECT COALESCE(SUM(charged_amount), 0) FROM transactions WHERE account_id = ${accounts.id})`.as(
          'total_spending',
        ),
    })
    .from(accounts)
    .all();

  return JSON.stringify({ accounts: rows });
}

export function getLatestScrapeTransactions(): string {
  // 1. Find latest completed session
  const session = db
    .select()
    .from(scrapeSessions)
    .where(eq(scrapeSessions.status, 'completed'))
    .orderBy(desc(scrapeSessions.completedAt))
    .limit(1)
    .get();

  if (!session) {
    return JSON.stringify({ error: 'No completed scrape sessions found' });
  }

  // 2. Get per-account stats from scrape logs
  const logs = db
    .select({
      accountId: scrapeLogs.accountId,
      displayName: accounts.displayName,
      status: scrapeLogs.status,
      transactionsFound: scrapeLogs.transactionsFound,
      transactionsNew: scrapeLogs.transactionsNew,
      errorType: scrapeLogs.errorType,
      errorMessage: scrapeLogs.errorMessage,
    })
    .from(scrapeLogs)
    .leftJoin(accounts, eq(scrapeLogs.accountId, accounts.id))
    .where(eq(scrapeLogs.sessionId, session.id))
    .all();

  // 3. Get new transactions from this session (with account name)
  const MAX_TRANSACTIONS = 200;
  const newTxns = db
    .select({
      id: transactions.id,
      date: transactions.date,
      chargedAmount: transactions.chargedAmount,
      description: transactions.description,
      category: transactions.category,
      memo: transactions.memo,
      needsReview: transactions.needsReview,
      confidence: transactions.confidence,
      reviewReason: transactions.reviewReason,
      accountName: accounts.displayName,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(eq(transactions.scrapeSessionId, session.id))
    .orderBy(desc(transactions.date))
    .limit(MAX_TRANSACTIONS + 1)
    .all();

  const truncated = newTxns.length > MAX_TRANSACTIONS;
  const txnsToReturn = truncated ? newTxns.slice(0, MAX_TRANSACTIONS) : newTxns;

  // 4. Count total if truncated
  const totalNew = truncated
    ? db
        .select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(eq(transactions.scrapeSessionId, session.id))
        .get()!.count
    : newTxns.length;

  return JSON.stringify({
    session: {
      id: session.id,
      trigger: session.trigger,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    },
    accounts: logs.map((l) => ({
      accountId: l.accountId,
      displayName: l.displayName,
      status: l.status,
      transactionsFound: l.transactionsFound,
      transactionsNew: l.transactionsNew,
      ...(l.errorType ? { errorType: l.errorType, errorMessage: l.errorMessage } : {}),
    })),
    newTransactions: txnsToReturn,
    totalNew,
    ...(truncated ? { truncated: true } : {}),
  });
}
