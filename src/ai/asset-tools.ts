import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  ASSET_TYPES, LIQUIDITY_TYPES, HOLDING_TYPES, MOVEMENT_TYPES, LIABILITY_TYPES,
} from '../shared/types.js';
import * as assetService from '../services/assets.js';
import * as liabilityService from '../services/liabilities.js';
import * as netWorthService from '../services/net-worth.js';

function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

async function safeTool(fn: () => Promise<string>) {
  try {
    return toolResult(await fn());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[asset-tools] Tool error:', e);
    return toolResult(`Error: ${message}`, true);
  }
}

// ── Read tool builders ──────────────────────────────────────────────────────────

export function buildGetNetWorthTool() {
  return tool(
    'get_net_worth',
    'Get a complete net worth summary: bank balances, investment assets, liabilities, and totals. Use this when the user asks about their overall financial picture, net worth, or total assets.',
    {},
    async () => safeTool(() => getNetWorth()),
  );
}

export function buildGetAssetDetailsTool() {
  return tool(
    'get_asset_details',
    'Get detailed information about a specific asset including holdings, P&L, and optionally movements and value history. Search by name (fuzzy match) or ID.',
    {
      asset_id: z.number().optional().describe('Asset ID (use this if you know the exact ID)'),
      asset_name: z.string().optional().describe('Asset name to search for (case-insensitive fuzzy match)'),
      include_movements: z.boolean().optional().describe('Include recent movements/transactions (default false)'),
      include_snapshots: z.boolean().optional().describe('Include value history snapshots (default false)'),
    },
    async (args) => safeTool(() => getAssetDetails(args)),
  );
}

export function buildGetLiabilitiesTool() {
  return tool(
    'get_liabilities',
    'List all liabilities (loans, mortgages, credit lines) with current balances in ILS.',
    {
      include_inactive: z.boolean().optional().describe('Include deactivated liabilities (default false)'),
    },
    async (args) => safeTool(() => getLiabilities(args)),
  );
}

export function buildGetNetWorthHistoryTool() {
  return tool(
    'get_net_worth_history',
    'Get historical net worth trends over time with breakdown by banks, assets, and liabilities. Use this when the user asks how their net worth has changed.',
    {
      start_date: z.string().optional().describe('Start date (ISO, e.g. "2025-01-01"). Defaults to 1 year ago.'),
      end_date: z.string().optional().describe('End date (ISO, e.g. "2026-03-01"). Defaults to today.'),
      granularity: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Data point frequency (default: monthly)'),
    },
    async (args) => safeTool(() => getNetWorthHistory(args)),
  );
}

// ── Write tool builders ─────────────────────────────────────────────────────────

export function buildManageAssetTool() {
  return tool(
    'manage_asset',
    `Create, update, or modify assets. Actions:
- "create": Create a new asset (pension, fund, keren_hishtalmut, real_estate, crypto, brokerage)
- "update": Update asset metadata (name, institution, liquidity, notes)
- "update_value": Update the current value of a simple_value or real_estate asset (optionally record a contribution)
- "record_rent": Record rent income for a real_estate asset
Before calling, confirm the details with the user if there is any ambiguity.`,
    {
      action: z.enum(['create', 'update', 'update_value', 'record_rent']).describe('The action to perform'),
      // For create
      name: z.string().optional().describe('Asset name (required for create)'),
      type: z.enum(ASSET_TYPES).optional().describe('Asset type (required for create)'),
      institution: z.string().optional().describe('Financial institution name'),
      currency: z.string().optional().describe('Currency code (default: ILS)'),
      liquidity: z.enum(LIQUIDITY_TYPES).optional().describe('Liquidity level'),
      initial_value: z.number().optional().describe('Initial value for create'),
      initial_cost_basis: z.number().optional().describe('Initial cost basis for create'),
      notes: z.string().optional().describe('Notes'),
      // For update, update_value, record_rent
      asset_id: z.number().optional().describe('Asset ID (required for update/update_value/record_rent)'),
      // For update_value
      current_value: z.number().optional().describe('New current value (required for update_value)'),
      contribution: z.number().optional().describe('Contribution amount to add to cost basis'),
      date: z.string().optional().describe('Date (ISO, defaults to today)'),
      // For record_rent
      amount: z.number().optional().describe('Rent amount (required for record_rent)'),
    },
    async (args) => safeTool(() => manageAsset(args)),
  );
}

export function buildManageHoldingTool() {
  return tool(
    'manage_holding',
    `Create, update, or delete individual holdings within an asset (stocks, ETFs, crypto coins, cash positions).
- "create": Add a new holding to an asset
- "update": Update holding quantity, cost basis, or price
- "delete": Remove a holding from an asset
Before calling, confirm the details with the user if there is any ambiguity.`,
    {
      action: z.enum(['create', 'update', 'delete']).describe('The action to perform'),
      // For create
      asset_id: z.number().optional().describe('Asset ID (required for create)'),
      name: z.string().optional().describe('Holding name, e.g. "AAPL", "BTC" (required for create)'),
      type: z.enum(HOLDING_TYPES).optional().describe('Holding type (required for create)'),
      currency: z.string().optional().describe('Currency code (required for create)'),
      quantity: z.number().optional().describe('Quantity/amount'),
      cost_basis: z.number().optional().describe('Total cost basis'),
      last_price: z.number().optional().describe('Last known price per unit'),
      notes: z.string().optional().describe('Notes'),
      // For update/delete
      holding_id: z.number().optional().describe('Holding ID (required for update/delete)'),
    },
    async (args) => safeTool(() => manageHolding(args)),
  );
}

export function buildRecordMovementTool() {
  return tool(
    'record_movement',
    `Record a financial movement (buy, sell, deposit, withdrawal, dividend) on a brokerage or crypto asset.
Movement types by asset category:
- Brokerage: deposit, withdrawal, buy, sell, dividend
- Crypto: buy, sell
- Simple value (pension/fund/kh): contribution (use manage_asset update_value instead)
- Real estate: rent_income (use manage_asset record_rent instead)
Before calling, confirm the details with the user. Quantity must be positive for buy/deposit/dividend, negative for sell/withdrawal.`,
    {
      asset_id: z.number().describe('Asset ID'),
      holding_id: z.number().optional().describe('Holding ID (required for buy/sell)'),
      type: z.enum(MOVEMENT_TYPES).describe('Movement type'),
      quantity: z.number().describe('Amount (positive for buy/deposit/dividend, negative for sell/withdrawal)'),
      currency: z.string().describe('Currency code'),
      price_per_unit: z.number().optional().describe('Price per unit (required for buy/sell on stock/etf/crypto holdings)'),
      source_amount: z.number().optional().describe('Amount in source currency (e.g. ILS amount for foreign currency deposits)'),
      source_currency: z.string().optional().describe('Source currency code (e.g. "ILS")'),
      date: z.string().describe('Date (ISO, e.g. "2026-03-07")'),
      notes: z.string().optional().describe('Notes'),
    },
    async (args) => safeTool(() => recordMovement(args)),
  );
}

export function buildManageLiabilityTool() {
  return tool(
    'manage_liability',
    `Create, update, or deactivate liabilities (loans, mortgages, credit lines).
- "create": Add a new liability
- "update": Update liability details (balance, interest rate, etc.)
- "deactivate": Mark a liability as inactive (paid off)
Before calling, confirm the details with the user if there is any ambiguity.`,
    {
      action: z.enum(['create', 'update', 'deactivate']).describe('The action to perform'),
      // For create
      name: z.string().optional().describe('Liability name (required for create)'),
      type: z.enum(LIABILITY_TYPES).optional().describe('Liability type (required for create)'),
      currency: z.string().optional().describe('Currency code (default: ILS)'),
      original_amount: z.number().optional().describe('Original loan amount (required for create)'),
      current_balance: z.number().optional().describe('Current outstanding balance (required for create)'),
      interest_rate: z.number().optional().describe('Annual interest rate (percentage)'),
      start_date: z.string().optional().describe('Start date (ISO)'),
      notes: z.string().optional().describe('Notes'),
      // For update/deactivate
      liability_id: z.number().optional().describe('Liability ID (required for update/deactivate)'),
    },
    async (args) => safeTool(() => manageLiability(args)),
  );
}

// ── Query functions ─────────────────────────────────────────────────────────────

async function getNetWorth(): Promise<string> {
  const result = await netWorthService.getNetWorth();
  return JSON.stringify(result);
}

async function getAssetDetails(input: {
  asset_id?: number;
  asset_name?: string;
  include_movements?: boolean;
  include_snapshots?: boolean;
}): Promise<string> {
  if (!input.asset_id && !input.asset_name) {
    return JSON.stringify({ error: 'Provide either asset_id or asset_name' });
  }

  let result: Record<string, unknown>;
  let assetId: number;

  if (input.asset_name) {
    const found = await assetService.findAssetByName(input.asset_name);
    if ('error' in found) return JSON.stringify(found);
    assetId = found.asset.id;
    result = { ...found.asset };
  } else {
    const asset = await assetService.getAsset(input.asset_id!);
    if (!asset) return JSON.stringify({ error: 'Asset not found' });
    assetId = asset.id;
    result = { ...asset };
  }

  if (input.include_movements) {
    const { movements } = assetService.listMovements(assetId, { limit: 50 });
    result.movements = movements;
  }

  if (input.include_snapshots) {
    result.snapshots = assetService.getSnapshots(assetId);
  }

  return JSON.stringify(result);
}

async function getLiabilities(input: { include_inactive?: boolean }): Promise<string> {
  const result = await liabilityService.listLiabilities({ includeInactive: input.include_inactive });
  return JSON.stringify({ liabilities: result });
}

async function getNetWorthHistory(input: {
  start_date?: string;
  end_date?: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
}): Promise<string> {
  const result = await netWorthService.getNetWorthHistory({
    startDate: input.start_date,
    endDate: input.end_date,
    granularity: input.granularity,
  });
  if ('error' in result) return JSON.stringify({ error: result.error });
  return JSON.stringify(result);
}

// ── Write functions ─────────────────────────────────────────────────────────────

async function manageAsset(input: {
  action: string;
  name?: string; type?: string; institution?: string; currency?: string;
  liquidity?: string; initial_value?: number; initial_cost_basis?: number;
  notes?: string; asset_id?: number; current_value?: number;
  contribution?: number; date?: string; amount?: number;
}): Promise<string> {
  if (input.action === 'create') {
    if (!input.name) return JSON.stringify({ error: 'name is required for create' });
    if (!input.type) return JSON.stringify({ error: 'type is required for create' });

    const result = await assetService.createAsset({
      name: input.name,
      type: input.type,
      currency: input.currency ?? 'ILS',
      institution: input.institution,
      liquidity: input.liquidity,
      notes: input.notes,
      initialValue: input.initial_value,
      initialCostBasis: input.initial_cost_basis,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify(result.asset);
  }

  if (input.action === 'update') {
    if (!input.asset_id) return JSON.stringify({ error: 'asset_id is required for update' });

    const result = await assetService.updateAsset(input.asset_id, {
      name: input.name,
      institution: input.institution,
      liquidity: input.liquidity,
      notes: input.notes,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify(result.asset);
  }

  if (input.action === 'update_value') {
    if (!input.asset_id) return JSON.stringify({ error: 'asset_id is required for update_value' });
    if (input.current_value === undefined) return JSON.stringify({ error: 'current_value is required for update_value' });

    const result = await assetService.updateAssetValue(input.asset_id, {
      currentValue: input.current_value,
      contribution: input.contribution,
      date: input.date,
      notes: input.notes,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify(result.asset);
  }

  if (input.action === 'record_rent') {
    if (!input.asset_id) return JSON.stringify({ error: 'asset_id is required for record_rent' });
    if (!input.amount || input.amount <= 0) return JSON.stringify({ error: 'amount must be positive for record_rent' });

    const result = await assetService.recordRent(input.asset_id, {
      amount: input.amount,
      date: input.date,
      notes: input.notes,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });

    // Return the refreshed asset for consistency
    const asset = await assetService.getAsset(input.asset_id);
    return JSON.stringify({ success: true, asset });
  }

  return JSON.stringify({ error: `Unknown action: ${input.action}` });
}

async function manageHolding(input: {
  action: string;
  asset_id?: number; name?: string; type?: string; currency?: string;
  quantity?: number; cost_basis?: number; last_price?: number; notes?: string;
  holding_id?: number;
}): Promise<string> {
  if (input.action === 'create') {
    if (!input.asset_id) return JSON.stringify({ error: 'asset_id is required for create' });
    if (!input.name) return JSON.stringify({ error: 'name is required for create' });
    if (!input.type) return JSON.stringify({ error: 'type is required for create' });
    if (!input.currency) return JSON.stringify({ error: 'currency is required for create' });

    const result = await assetService.createHolding(input.asset_id, {
      name: input.name,
      type: input.type,
      currency: input.currency,
      quantity: input.quantity ?? 0,
      costBasis: input.cost_basis,
      lastPrice: input.last_price,
      notes: input.notes,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });

    // Return the full asset for consistency with the old behavior
    const asset = await assetService.getAsset(input.asset_id);
    return JSON.stringify(asset);
  }

  if (input.action === 'update') {
    if (!input.holding_id) return JSON.stringify({ error: 'holding_id is required for update' });

    const result = await assetService.updateHolding(input.holding_id, {
      quantity: input.quantity,
      costBasis: input.cost_basis,
      lastPrice: input.last_price,
      notes: input.notes,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });

    // Return the full asset for consistency with old behavior
    // The holding result contains the holding but old code returned full asset
    return JSON.stringify(result.holding);
  }

  if (input.action === 'delete') {
    if (!input.holding_id) return JSON.stringify({ error: 'holding_id is required for delete' });

    const result = await assetService.deleteHolding(input.holding_id);
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify({ success: true });
  }

  return JSON.stringify({ error: `Unknown action: ${input.action}` });
}

async function recordMovement(input: {
  asset_id: number;
  holding_id?: number;
  type: string;
  quantity: number;
  currency: string;
  price_per_unit?: number;
  source_amount?: number;
  source_currency?: string;
  date: string;
  notes?: string;
}): Promise<string> {
  const result = await assetService.createMovement(input.asset_id, {
    holdingId: input.holding_id,
    date: input.date,
    type: input.type,
    quantity: input.quantity,
    currency: input.currency,
    pricePerUnit: input.price_per_unit,
    sourceAmount: input.source_amount,
    sourceCurrency: input.source_currency,
    notes: input.notes,
  });

  if (!result.ok) return JSON.stringify({ error: result.error });

  const asset = await assetService.getAsset(input.asset_id);
  return JSON.stringify({ movement: result.movement, asset });
}

async function manageLiability(input: {
  action: string;
  name?: string; type?: string; currency?: string;
  original_amount?: number; current_balance?: number; interest_rate?: number;
  start_date?: string; notes?: string; liability_id?: number;
}): Promise<string> {
  if (input.action === 'create') {
    if (!input.name) return JSON.stringify({ error: 'name is required for create' });
    if (!input.type) return JSON.stringify({ error: 'type is required for create' });
    if (input.original_amount === undefined) return JSON.stringify({ error: 'original_amount is required for create' });
    if (input.current_balance === undefined) return JSON.stringify({ error: 'current_balance is required for create' });

    const result = await liabilityService.createLiability({
      name: input.name,
      type: input.type,
      currency: input.currency ?? 'ILS',
      originalAmount: input.original_amount,
      currentBalance: input.current_balance,
      interestRate: input.interest_rate,
      startDate: input.start_date,
      notes: input.notes,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify(result.liability);
  }

  if (input.action === 'update') {
    if (!input.liability_id) return JSON.stringify({ error: 'liability_id is required for update' });

    const result = await liabilityService.updateLiability(input.liability_id, {
      name: input.name,
      currentBalance: input.current_balance,
      interestRate: input.interest_rate,
      notes: input.notes,
    });
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify(result.liability);
  }

  if (input.action === 'deactivate') {
    if (!input.liability_id) return JSON.stringify({ error: 'liability_id is required for deactivate' });

    const result = await liabilityService.deactivateLiability(input.liability_id);
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify({ success: true, message: 'Liability deactivated' });
  }

  return JSON.stringify({ error: `Unknown action: ${input.action}` });
}

// ── Exported query functions for MCP server ─────────────────────────────────────

export { getNetWorth, getAssetDetails, getLiabilities, getNetWorthHistory };
export { manageAsset, manageHolding, recordMovement, manageLiability };
