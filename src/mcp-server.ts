#!/usr/bin/env node
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env from project root before any app module reads process.env.
// Claude Desktop doesn't set cwd, so dotenv/config (which uses cwd) won't find .env.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// Dynamic imports — must come AFTER dotenv.config() so config.ts sees the env vars.
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = await import('zod');
const {
  queryTransactions,
  getSpendingSummary,
  getAccountBalances,
  comparePeriods,
  getSpendingTrends,
  detectRecurringTransactions,
  getTopMerchants,
  categorizeTransaction,
} = await import('./ai/tools.js');

const server = new McpServer({
  name: 'money-monitor-mcp-server',
  version: '1.0.0',
});

// ── Read-only tools ─────────────────────────────────────────────────────────────

server.registerTool('query_transactions', {
  title: 'Query Transactions',
  description:
    'Search and filter financial transactions. Supports date ranges, categories, amount ranges, ' +
    'full-text search across description/memo, account filtering, and status filtering. ' +
    'Returns matched transactions with total count. All amounts are in ILS.',
  inputSchema: {
    account_id: z.number().optional().describe('Filter by account ID'),
    start_date: z.string().optional().describe('Start date (ISO, e.g. "2026-01-01")'),
    end_date: z.string().optional().describe('End date (ISO, e.g. "2026-01-31")'),
    category: z.string().optional().describe('Filter by category name'),
    status: z.enum(['completed', 'pending']).optional().describe('Transaction status'),
    min_amount: z.number().optional().describe('Minimum charged amount'),
    max_amount: z.number().optional().describe('Maximum charged amount'),
    search: z.string().optional().describe('Full-text search in description and memo'),
    limit: z.number().optional().describe('Max results (default 50, max 200)'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  try {
    return { content: [{ type: 'text', text: queryTransactions(args) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
  }
});

server.registerTool('get_spending_summary', {
  title: 'Get Spending Summary',
  description:
    'Get aggregated spending totals grouped by category, month, or account. ' +
    'Ignored transactions are excluded. Useful for understanding spending patterns and breakdowns.',
  inputSchema: {
    group_by: z.enum(['category', 'month', 'account']).optional().describe('How to group results (default: category)'),
    account_id: z.number().optional().describe('Filter by account ID'),
    start_date: z.string().optional().describe('Start date (ISO)'),
    end_date: z.string().optional().describe('End date (ISO)'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  try {
    return { content: [{ type: 'text', text: getSpendingSummary(args) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
  }
});

server.registerTool('get_account_balances', {
  title: 'Get Account Balances',
  description:
    'List all configured bank/credit-card accounts with their display names, last scrape time, ' +
    'total transaction count, and total spending. Use this to discover available accounts.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async () => {
  try {
    return { content: [{ type: 'text', text: getAccountBalances() }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
  }
});

server.registerTool('compare_periods', {
  title: 'Compare Spending Periods',
  description:
    'Compare spending between two date ranges side-by-side. Returns per-category breakdown ' +
    'with totals, transaction counts, and percentage change. Great for month-over-month comparisons.',
  inputSchema: {
    period1_start: z.string().describe('Start date of first period (ISO, e.g. "2026-01-01")'),
    period1_end: z.string().describe('End date of first period (ISO, e.g. "2026-01-31")'),
    period2_start: z.string().describe('Start date of second period (ISO, e.g. "2026-02-01")'),
    period2_end: z.string().describe('End date of second period (ISO, e.g. "2026-02-28")'),
    account_id: z.number().optional().describe('Filter by account ID'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  try {
    return { content: [{ type: 'text', text: comparePeriods(args) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
  }
});

server.registerTool('get_spending_trends', {
  title: 'Get Spending Trends',
  description:
    'Analyze spending trends over multiple months. Returns monthly totals, trend direction ' +
    '(increasing/decreasing/stable), averages, min/max months, and month-over-month changes.',
  inputSchema: {
    months: z.number().optional().describe('Number of months to analyze (default 6, max 24)'),
    category: z.string().optional().describe('Filter to a specific category'),
    account_id: z.number().optional().describe('Filter by account ID'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  try {
    return { content: [{ type: 'text', text: getSpendingTrends(args) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
  }
});

server.registerTool('detect_recurring_transactions', {
  title: 'Detect Recurring Transactions',
  description:
    'Find subscriptions, memberships, and recurring bills by analyzing transaction history. ' +
    'Returns merchant name, average amount, frequency (weekly/monthly/quarterly/etc.), ' +
    'estimated annual cost, and next expected charge date.',
  inputSchema: {
    months_back: z.number().optional().describe('Months of history to analyze (default 6, max 12)'),
    min_occurrences: z.number().optional().describe('Minimum times a charge must repeat (default 2)'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  try {
    return { content: [{ type: 'text', text: detectRecurringTransactions(args) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
  }
});

server.registerTool('get_top_merchants', {
  title: 'Get Top Merchants',
  description:
    'Rank merchants/payees by total spending, transaction frequency, or average amount. ' +
    'Returns merchant name, total spent, count, average/min/max amounts, and most common category.',
  inputSchema: {
    start_date: z.string().optional().describe('Start date (ISO)'),
    end_date: z.string().optional().describe('End date (ISO)'),
    sort_by: z.enum(['total', 'count', 'average']).optional().describe('Sort by total spending (default), count, or average'),
    limit: z.number().optional().describe('Number of top merchants (default 15, max 50)'),
    category: z.string().optional().describe('Filter to a specific category'),
    account_id: z.number().optional().describe('Filter by account ID'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  try {
    return { content: [{ type: 'text', text: getTopMerchants(args) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
  }
});

// ── Write tool ──────────────────────────────────────────────────────────────────

server.registerTool('categorize_transaction', {
  title: 'Categorize Transaction',
  description:
    'Assign a category to a transaction by ID. Provide a confidence score (0-1). ' +
    'Transactions with confidence < 0.8 are flagged for manual review.',
  inputSchema: {
    transaction_id: z.number().describe('The transaction ID'),
    category: z.string().describe('Category to assign (use get_spending_summary to see available categories)'),
    confidence: z.number().min(0).max(1).describe('Confidence level 0.0-1.0'),
    review_reason: z.string().optional().describe('Reason if confidence is low (<0.8)'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  try {
    return { content: [{ type: 'text', text: categorizeTransaction(args) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
  }
});

// ── Start server ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Money Monitor MCP server running via stdio');
