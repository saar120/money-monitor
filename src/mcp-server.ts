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
  addCategory,
} = await import('./ai/tools.js');

const {
  getNetWorth,
  getAssetDetails,
  getLiabilities,
  getNetWorthHistory,
  manageAsset,
  manageHolding,
  recordMovement,
  manageLiability,
} = await import('./ai/asset-tools.js');

const { ASSET_TYPES, LIQUIDITY_TYPES, HOLDING_TYPES, MOVEMENT_TYPES, LIABILITY_TYPES } =
  await import('./shared/types.js');

const server = new McpServer({
  name: 'money-monitor-mcp-server',
  version: '1.0.0',
});

// ── Read-only tools ─────────────────────────────────────────────────────────────

server.registerTool(
  'query_transactions',
  {
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: queryTransactions(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'get_spending_summary',
  {
    title: 'Get Spending Summary',
    description:
      'Get aggregated spending totals grouped by category, month, or account. ' +
      'Ignored transactions are excluded. Useful for understanding spending patterns and breakdowns.',
    inputSchema: {
      group_by: z
        .enum(['category', 'month', 'account'])
        .optional()
        .describe('How to group results (default: category)'),
      account_id: z.number().optional().describe('Filter by account ID'),
      start_date: z.string().optional().describe('Start date (ISO)'),
      end_date: z.string().optional().describe('End date (ISO)'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: getSpendingSummary(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'get_account_balances',
  {
    title: 'Get Account Balances',
    description:
      'List all configured bank/credit-card accounts with their display names, last scrape time, ' +
      'total transaction count, and total spending. Use this to discover available accounts.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      return { content: [{ type: 'text', text: getAccountBalances() }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'compare_periods',
  {
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: comparePeriods(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'get_spending_trends',
  {
    title: 'Get Spending Trends',
    description:
      'Analyze spending trends over multiple months. Returns monthly totals, trend direction ' +
      '(increasing/decreasing/stable), averages, min/max months, and month-over-month changes.',
    inputSchema: {
      months: z.number().optional().describe('Number of months to analyze (default 6, max 24)'),
      category: z.string().optional().describe('Filter to a specific category'),
      account_id: z.number().optional().describe('Filter by account ID'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: getSpendingTrends(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'detect_recurring_transactions',
  {
    title: 'Detect Recurring Transactions',
    description:
      'Find subscriptions, memberships, and recurring bills by analyzing transaction history. ' +
      'Returns merchant name, average amount, frequency (weekly/monthly/quarterly/etc.), ' +
      'estimated annual cost, and next expected charge date.',
    inputSchema: {
      months_back: z
        .number()
        .optional()
        .describe('Months of history to analyze (default 6, max 12)'),
      min_occurrences: z
        .number()
        .optional()
        .describe('Minimum times a charge must repeat (default 2)'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: detectRecurringTransactions(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'get_top_merchants',
  {
    title: 'Get Top Merchants',
    description:
      'Rank merchants/payees by total spending, transaction frequency, or average amount. ' +
      'Returns merchant name, total spent, count, average/min/max amounts, and most common category.',
    inputSchema: {
      start_date: z.string().optional().describe('Start date (ISO)'),
      end_date: z.string().optional().describe('End date (ISO)'),
      sort_by: z
        .enum(['total', 'count', 'average'])
        .optional()
        .describe('Sort by total spending (default), count, or average'),
      limit: z.number().optional().describe('Number of top merchants (default 15, max 50)'),
      category: z.string().optional().describe('Filter to a specific category'),
      account_id: z.number().optional().describe('Filter by account ID'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: getTopMerchants(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

// ── Write tool ──────────────────────────────────────────────────────────────────

server.registerTool(
  'categorize_transaction',
  {
    title: 'Categorize Transaction',
    description:
      'Assign a category to a transaction by ID. Provide a confidence score (0-1). ' +
      'Transactions with confidence < 0.8 are flagged for manual review.',
    inputSchema: {
      transaction_id: z.number().describe('The transaction ID'),
      category: z
        .string()
        .describe('Category to assign (use get_spending_summary to see available categories)'),
      confidence: z.number().min(0).max(1).describe('Confidence level 0.0-1.0'),
      review_reason: z.string().optional().describe('Reason if confidence is low (<0.8)'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: categorizeTransaction(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'add_category',
  {
    title: 'Add Category',
    description:
      'Create a new spending category. Requires a unique machine-friendly name (lowercase, dashes/underscores) ' +
      'and a human-readable label. Optionally set a color and categorization rules for the AI.',
    inputSchema: {
      name: z
        .string()
        .regex(/^[a-z0-9][a-z0-9_-]*$/)
        .describe('Unique machine name (lowercase, dashes/underscores, e.g. "groceries")'),
      label: z.string().describe('Human-readable display name (e.g. "Groceries & Food")'),
      color: z.string().optional().describe('Hex color code (e.g. "#4CAF50")'),
      rules: z
        .string()
        .optional()
        .describe('Categorization hints for the AI (e.g. "Supermarkets, markets, food delivery")'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: addCategory(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

// ── Net Worth & Asset tools ──────────────────────────────────────────────────────

server.registerTool(
  'get_net_worth',
  {
    title: 'Get Net Worth',
    description:
      'Get a complete net worth summary: bank balances, investment assets (with P&L), ' +
      'liabilities, and totals (total, liquid). Use for financial overview questions.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      return { content: [{ type: 'text', text: await getNetWorth() }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'get_asset_details',
  {
    title: 'Get Asset Details',
    description:
      'Get detailed info about a specific asset: holdings, P&L, and optionally movements and value history. ' +
      'Search by name (fuzzy match) or ID.',
    inputSchema: {
      asset_id: z.number().optional().describe('Asset ID'),
      asset_name: z.string().optional().describe('Asset name (case-insensitive fuzzy match)'),
      include_movements: z
        .boolean()
        .optional()
        .describe('Include recent movements (default false)'),
      include_snapshots: z.boolean().optional().describe('Include value history (default false)'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: await getAssetDetails(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'get_liabilities',
  {
    title: 'Get Liabilities',
    description:
      'List all liabilities (loans, mortgages, credit lines) with current balances in ILS.',
    inputSchema: {
      include_inactive: z
        .boolean()
        .optional()
        .describe('Include deactivated liabilities (default false)'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: await getLiabilities(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'get_net_worth_history',
  {
    title: 'Get Net Worth History',
    description:
      'Get historical net worth trends over time with breakdown by banks, assets, and liabilities. ' +
      'Supports daily, weekly, or monthly granularity.',
    inputSchema: {
      start_date: z.string().optional().describe('Start date (ISO). Defaults to 1 year ago.'),
      end_date: z.string().optional().describe('End date (ISO). Defaults to today.'),
      granularity: z
        .enum(['daily', 'weekly', 'monthly'])
        .optional()
        .describe('Data point frequency (default: monthly)'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: await getNetWorthHistory(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'manage_asset',
  {
    title: 'Manage Asset',
    description:
      'Create, update, or modify assets. Actions: create, update, update_value, record_rent.',
    inputSchema: {
      action: z
        .enum(['create', 'update', 'update_value', 'record_rent'])
        .describe('Action to perform'),
      name: z.string().optional(),
      type: z.enum(ASSET_TYPES).optional(),
      institution: z.string().optional(),
      currency: z.string().optional(),
      liquidity: z.enum(LIQUIDITY_TYPES).optional(),
      initial_value: z.number().optional(),
      initial_cost_basis: z.number().optional(),
      notes: z.string().optional(),
      asset_id: z.number().optional(),
      current_value: z.number().optional(),
      contribution: z.number().optional(),
      date: z.string().optional(),
      amount: z.number().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: await manageAsset(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'manage_holding',
  {
    title: 'Manage Holding',
    description:
      'Create, update, or delete individual holdings within an asset (stocks, ETFs, crypto coins, cash).',
    inputSchema: {
      action: z.enum(['create', 'update', 'delete']).describe('Action to perform'),
      asset_id: z.number().optional(),
      name: z.string().optional(),
      type: z.enum(HOLDING_TYPES).optional(),
      currency: z.string().optional(),
      quantity: z.number().optional(),
      cost_basis: z.number().optional(),
      last_price: z.number().optional(),
      notes: z.string().optional(),
      holding_id: z.number().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: await manageHolding(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'record_movement',
  {
    title: 'Record Movement',
    description:
      'Record a financial movement (buy, sell, deposit, withdrawal, dividend) on a brokerage or crypto asset.',
    inputSchema: {
      asset_id: z.number().describe('Asset ID'),
      holding_id: z.number().optional().describe('Holding ID (required for buy/sell)'),
      type: z.enum(MOVEMENT_TYPES).describe('Movement type'),
      quantity: z.number().describe('Amount'),
      currency: z.string().describe('Currency code'),
      price_per_unit: z.number().optional(),
      source_amount: z.number().optional(),
      source_currency: z.string().optional(),
      date: z.string().describe('Date (ISO)'),
      notes: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: await recordMovement(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

server.registerTool(
  'manage_liability',
  {
    title: 'Manage Liability',
    description: 'Create, update, or deactivate liabilities (loans, mortgages, credit lines).',
    inputSchema: {
      action: z.enum(['create', 'update', 'deactivate']).describe('Action to perform'),
      name: z.string().optional(),
      type: z.enum(LIABILITY_TYPES).optional(),
      currency: z.string().optional(),
      original_amount: z.number().optional(),
      current_balance: z.number().optional(),
      interest_rate: z.number().optional(),
      start_date: z.string().optional(),
      notes: z.string().optional(),
      liability_id: z.number().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      return { content: [{ type: 'text', text: await manageLiability(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
    }
  },
);

// ── Start server ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Money Monitor MCP server running via stdio');
