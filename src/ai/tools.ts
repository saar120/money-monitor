import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { eq, and, gte, lte, like, sql, count, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';
import { escapeLike } from '../api/validation.js';

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
          search: z.string().optional().describe('Search term for description (partial match)'),
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
  if (input.search) conditions.push(like(transactions.description, `%${escapeLike(input.search)}%`));

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
