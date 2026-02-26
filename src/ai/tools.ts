import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { eq, and, gte, lte, like, sql, count, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';
import { escapeLike } from '../api/validation.js';

export function buildTools(categoryNames: string[]): Tool[] {
  return [
    {
      name: 'query_transactions',
      description: 'Search and filter transactions from the database. Use this to find specific transactions or answer questions about spending.',
      input_schema: {
        type: 'object' as const,
        properties: {
          account_id: { type: 'number', description: 'Filter by account ID' },
          start_date: { type: 'string', description: 'Start date (ISO string, e.g. "2026-01-01")' },
          end_date: { type: 'string', description: 'End date (ISO string, e.g. "2026-01-31")' },
          category: { type: 'string', description: 'Filter by category' },
          status: { type: 'string', enum: ['completed', 'pending'], description: 'Transaction status' },
          min_amount: { type: 'number', description: 'Minimum charged amount' },
          max_amount: { type: 'number', description: 'Maximum charged amount' },
          search: { type: 'string', description: 'Search term for description (partial match)' },
          limit: { type: 'number', description: 'Max results to return (default 50, max 200)' },
        },
        required: [],
      },
    },
    {
      name: 'get_spending_summary',
      description: 'Get aggregated spending totals. Group by category, month, or account to understand spending patterns.',
      input_schema: {
        type: 'object' as const,
        properties: {
          group_by: {
            type: 'string',
            enum: ['category', 'month', 'account'],
            description: 'How to group the results (default: category)',
          },
          account_id: { type: 'number', description: 'Filter by account ID' },
          start_date: { type: 'string', description: 'Start date (ISO string)' },
          end_date: { type: 'string', description: 'End date (ISO string)' },
        },
        required: [],
      },
    },
    {
      name: 'categorize_transaction',
      description: 'Assign a category to a specific transaction by its ID.',
      input_schema: {
        type: 'object' as const,
        properties: {
          transaction_id: { type: 'number', description: 'The transaction ID' },
          category: {
            type: 'string',
            enum: categoryNames,
            description: 'The category to assign',
          },
        },
        required: ['transaction_id', 'category'],
      },
    },
    {
      name: 'get_account_balances',
      description: 'Get a list of all configured accounts with their latest scrape info and transaction counts.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ];
}

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

export async function handleToolCall(
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case 'query_transactions':
      return queryTransactions(input as QueryTransactionsInput);
    case 'get_spending_summary':
      return getSpendingSummary(input as GetSpendingSummaryInput);
    case 'categorize_transaction':
      return categorizeTransaction(input as unknown as CategorizeTransactionInput);
    case 'get_account_balances':
      return getAccountBalances();
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

function queryTransactions(input: QueryTransactionsInput): string {
  const conditions = [];
  if (input.account_id) conditions.push(eq(transactions.accountId, input.account_id));
  if (input.start_date) conditions.push(gte(transactions.date, input.start_date));
  if (input.end_date) conditions.push(lte(transactions.date, input.end_date));
  if (input.category) conditions.push(eq(transactions.category, input.category));
  if (input.status) conditions.push(eq(transactions.status, input.status));
  if (input.min_amount) conditions.push(gte(transactions.chargedAmount, input.min_amount));
  if (input.max_amount) conditions.push(lte(transactions.chargedAmount, input.max_amount));
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
  if (input.account_id) conditions.push(eq(transactions.accountId, input.account_id));
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
