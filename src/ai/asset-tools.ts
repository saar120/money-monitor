import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import {
  ASSET_TYPES, LIQUIDITY_TYPES, HOLDING_TYPES, MOVEMENT_TYPES, LIABILITY_TYPES,
} from '../shared/types.js';
import * as assetService from '../services/assets.js';
import * as liabilityService from '../services/liabilities.js';
import * as netWorthService from '../services/net-worth.js';
import { createAgentTool } from './tool-adapter.js';

// ── Read tool builders ──────────────────────────────────────────────────────────

export function buildGetNetWorthTool() {
  return createAgentTool({
    name: 'get_net_worth',
    description: 'Get a complete net worth summary: bank balances, investment assets, liabilities, and totals. Use this when the user asks about their overall financial picture, net worth, or total assets.',
    label: 'Calculating net worth',
    parameters: Type.Object({}),
    execute: async () => getNetWorth(),
  });
}

export function buildGetAssetDetailsTool() {
  return createAgentTool({
    name: 'get_asset_details',
    description: 'Get detailed information about a specific asset including holdings, P&L, and optionally movements and value history. Search by name (fuzzy match) or ID.',
    label: 'Looking up asset details',
    parameters: Type.Object({
      asset_id: Type.Optional(Type.Number({ description: 'Asset ID (use this if you know the exact ID)' })),
      asset_name: Type.Optional(Type.String({ description: 'Asset name to search for (case-insensitive fuzzy match)' })),
      include_movements: Type.Optional(Type.Boolean({ description: 'Include recent movements/transactions (default false)' })),
      include_snapshots: Type.Optional(Type.Boolean({ description: 'Include value history snapshots (default false)' })),
    }),
    execute: async (args) => getAssetDetails(args),
  });
}

export function buildGetLiabilitiesTool() {
  return createAgentTool({
    name: 'get_liabilities',
    description: 'List all liabilities (loans, mortgages, credit lines) with current balances in ILS.',
    label: 'Checking liabilities',
    parameters: Type.Object({
      include_inactive: Type.Optional(Type.Boolean({ description: 'Include deactivated liabilities (default false)' })),
    }),
    execute: async (args) => getLiabilities(args),
  });
}

export function buildGetNetWorthHistoryTool() {
  return createAgentTool({
    name: 'get_net_worth_history',
    description: 'Get historical net worth trends over time with breakdown by banks, assets, and liabilities. Use this when the user asks how their net worth has changed.',
    label: 'Loading net worth history',
    parameters: Type.Object({
      start_date: Type.Optional(Type.String({ description: 'Start date (ISO, e.g. "2025-01-01"). Defaults to 1 year ago.' })),
      end_date: Type.Optional(Type.String({ description: 'End date (ISO, e.g. "2026-03-01"). Defaults to today.' })),
      granularity: Type.Optional(StringEnum(['daily', 'weekly', 'monthly'], { description: 'Data point frequency (default: monthly)' })),
    }),
    execute: async (args) => getNetWorthHistory(args as Parameters<typeof getNetWorthHistory>[0]),
  });
}

// ── Write tool builders ─────────────────────────────────────────────────────────

export function buildManageAssetTool() {
  return createAgentTool({
    name: 'manage_asset',
    description: `Create, update, or modify assets. Actions:
- "create": Create a new asset (pension, fund, keren_hishtalmut, real_estate, crypto, brokerage)
- "update": Update asset metadata (name, institution, liquidity, notes)
- "update_value": Update the current value of a simple_value or real_estate asset (optionally record a contribution)
- "record_rent": Record rent income for a real_estate asset
Before calling, confirm the details with the user if there is any ambiguity.`,
    label: 'Updating asset',
    parameters: Type.Object({
      action: StringEnum(['create', 'update', 'update_value', 'record_rent'], { description: 'The action to perform' }),
      // For create
      name: Type.Optional(Type.String({ description: 'Asset name (required for create)' })),
      type: Type.Optional(StringEnum(ASSET_TYPES as unknown as string[], { description: 'Asset type (required for create)' })),
      institution: Type.Optional(Type.String({ description: 'Financial institution name' })),
      currency: Type.Optional(Type.String({ description: 'Currency code (default: ILS)' })),
      liquidity: Type.Optional(StringEnum(LIQUIDITY_TYPES as unknown as string[], { description: 'Liquidity level' })),
      initial_value: Type.Optional(Type.Number({ description: 'Initial value for create' })),
      initial_cost_basis: Type.Optional(Type.Number({ description: 'Initial cost basis for create' })),
      notes: Type.Optional(Type.String({ description: 'Notes' })),
      // For update, update_value, record_rent
      asset_id: Type.Optional(Type.Number({ description: 'Asset ID (required for update/update_value/record_rent)' })),
      // For update_value
      current_value: Type.Optional(Type.Number({ description: 'New current value (required for update_value)' })),
      contribution: Type.Optional(Type.Number({ description: 'Contribution amount to add to cost basis' })),
      date: Type.Optional(Type.String({ description: 'Date (ISO, defaults to today)' })),
      // For record_rent
      amount: Type.Optional(Type.Number({ description: 'Rent amount (required for record_rent)' })),
    }),
    execute: async (args) => manageAsset(args),
  });
}

export function buildManageHoldingTool() {
  return createAgentTool({
    name: 'manage_holding',
    description: `Create, update, or delete individual holdings within an asset (stocks, ETFs, crypto coins, cash positions).
- "create": Add a new holding to an asset
- "update": Update holding quantity, cost basis, or price
- "delete": Remove a holding from an asset
Before calling, confirm the details with the user if there is any ambiguity.`,
    label: 'Updating holding',
    parameters: Type.Object({
      action: StringEnum(['create', 'update', 'delete'], { description: 'The action to perform' }),
      // For create
      asset_id: Type.Optional(Type.Number({ description: 'Asset ID (required for create)' })),
      name: Type.Optional(Type.String({ description: 'Holding name, e.g. "AAPL", "BTC" (required for create)' })),
      type: Type.Optional(StringEnum(HOLDING_TYPES as unknown as string[], { description: 'Holding type (required for create)' })),
      currency: Type.Optional(Type.String({ description: 'Currency code (required for create)' })),
      quantity: Type.Optional(Type.Number({ description: 'Quantity/amount' })),
      cost_basis: Type.Optional(Type.Number({ description: 'Total cost basis' })),
      last_price: Type.Optional(Type.Number({ description: 'Last known price per unit' })),
      notes: Type.Optional(Type.String({ description: 'Notes' })),
      // For update/delete
      holding_id: Type.Optional(Type.Number({ description: 'Holding ID (required for update/delete)' })),
    }),
    execute: async (args) => manageHolding(args),
  });
}

export function buildRecordMovementTool() {
  return createAgentTool({
    name: 'record_movement',
    description: `Record a financial movement (buy, sell, deposit, withdrawal, dividend) on a brokerage or crypto asset.
Movement types by asset category:
- Brokerage: deposit, withdrawal, buy, sell, dividend
- Crypto: buy, sell
- Simple value (pension/fund/kh): contribution (use manage_asset update_value instead)
- Real estate: rent_income (use manage_asset record_rent instead)
Before calling, confirm the details with the user. Quantity must be positive for buy/deposit/dividend, negative for sell/withdrawal.`,
    label: 'Recording movement',
    parameters: Type.Object({
      asset_id: Type.Number({ description: 'Asset ID' }),
      holding_id: Type.Optional(Type.Number({ description: 'Holding ID (required for buy/sell)' })),
      type: StringEnum(MOVEMENT_TYPES as unknown as string[], { description: 'Movement type' }),
      quantity: Type.Number({ description: 'Amount (positive for buy/deposit/dividend, negative for sell/withdrawal)' }),
      currency: Type.String({ description: 'Currency code' }),
      price_per_unit: Type.Optional(Type.Number({ description: 'Price per unit (required for buy/sell on stock/etf/crypto holdings)' })),
      source_amount: Type.Optional(Type.Number({ description: 'Amount in source currency (e.g. ILS amount for foreign currency deposits)' })),
      source_currency: Type.Optional(Type.String({ description: 'Source currency code (e.g. "ILS")' })),
      date: Type.String({ description: 'Date (ISO, e.g. "2026-03-07")' }),
      notes: Type.Optional(Type.String({ description: 'Notes' })),
    }),
    execute: async (args) => recordMovement(args),
  });
}

export function buildManageLiabilityTool() {
  return createAgentTool({
    name: 'manage_liability',
    description: `Create, update, or deactivate liabilities (loans, mortgages, credit lines).
- "create": Add a new liability
- "update": Update liability details (balance, interest rate, etc.)
- "deactivate": Mark a liability as inactive (paid off)
Before calling, confirm the details with the user if there is any ambiguity.`,
    label: 'Updating liability',
    parameters: Type.Object({
      action: StringEnum(['create', 'update', 'deactivate'], { description: 'The action to perform' }),
      // For create
      name: Type.Optional(Type.String({ description: 'Liability name (required for create)' })),
      type: Type.Optional(StringEnum(LIABILITY_TYPES as unknown as string[], { description: 'Liability type (required for create)' })),
      currency: Type.Optional(Type.String({ description: 'Currency code (default: ILS)' })),
      original_amount: Type.Optional(Type.Number({ description: 'Original loan amount (required for create)' })),
      current_balance: Type.Optional(Type.Number({ description: 'Current outstanding balance (required for create)' })),
      interest_rate: Type.Optional(Type.Number({ description: 'Annual interest rate (percentage)' })),
      start_date: Type.Optional(Type.String({ description: 'Start date (ISO)' })),
      notes: Type.Optional(Type.String({ description: 'Notes' })),
      // For update/deactivate
      liability_id: Type.Optional(Type.Number({ description: 'Liability ID (required for update/deactivate)' })),
    }),
    execute: async (args) => manageLiability(args),
  });
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

    const asset = await assetService.getAsset(input.asset_id);
    if (!asset) return JSON.stringify({ error: 'Asset not found after recording rent' });
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

    const asset = await assetService.getAsset(input.asset_id);
    if (!asset) return JSON.stringify({ error: 'Asset not found after creating holding' });
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
  if (!asset) return JSON.stringify({ error: 'Asset not found after recording movement' });
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
