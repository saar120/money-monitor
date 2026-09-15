#!/usr/bin/env node
import dotenv from 'dotenv';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

// Claude/Codex may launch this from any working directory.
const modulePath = fileURLToPath(import.meta.url);
dotenv.config({ path: join(dirname(modulePath), '..', '.env'), quiet: true });

// App imports must follow dotenv and, in Electron, safe-storage registration.
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
  getCategoryRules,
  updateCategoryRules,
  getLatestScrapeTransactions,
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
const { getBudgetProgress, manageBudget } = await import('./ai/budget-tools.js');
const { getAlertSettings, updateAlertSettingsFromTool } = await import('./ai/alert-tools.js');
const { listMembers } = await import('./services/members.js');
const { listOwnershipRules } = await import('./services/ownership.js');
const { ASSET_TYPES, LIQUIDITY_TYPES, HOLDING_TYPES, MOVEMENT_TYPES, LIABILITY_TYPES } =
  await import('./shared/types.js');

export type McpAccessMode = 'read-only' | 'read-write';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

function result(operation: () => string | Promise<string>) {
  return Promise.resolve()
    .then(operation)
    .then((text) => ({ content: [{ type: 'text' as const, text }] }))
    .catch((error: unknown) => ({
      isError: true,
      content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
    }));
}

export function resolveMcpAccessMode(
  args = process.argv.slice(2),
  envValue = process.env.MONEY_MONITOR_MCP_ACCESS,
): McpAccessMode {
  const inline = args.find((arg) => arg.startsWith('--mcp-access='))?.split('=', 2)[1];
  const flagIndex = args.indexOf('--mcp-access');
  const separate = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  const raw = inline ?? separate ?? envValue ?? 'read-only';

  if (raw === 'read-only' || raw === 'read-write') return raw;
  throw new Error(`Invalid MCP access mode "${raw}". Use read-only or read-write.`);
}

export function buildMoneyMonitorMcpServer(accessMode: McpAccessMode = 'read-only'): McpServer {
  const server = new McpServer(
    { name: 'money-monitor', version: '0.6.0' },
    {
      instructions:
        `Money Monitor provides private local finance data in ILS. Access is ${accessMode}. ` +
        'Use ISO dates (YYYY-MM-DD). Discover accounts and household members before filtering by IDs. ' +
        'Ignored transactions are excluded from spending analytics. In read-write mode, explain and confirm material mutations with the user before calling write tools.',
    },
  );

  server.registerTool(
    'query_transactions',
    {
      title: 'Query Transactions',
      description:
        'Search financial transactions by account, reporting date, category, amount, text, review status, or household owner. Reporting date uses effectiveDate when set, otherwise the bank date. Returns newest matches first; amounts are in ILS.',
      inputSchema: z.object({
        account_id: z.number().optional().describe('Account ID from get_account_balances'),
        start_date: z.string().optional().describe('Reporting-period start (YYYY-MM-DD)'),
        end_date: z.string().optional().describe('Reporting-period end (YYYY-MM-DD)'),
        category: z.string().optional().describe('Category machine name'),
        status: z.enum(['completed', 'pending']).optional(),
        min_amount: z.number().optional().describe('Minimum charged amount'),
        max_amount: z.number().optional().describe('Maximum charged amount'),
        search: z.string().optional().describe('Search description and memo'),
        needs_review: z.boolean().optional(),
        owner_type: z.enum(['member', 'shared', 'unassigned']).optional(),
        owner_member_id: z.number().optional().describe('Required with owner_type=member'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50, maximum 200'),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => queryTransactions(args)),
  );

  server.registerTool(
    'get_spending_summary',
    {
      title: 'Get Spending Summary',
      description:
        'Aggregate spending by reporting date, grouped by category, month, account, or expense owner. Ignored transactions are excluded.',
      inputSchema: z.object({
        group_by: z.enum(['category', 'month', 'account', 'expense-owner']).optional(),
        account_id: z.number().optional(),
        start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
        owner_type: z.enum(['member', 'shared', 'unassigned']).optional(),
        owner_member_id: z.number().optional().describe('Required with owner_type=member'),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => getSpendingSummary(args)),
  );

  server.registerTool(
    'get_account_balances',
    {
      title: 'Get Account Balances',
      description:
        'List configured accounts, household owner, latest scrape time, transaction count, and total spending.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => result(() => getAccountBalances()),
  );

  server.registerTool(
    'get_household_context',
    {
      title: 'Get Household Context',
      description:
        'List household members and ownership rules. Use this to discover member IDs and understand how transactions are assigned as personal, shared, or unassigned.',
      inputSchema: z.object({ include_inactive: z.boolean().optional().describe('Default false') }),
      annotations: READ_ONLY,
    },
    ({ include_inactive }) =>
      result(() =>
        JSON.stringify({
          members: listMembers(include_inactive ?? false),
          ownershipRules: listOwnershipRules(),
        }),
      ),
  );

  server.registerTool(
    'compare_periods',
    {
      title: 'Compare Spending Periods',
      description:
        'Compare category spending between two date ranges, including totals, counts, and percentage changes.',
      inputSchema: z.object({
        period1_start: z.string().describe('First period start (YYYY-MM-DD)'),
        period1_end: z.string().describe('First period end (YYYY-MM-DD)'),
        period2_start: z.string().describe('Second period start (YYYY-MM-DD)'),
        period2_end: z.string().describe('Second period end (YYYY-MM-DD)'),
        account_id: z.number().optional(),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => comparePeriods(args)),
  );

  server.registerTool(
    'get_spending_trends',
    {
      title: 'Get Spending Trends',
      description:
        'Analyze monthly spending direction, averages, extremes, and month-over-month changes.',
      inputSchema: z.object({
        months: z.number().int().min(1).max(24).optional().describe('Default 6'),
        category: z.string().optional(),
        account_id: z.number().optional(),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => getSpendingTrends(args)),
  );

  server.registerTool(
    'detect_recurring_transactions',
    {
      title: 'Detect Recurring Transactions',
      description:
        'Detect subscriptions and recurring bills, including frequency, annual cost, and next expected charge.',
      inputSchema: z.object({
        months_back: z.number().int().min(1).max(12).optional().describe('Default 6'),
        min_occurrences: z.number().int().min(2).optional().describe('Default 2'),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => detectRecurringTransactions(args)),
  );

  server.registerTool(
    'get_top_merchants',
    {
      title: 'Get Top Merchants',
      description:
        'Rank merchants by total spending, transaction count, or average amount for an optional period, category, or account.',
      inputSchema: z.object({
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        sort_by: z.enum(['total', 'count', 'average']).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        category: z.string().optional(),
        account_id: z.number().optional(),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => getTopMerchants(args)),
  );

  server.registerTool(
    'get_category_rules',
    {
      title: 'Get Category Rules',
      description: 'Get categorization rules for one category or all categories.',
      inputSchema: z.object({ category_name: z.string().optional() }),
      annotations: READ_ONLY,
    },
    (args) => result(() => getCategoryRules(args)),
  );

  server.registerTool(
    'get_latest_scrape_transactions',
    {
      title: 'Get Latest Scrape Transactions',
      description:
        'Get the newest transactions and per-account outcome from the most recently finished scrape session.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => result(() => getLatestScrapeTransactions()),
  );

  server.registerTool(
    'get_net_worth',
    {
      title: 'Get Net Worth',
      description:
        'Get bank balances, investments with profit/loss, liabilities, total net worth, and liquid net worth.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => result(() => getNetWorth()),
  );

  server.registerTool(
    'get_asset_details',
    {
      title: 'Get Asset Details',
      description:
        'Get an asset and its holdings, profit/loss, and optional movements and value snapshots.',
      inputSchema: z.object({
        asset_id: z.number().optional(),
        asset_name: z.string().optional().describe('Case-insensitive fuzzy name'),
        include_movements: z.boolean().optional(),
        include_snapshots: z.boolean().optional(),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => getAssetDetails(args)),
  );

  server.registerTool(
    'get_liabilities',
    {
      title: 'Get Liabilities',
      description: 'List liabilities and their current balances in ILS.',
      inputSchema: z.object({ include_inactive: z.boolean().optional() }),
      annotations: READ_ONLY,
    },
    (args) => result(() => getLiabilities(args)),
  );

  server.registerTool(
    'get_net_worth_history',
    {
      title: 'Get Net Worth History',
      description:
        'Get historical net worth with bank, asset, and liability breakdown at daily, weekly, or monthly granularity.',
      inputSchema: z.object({
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => getNetWorthHistory(args)),
  );

  server.registerTool(
    'get_budget_progress',
    {
      title: 'Get Budget Progress',
      description:
        'Get spent, remaining, percentage used, and over-budget status for one or all active budgets. Supports historical periods and yearly monthly breakdowns.',
      inputSchema: z.object({
        budget_id: z.number().optional(),
        monthly_view: z.boolean().optional(),
        reference_date: z.string().optional().describe('Date selecting the month or year'),
      }),
      annotations: READ_ONLY,
    },
    (args) => result(() => getBudgetProgress(args)),
  );

  server.registerTool(
    'get_alert_settings',
    {
      title: 'Get Alert Settings',
      description: 'View the current Telegram spending and scrape alert configuration.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => result(() => getAlertSettings()),
  );

  if (accessMode === 'read-only') return server;

  server.registerTool(
    'categorize_transaction',
    {
      title: 'Categorize Transaction',
      description:
        'Assign a category to a transaction. Confidence below 0.8 flags it for manual review.',
      inputSchema: z.object({
        transaction_id: z.number(),
        category: z.string(),
        confidence: z.number().min(0).max(1),
        review_reason: z.string().optional(),
      }),
      annotations: { ...WRITE, idempotentHint: true },
    },
    (args) => result(() => categorizeTransaction(args)),
  );

  server.registerTool(
    'add_category',
    {
      title: 'Add Category',
      description: 'Create a spending category with optional color and AI categorization rules.',
      inputSchema: z.object({
        name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
        label: z.string(),
        color: z.string().optional(),
        rules: z.string().optional(),
      }),
      annotations: WRITE,
    },
    (args) => result(() => addCategory(args)),
  );

  server.registerTool(
    'update_category_rules',
    {
      title: 'Update Category Rules',
      description:
        'Replace the AI categorization hints for a category. Read the current rules first.',
      inputSchema: z.object({ category_name: z.string(), rules: z.string() }),
      annotations: { ...WRITE, idempotentHint: true },
    },
    (args) => result(() => updateCategoryRules(args)),
  );

  server.registerTool(
    'manage_asset',
    {
      title: 'Manage Asset',
      description: 'Create or update an asset, update its value, or record rent.',
      inputSchema: z.object({
        action: z.enum(['create', 'update', 'update_value', 'record_rent']),
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
      }),
      annotations: WRITE,
    },
    (args) => result(() => manageAsset(args)),
  );

  server.registerTool(
    'manage_holding',
    {
      title: 'Manage Holding',
      description: 'Create, update, or delete a holding inside an investment asset.',
      inputSchema: z.object({
        action: z.enum(['create', 'update', 'delete']),
        asset_id: z.number().optional(),
        name: z.string().optional(),
        type: z.enum(HOLDING_TYPES).optional(),
        currency: z.string().optional(),
        quantity: z.number().optional(),
        cost_basis: z.number().optional(),
        last_price: z.number().optional(),
        notes: z.string().optional(),
        holding_id: z.number().optional(),
      }),
      annotations: { ...WRITE, destructiveHint: true },
    },
    (args) => result(() => manageHolding(args)),
  );

  server.registerTool(
    'record_movement',
    {
      title: 'Record Movement',
      description: 'Record a buy, sell, deposit, withdrawal, or dividend on an asset.',
      inputSchema: z.object({
        asset_id: z.number(),
        holding_id: z.number().optional(),
        type: z.enum(MOVEMENT_TYPES),
        quantity: z.number(),
        currency: z.string(),
        price_per_unit: z.number().optional(),
        source_amount: z.number().optional(),
        source_currency: z.string().optional(),
        date: z.string(),
        notes: z.string().optional(),
      }),
      annotations: WRITE,
    },
    (args) => result(() => recordMovement(args)),
  );

  server.registerTool(
    'manage_liability',
    {
      title: 'Manage Liability',
      description: 'Create, update, or deactivate a loan, mortgage, or credit line.',
      inputSchema: z.object({
        action: z.enum(['create', 'update', 'deactivate']),
        name: z.string().optional(),
        type: z.enum(LIABILITY_TYPES).optional(),
        currency: z.string().optional(),
        original_amount: z.number().optional(),
        current_balance: z.number().optional(),
        interest_rate: z.number().optional(),
        start_date: z.string().optional(),
        notes: z.string().optional(),
        liability_id: z.number().optional(),
      }),
      annotations: WRITE,
    },
    (args) => result(() => manageLiability(args)),
  );

  server.registerTool(
    'manage_budget',
    {
      title: 'Manage Budget',
      description: 'Create, update, or permanently delete a spending budget.',
      inputSchema: z.object({
        action: z.enum(['create', 'update', 'delete']),
        budget_id: z.number().optional(),
        name: z.string().optional(),
        amount: z.number().positive().optional(),
        period: z.enum(['monthly', 'yearly']).optional(),
        category_names: z.array(z.string()).min(1).optional(),
        alert_threshold: z.number().min(0).max(100).optional(),
        alert_enabled: z.boolean().optional(),
        color: z.string().optional(),
        is_active: z.boolean().optional(),
      }),
      annotations: { ...WRITE, destructiveHint: true },
    },
    (args) => result(() => manageBudget(args)),
  );

  server.registerTool(
    'update_alert_settings',
    {
      title: 'Update Alert Settings',
      description: 'Update Telegram spending, scrape-error, or monthly-summary alerts.',
      inputSchema: z.object({
        enabled: z.boolean().optional(),
        large_charge_threshold: z.number().positive().optional(),
        unusual_spending_percent: z.number().positive().optional(),
        monthly_summary_enabled: z.boolean().optional(),
        monthly_summary_day: z.number().int().min(1).max(28).optional(),
        report_scrape_errors: z.boolean().optional(),
      }),
      annotations: { ...WRITE, idempotentHint: true },
    },
    (args) => result(() => updateAlertSettingsFromTool(args)),
  );

  return server;
}

export function startMoneyMonitorMcpServer(
  accessMode: McpAccessMode = resolveMcpAccessMode(),
): StdioServerHandle {
  const handle = serveStdio(() => buildMoneyMonitorMcpServer(accessMode), {
    onerror: (error) => console.error('[MCP]', error),
  });
  console.error(`Money Monitor MCP server running via stdio (${accessMode})`);
  return handle;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
  startMoneyMonitorMcpServer();
}
