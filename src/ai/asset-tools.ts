import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { db, sqlite } from '../db/connection.js';
import { assets, holdings, liabilities, assetMovements, assetSnapshots, accounts, accountBalanceHistory } from '../db/schema.js';
import { getExchangeRates, convertToIls } from '../services/exchange-rates.js';
import { todayInIsrael } from '../shared/dates.js';
import {
  ASSET_TYPES, LIQUIDITY_TYPES, HOLDING_TYPES, MOVEMENT_TYPES, LIABILITY_TYPES,
  getAssetCategory, CATEGORY_MOVEMENT_TYPES,
} from '../shared/types.js';
import {
  buildAssetResponse, batchMovementAggregates,
  generateAssetSnapshot, replayMovementSnapshots,
  computeHoldingUpdate,
} from '../api/assets.routes.js';
import { generateDatePoints } from '../api/net-worth.routes.js';

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
  const { rates } = await getExchangeRates();

  // Banks
  const bankRows = db.select()
    .from(accounts)
    .where(and(eq(accounts.accountType, 'bank'), eq(accounts.isActive, true)))
    .all();
  const banks = bankRows.map(b => ({
    id: b.id, name: b.displayName, balance: b.balance ?? 0, balanceIls: b.balance ?? 0,
  }));
  const banksTotal = banks.reduce((sum, b) => sum + b.balanceIls, 0);

  // Assets
  const assetRows = db.select().from(assets).where(eq(assets.isActive, true)).all();
  const aggMap = batchMovementAggregates(assetRows.map(r => r.id));
  let assetsTotal = 0;
  let liquidAssetsTotal = 0;

  const assetsResult = assetRows.map(asset => {
    const resp = buildAssetResponse(asset, rates, aggMap);
    assetsTotal += resp.totalValueIls;
    if (asset.liquidity === 'liquid') liquidAssetsTotal += resp.totalValueIls;
    return {
      id: resp.id, name: resp.name, type: resp.type, currency: resp.currency,
      liquidity: resp.liquidity, totalValueIls: resp.totalValueIls,
      totalInvestedIls: resp.totalInvestedIls, totalReturnIls: resp.totalReturnIls,
    };
  });

  // Liabilities
  const liabilityRows = db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
  const liabilitiesResult = liabilityRows.map(l => ({
    id: l.id, name: l.name, type: l.type,
    currentBalance: l.currentBalance,
    currentBalanceIls: convertToIls(l.currentBalance, l.currency, rates),
  }));
  const liabilitiesTotal = liabilitiesResult.reduce((sum, l) => sum + l.currentBalanceIls, 0);

  const total = banksTotal + assetsTotal - liabilitiesTotal;
  const liquidTotal = banksTotal + liquidAssetsTotal - liabilitiesTotal;

  return JSON.stringify({
    total, liquidTotal,
    banks, banksTotal,
    assets: assetsResult, assetsTotal,
    liabilities: liabilitiesResult, liabilitiesTotal,
  });
}

async function getAssetDetails(input: {
  asset_id?: number;
  asset_name?: string;
  include_movements?: boolean;
  include_snapshots?: boolean;
}): Promise<string> {
  let assetRow: typeof assets.$inferSelect | undefined;

  if (input.asset_id) {
    assetRow = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
  } else if (input.asset_name) {
    // Fuzzy name search: case-insensitive LIKE
    const allAssets = db.select().from(assets).where(eq(assets.isActive, true)).all();
    const needle = input.asset_name.toLowerCase();
    assetRow = allAssets.find(a => a.name.toLowerCase() === needle)
      ?? allAssets.find(a => a.name.toLowerCase().includes(needle));

    if (!assetRow) {
      const matches = allAssets
        .filter(a => a.name.toLowerCase().includes(needle) || needle.includes(a.name.toLowerCase()))
        .map(a => ({ id: a.id, name: a.name, type: a.type }));
      if (matches.length > 0) {
        return JSON.stringify({ error: 'Multiple matches found', matches });
      }
      return JSON.stringify({ error: `No asset found matching "${input.asset_name}"`, available: allAssets.map(a => ({ id: a.id, name: a.name, type: a.type })) });
    }
  } else {
    return JSON.stringify({ error: 'Provide either asset_id or asset_name' });
  }

  if (!assetRow) return JSON.stringify({ error: 'Asset not found' });

  const { rates } = await getExchangeRates();
  const result: Record<string, unknown> = buildAssetResponse(assetRow, rates);

  if (input.include_movements) {
    const movements = db.select({
      id: assetMovements.id,
      holdingId: assetMovements.holdingId,
      holdingName: holdings.name,
      date: assetMovements.date,
      type: assetMovements.type,
      quantity: assetMovements.quantity,
      currency: assetMovements.currency,
      pricePerUnit: assetMovements.pricePerUnit,
      sourceAmount: assetMovements.sourceAmount,
      sourceCurrency: assetMovements.sourceCurrency,
      notes: assetMovements.notes,
    })
      .from(assetMovements)
      .leftJoin(holdings, eq(assetMovements.holdingId, holdings.id))
      .where(eq(assetMovements.assetId, assetRow.id))
      .orderBy(desc(assetMovements.date), desc(assetMovements.id))
      .limit(50)
      .all();
    result.movements = movements;
  }

  if (input.include_snapshots) {
    const endDate = todayInIsrael();
    const startDate = (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    })();

    const snapshots = db.select({
      date: assetSnapshots.date,
      totalValue: assetSnapshots.totalValue,
      totalValueIls: assetSnapshots.totalValueIls,
    }).from(assetSnapshots)
      .where(and(
        eq(assetSnapshots.assetId, assetRow.id),
        gte(assetSnapshots.date, startDate),
        lte(assetSnapshots.date, endDate),
      ))
      .orderBy(assetSnapshots.date)
      .all();
    result.snapshots = snapshots;
  }

  return JSON.stringify(result);
}

async function getLiabilities(input: { include_inactive?: boolean }): Promise<string> {
  const { rates } = await getExchangeRates();

  const rows = input.include_inactive
    ? db.select().from(liabilities).all()
    : db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();

  const result = rows.map(row => ({
    ...row,
    currentBalanceIls: convertToIls(row.currentBalance, row.currency, rates),
  }));

  return JSON.stringify({ liabilities: result });
}

async function getNetWorthHistory(input: {
  start_date?: string;
  end_date?: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
}): Promise<string> {
  const today = todayInIsrael();
  const endDate = input.end_date ?? today;
  const startDate = input.start_date ?? (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  })();
  const granularity = input.granularity ?? 'monthly';

  const datePoints = generateDatePoints(startDate, endDate, granularity);
  if (datePoints.length === 0 || datePoints.length > 1000) {
    return JSON.stringify({ error: datePoints.length === 0 ? 'No date points in range' : 'Date range too large (max 1000 points)' });
  }

  const bankAccounts = db.select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.accountType, 'bank'), eq(accounts.isActive, true)))
    .all();

  const activeAssets = db.select({ id: assets.id, liquidity: assets.liquidity })
    .from(assets)
    .where(eq(assets.isActive, true))
    .all();
  const lockedAssetIds = new Set(activeAssets.filter(a => a.liquidity === 'locked').map(a => a.id));

  const liabilityRows = db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
  const { rates } = await getExchangeRates();

  const lastDate = datePoints[datePoints.length - 1];

  const allBalanceHistory = db.select({
    accountId: accountBalanceHistory.accountId,
    date: accountBalanceHistory.date,
    balance: accountBalanceHistory.balance,
  })
    .from(accountBalanceHistory)
    .where(lte(accountBalanceHistory.date, lastDate))
    .orderBy(accountBalanceHistory.accountId, accountBalanceHistory.date)
    .all();

  const allSnapshots = db.select({
    assetId: assetSnapshots.assetId,
    date: assetSnapshots.date,
    totalValueIls: assetSnapshots.totalValueIls,
  })
    .from(assetSnapshots)
    .orderBy(assetSnapshots.assetId, assetSnapshots.date)
    .all();

  const balanceByAccount = new Map<number, { date: string; balance: number }[]>();
  for (const row of allBalanceHistory) {
    let arr = balanceByAccount.get(row.accountId);
    if (!arr) { arr = []; balanceByAccount.set(row.accountId, arr); }
    arr.push({ date: row.date, balance: row.balance });
  }

  const snapshotByAsset = new Map<number, { date: string; totalValueIls: number }[]>();
  for (const row of allSnapshots) {
    let arr = snapshotByAsset.get(row.assetId);
    if (!arr) { arr = []; snapshotByAsset.set(row.assetId, arr); }
    arr.push({ date: row.date, totalValueIls: row.totalValueIls });
  }

  const series: { date: string; total: number; liquidTotal: number; banks: number; assets: number; liabilities: number }[] = [];

  for (const date of datePoints) {
    let banksValue = 0;
    for (const bank of bankAccounts) {
      const entries = balanceByAccount.get(bank.id);
      if (entries) {
        const entry = entries.findLast(e => e.date <= date);
        if (entry) banksValue += entry.balance;
      }
    }

    let assetsValue = 0;
    let liquidAssetsValue = 0;
    for (const asset of activeAssets) {
      const entries = snapshotByAsset.get(asset.id);
      if (entries && entries.length > 0) {
        const entry = entries.findLast(e => e.date <= date);
        const val = (entry ?? entries[0]).totalValueIls;
        assetsValue += val;
        if (!lockedAssetIds.has(asset.id)) liquidAssetsValue += val;
      }
    }

    let liabilitiesValue = 0;
    for (const l of liabilityRows) {
      if (l.startDate && l.startDate > date) continue;
      liabilitiesValue += convertToIls(l.currentBalance, l.currency, rates);
    }

    const total = banksValue + assetsValue - liabilitiesValue;
    const liquidTotal = banksValue + liquidAssetsValue - liabilitiesValue;
    series.push({ date, total, liquidTotal, banks: banksValue, assets: assetsValue, liabilities: liabilitiesValue });
  }

  return JSON.stringify({ series });
}

// ── Write functions ─────────────────────────────────────────────────────────────

async function manageAsset(input: {
  action: string;
  name?: string; type?: string; institution?: string; currency?: string;
  liquidity?: string; initial_value?: number; initial_cost_basis?: number;
  notes?: string; asset_id?: number; current_value?: number;
  contribution?: number; date?: string; amount?: number;
}): Promise<string> {
  const { rates } = await getExchangeRates();

  if (input.action === 'create') {
    if (!input.name) return JSON.stringify({ error: 'name is required for create' });
    if (!input.type) return JSON.stringify({ error: 'type is required for create' });

    const existing = db.select({ id: assets.id }).from(assets).where(eq(assets.name, input.name)).get();
    if (existing) return JSON.stringify({ error: 'Asset name already exists' });

    const result = db.insert(assets).values({
      name: input.name,
      type: input.type,
      currency: input.currency ?? 'ILS',
      institution: input.institution,
      liquidity: (input.liquidity as 'liquid' | 'restricted' | 'locked') ?? 'liquid',
      notes: input.notes,
    }).returning().get();

    const category = getAssetCategory(input.type);
    if (category !== 'brokerage' && category !== 'crypto') {
      db.insert(holdings).values({
        assetId: result.id,
        name: input.name,
        type: 'balance',
        currency: input.currency ?? 'ILS',
        quantity: input.initial_value ?? 0,
        costBasis: input.initial_cost_basis ?? 0,
      }).run();
    }

    if (input.initial_value && input.initial_value > 0) {
      try { await generateAssetSnapshot(result.id); } catch (err) {
        console.error('[asset-tools] Failed to generate snapshot after asset creation:', err);
      }
    }

    return JSON.stringify(buildAssetResponse(result, rates));
  }

  if (input.action === 'update') {
    if (!input.asset_id) return JSON.stringify({ error: 'asset_id is required for update' });

    const existing = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
    if (!existing) return JSON.stringify({ error: 'Asset not found' });

    if (input.name && input.name !== existing.name) {
      const dup = db.select({ id: assets.id }).from(assets).where(eq(assets.name, input.name)).get();
      if (dup) return JSON.stringify({ error: 'Asset name already exists' });
    }

    const updateSet: Record<string, unknown> = {};
    if (input.name !== undefined) updateSet.name = input.name;
    if (input.institution !== undefined) updateSet.institution = input.institution;
    if (input.liquidity !== undefined) updateSet.liquidity = input.liquidity;
    if (input.notes !== undefined) updateSet.notes = input.notes;

    if (Object.keys(updateSet).length > 0) {
      db.update(assets).set(updateSet).where(eq(assets.id, input.asset_id)).run();
    }

    const updated = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
    if (!updated) return JSON.stringify({ error: 'Asset not found after update' });
    return JSON.stringify(buildAssetResponse(updated, rates));
  }

  if (input.action === 'update_value') {
    if (!input.asset_id) return JSON.stringify({ error: 'asset_id is required for update_value' });
    if (input.current_value === undefined) return JSON.stringify({ error: 'current_value is required for update_value' });

    const assetRow = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
    if (!assetRow) return JSON.stringify({ error: 'Asset not found' });

    const category = getAssetCategory(assetRow.type);
    if (category === 'brokerage') return JSON.stringify({ error: 'Use record_movement for brokerage assets' });

    const holding = db.select().from(holdings)
      .where(and(eq(holdings.assetId, input.asset_id), eq(holdings.type, 'balance')))
      .get();
    if (!holding) return JSON.stringify({ error: 'No balance holding found' });

    const today = input.date ?? todayInIsrael();
    const now = new Date().toISOString();

    sqlite.transaction(() => {
      const updateSet: Record<string, unknown> = { quantity: input.current_value, updatedAt: now };

      if (input.contribution && input.contribution > 0) {
        updateSet.costBasis = holding.costBasis + input.contribution;
        db.insert(assetMovements).values({
          assetId: input.asset_id!,
          holdingId: holding.id,
          date: today,
          type: 'contribution',
          quantity: input.contribution,
          currency: holding.currency,
          notes: input.notes,
          createdAt: now,
        }).run();
      }

      db.update(holdings).set(updateSet).where(eq(holdings.id, holding.id)).run();
    })();

    try { await generateAssetSnapshot(input.asset_id); } catch (err) {
      console.error('[asset-tools] Failed to generate snapshot after value update:', err);
    }

    const refreshed = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
    if (!refreshed) return JSON.stringify({ error: 'Asset not found after update' });
    return JSON.stringify(buildAssetResponse(refreshed, rates));
  }

  if (input.action === 'record_rent') {
    if (!input.asset_id) return JSON.stringify({ error: 'asset_id is required for record_rent' });
    if (!input.amount || input.amount <= 0) return JSON.stringify({ error: 'amount must be positive for record_rent' });

    const assetRow = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
    if (!assetRow) return JSON.stringify({ error: 'Asset not found' });

    if (getAssetCategory(assetRow.type) !== 'real_estate') {
      return JSON.stringify({ error: 'Rent income only applies to real estate assets' });
    }

    const holding = db.select().from(holdings)
      .where(and(eq(holdings.assetId, input.asset_id), eq(holdings.type, 'balance')))
      .get();
    if (!holding) return JSON.stringify({ error: 'No balance holding found' });

    const today = input.date ?? todayInIsrael();
    const rentAmountIls = convertToIls(input.amount, assetRow.currency, rates);

    db.insert(assetMovements).values({
      assetId: input.asset_id,
      holdingId: holding.id,
      date: today,
      type: 'rent_income',
      quantity: input.amount,
      currency: assetRow.currency,
      sourceAmount: rentAmountIls,
      sourceCurrency: 'ILS',
      notes: input.notes,
      createdAt: new Date().toISOString(),
    }).run();

    try { await generateAssetSnapshot(input.asset_id); } catch (err) {
      console.error('[asset-tools] Failed to generate snapshot after rent recording:', err);
    }

    const refreshed = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
    if (!refreshed) return JSON.stringify({ error: 'Asset not found after update' });
    return JSON.stringify({ success: true, asset: buildAssetResponse(refreshed, rates) });
  }

  return JSON.stringify({ error: `Unknown action: ${input.action}` });
}

async function manageHolding(input: {
  action: string;
  asset_id?: number; name?: string; type?: string; currency?: string;
  quantity?: number; cost_basis?: number; last_price?: number; notes?: string;
  holding_id?: number;
}): Promise<string> {
  const { rates } = await getExchangeRates();

  if (input.action === 'create') {
    if (!input.asset_id) return JSON.stringify({ error: 'asset_id is required for create' });
    if (!input.name) return JSON.stringify({ error: 'name is required for create' });
    if (!input.type) return JSON.stringify({ error: 'type is required for create' });
    if (!input.currency) return JSON.stringify({ error: 'currency is required for create' });

    const asset = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
    if (!asset) return JSON.stringify({ error: 'Asset not found' });

    // Double-counting guard
    if (asset.linkedAccountId && input.currency === 'ILS' && input.type === 'cash') {
      return JSON.stringify({ error: 'ILS cash for this institution is already tracked via the linked bank account' });
    }

    const dup = db.select({ id: holdings.id }).from(holdings)
      .where(and(eq(holdings.assetId, input.asset_id), eq(holdings.name, input.name))).get();
    if (dup) return JSON.stringify({ error: 'Holding with this name already exists for this asset' });

    db.insert(holdings).values({
      assetId: input.asset_id,
      name: input.name,
      type: input.type as typeof HOLDING_TYPES[number],
      currency: input.currency,
      quantity: input.quantity ?? 0,
      costBasis: input.cost_basis ?? 0,
      lastPrice: input.last_price,
      notes: input.notes,
    }).run();

    try { await generateAssetSnapshot(input.asset_id); } catch (err) {
      console.error('[asset-tools] Failed to generate snapshot after holding creation:', err);
    }

    const refreshed = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
    if (!refreshed) return JSON.stringify({ error: 'Asset not found after update' });
    return JSON.stringify(buildAssetResponse(refreshed, rates));
  }

  if (input.action === 'update') {
    if (!input.holding_id) return JSON.stringify({ error: 'holding_id is required for update' });

    const holding = db.select().from(holdings).where(eq(holdings.id, input.holding_id)).get();
    if (!holding) return JSON.stringify({ error: 'Holding not found' });

    const updateSet: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (input.quantity !== undefined) updateSet.quantity = input.quantity;
    if (input.cost_basis !== undefined) updateSet.costBasis = input.cost_basis;
    if (input.last_price !== undefined) updateSet.lastPrice = input.last_price;
    if (input.notes !== undefined) updateSet.notes = input.notes;

    db.update(holdings).set(updateSet).where(eq(holdings.id, input.holding_id)).run();

    try { await generateAssetSnapshot(holding.assetId); } catch (err) {
      console.error('[asset-tools] Failed to generate snapshot after holding update:', err);
    }

    const asset = db.select().from(assets).where(eq(assets.id, holding.assetId)).get();
    if (!asset) return JSON.stringify({ error: 'Asset not found' });
    return JSON.stringify(buildAssetResponse(asset, rates));
  }

  if (input.action === 'delete') {
    if (!input.holding_id) return JSON.stringify({ error: 'holding_id is required for delete' });

    const holding = db.select().from(holdings).where(eq(holdings.id, input.holding_id)).get();
    if (!holding) return JSON.stringify({ error: 'Holding not found' });

    const assetId = holding.assetId;
    db.delete(holdings).where(eq(holdings.id, input.holding_id)).run();

    try { await generateAssetSnapshot(assetId); } catch (err) {
      console.error('[asset-tools] Failed to generate snapshot after holding deletion:', err);
    }

    const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) return JSON.stringify({ error: 'Asset not found' });
    return JSON.stringify(buildAssetResponse(asset, rates));
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
  const asset = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
  if (!asset) return JSON.stringify({ error: 'Asset not found' });

  // Gate movement types by asset category
  const category = getAssetCategory(asset.type);
  const allowedTypes = CATEGORY_MOVEMENT_TYPES[category];
  if (!allowedTypes.includes(input.type as typeof MOVEMENT_TYPES[number])) {
    return JSON.stringify({
      error: `Movement type "${input.type}" is not allowed for ${asset.type} assets. Allowed: ${allowedTypes.join(', ')}`,
    });
  }

  // Validate holding
  let holding: typeof holdings.$inferSelect | undefined;
  if (input.holding_id) {
    holding = db.select().from(holdings)
      .where(and(eq(holdings.id, input.holding_id), eq(holdings.assetId, input.asset_id))).get();
    if (!holding) return JSON.stringify({ error: 'Holding not found or does not belong to this asset' });
  }

  // Validate quantity sign
  const { type, quantity } = input;
  if ((type === 'deposit' || type === 'buy' || type === 'dividend' || type === 'contribution' || type === 'rent_income') && quantity <= 0) {
    return JSON.stringify({ error: `Quantity must be positive for ${type}` });
  }
  if ((type === 'withdrawal' || type === 'sell' || type === 'fee') && quantity >= 0) {
    return JSON.stringify({ error: `Quantity must be negative for ${type}` });
  }

  // Require pricePerUnit for buy/sell on stock/etf/crypto
  if ((type === 'buy' || type === 'sell') && holding) {
    if ((holding.type === 'stock' || holding.type === 'etf' || holding.type === 'crypto') && !input.price_per_unit) {
      return JSON.stringify({ error: `price_per_unit is required for ${type} on ${holding.type} holdings` });
    }
  }

  // Sell/withdraw validation
  if ((type === 'sell' || type === 'withdrawal') && holding) {
    if (Math.abs(quantity) > holding.quantity) {
      return JSON.stringify({ error: `Cannot ${type} more than current holding quantity (${holding.quantity})` });
    }
  }

  const needsSnapshot = type !== 'dividend';

  const created = sqlite.transaction(() => {
    const movement = db.insert(assetMovements).values({
      assetId: input.asset_id,
      holdingId: input.holding_id,
      date: input.date,
      type: input.type,
      quantity: input.quantity,
      currency: input.currency,
      pricePerUnit: input.price_per_unit,
      sourceAmount: input.source_amount,
      sourceCurrency: input.source_currency,
      notes: input.notes,
    }).returning().get();

    if (holding) {
      const updated = computeHoldingUpdate(holding, type, quantity, input.price_per_unit, input.source_amount);

      if (updated.quantity !== holding.quantity || updated.costBasis !== holding.costBasis) {
        db.update(holdings).set({
          quantity: updated.quantity,
          costBasis: updated.costBasis,
          updatedAt: new Date().toISOString(),
        }).where(eq(holdings.id, holding.id)).run();
      }
    }

    return movement;
  })();

  if (needsSnapshot) {
    try { await generateAssetSnapshot(input.asset_id); } catch (err) {
      console.error('[asset-tools] Failed to generate snapshot after movement:', err);
    }
    try { await replayMovementSnapshots(input.asset_id); } catch (err) {
      console.error('[asset-tools] Failed to replay movement snapshots:', err);
    }
  }

  const { rates } = await getExchangeRates();
  const refreshedAsset = db.select().from(assets).where(eq(assets.id, input.asset_id)).get();
  if (!refreshedAsset) return JSON.stringify({ error: 'Asset not found after movement' });

  return JSON.stringify({ movement: created, asset: buildAssetResponse(refreshedAsset, rates) });
}

async function manageLiability(input: {
  action: string;
  name?: string; type?: string; currency?: string;
  original_amount?: number; current_balance?: number; interest_rate?: number;
  start_date?: string; notes?: string; liability_id?: number;
}): Promise<string> {
  const { rates } = await getExchangeRates();

  if (input.action === 'create') {
    if (!input.name) return JSON.stringify({ error: 'name is required for create' });
    if (!input.type) return JSON.stringify({ error: 'type is required for create' });
    if (input.original_amount === undefined) return JSON.stringify({ error: 'original_amount is required for create' });
    if (input.current_balance === undefined) return JSON.stringify({ error: 'current_balance is required for create' });

    const existing = db.select({ id: liabilities.id }).from(liabilities)
      .where(eq(liabilities.name, input.name)).get();
    if (existing) return JSON.stringify({ error: 'Liability name already exists' });

    const result = db.insert(liabilities).values({
      name: input.name,
      type: input.type as typeof LIABILITY_TYPES[number],
      currency: input.currency ?? 'ILS',
      originalAmount: input.original_amount,
      currentBalance: input.current_balance,
      interestRate: input.interest_rate,
      startDate: input.start_date,
      notes: input.notes,
    }).returning().get();

    return JSON.stringify({
      ...result,
      currentBalanceIls: convertToIls(result.currentBalance, result.currency, rates),
    });
  }

  if (input.action === 'update') {
    if (!input.liability_id) return JSON.stringify({ error: 'liability_id is required for update' });

    const existing = db.select().from(liabilities).where(eq(liabilities.id, input.liability_id)).get();
    if (!existing) return JSON.stringify({ error: 'Liability not found' });

    if (input.name && input.name !== existing.name) {
      const dup = db.select({ id: liabilities.id }).from(liabilities)
        .where(eq(liabilities.name, input.name)).get();
      if (dup) return JSON.stringify({ error: 'Liability name already exists' });
    }

    const updateSet: Record<string, unknown> = {};
    if (input.name !== undefined) updateSet.name = input.name;
    if (input.current_balance !== undefined) updateSet.currentBalance = input.current_balance;
    if (input.interest_rate !== undefined) updateSet.interestRate = input.interest_rate;
    if (input.notes !== undefined) updateSet.notes = input.notes;

    if (Object.keys(updateSet).length > 0) {
      db.update(liabilities).set(updateSet).where(eq(liabilities.id, input.liability_id)).run();
    }

    const updated = db.select().from(liabilities).where(eq(liabilities.id, input.liability_id)).get();
    if (!updated) return JSON.stringify({ error: 'Liability not found after update' });
    return JSON.stringify({
      ...updated,
      currentBalanceIls: convertToIls(updated.currentBalance, updated.currency, rates),
    });
  }

  if (input.action === 'deactivate') {
    if (!input.liability_id) return JSON.stringify({ error: 'liability_id is required for deactivate' });

    const existing = db.select({ id: liabilities.id }).from(liabilities)
      .where(eq(liabilities.id, input.liability_id)).get();
    if (!existing) return JSON.stringify({ error: 'Liability not found' });

    db.update(liabilities).set({ isActive: false }).where(eq(liabilities.id, input.liability_id)).run();
    return JSON.stringify({ success: true, message: 'Liability deactivated' });
  }

  return JSON.stringify({ error: `Unknown action: ${input.action}` });
}

// ── Exported query functions for MCP server ─────────────────────────────────────

export { getNetWorth, getAssetDetails, getLiabilities, getNetWorthHistory };
export { manageAsset, manageHolding, recordMovement, manageLiability };
