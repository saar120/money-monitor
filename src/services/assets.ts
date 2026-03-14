import { eq, and, gte, lte, desc, asc, count, sql, inArray } from 'drizzle-orm';
import { db, sqlite } from '../db/connection.js';
import { assets, holdings, accounts, assetSnapshots, assetMovements } from '../db/schema.js';
import { getExchangeRates, convertToIls } from './exchange-rates.js';
import { todayInIsrael } from '../shared/dates.js';
import { getAssetCategory, CATEGORY_MOVEMENT_TYPES, holdingNeedsPrice } from '../shared/types.js';

// ── Types ──

export type HoldingRow = typeof holdings.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;

export interface MovementAggregates {
  depositIls: number;
  withdrawIls: number;
  rentTotal: number;
}

// ── Pure Computation ──

export function computeHoldingValues(h: HoldingRow, rates: Record<string, number>) {
  const needsPrice = holdingNeedsPrice(h.type, h.currency, rates);

  let currentValue: number;
  let stale: boolean;

  if (needsPrice) {
    if (h.lastPrice == null) { currentValue = 0; stale = true; }
    else { currentValue = h.quantity * h.lastPrice; stale = false; }
  } else {
    currentValue = h.quantity;
    stale = false;
  }

  const currentValueIls = convertToIls(currentValue, h.currency, rates);
  const gainLoss = currentValue - h.costBasis;
  const gainLossPercent = h.costBasis !== 0 ? (gainLoss / h.costBasis) * 100 : null;

  return {
    id: h.id, name: h.name, type: h.type, currency: h.currency,
    quantity: h.quantity, costBasis: h.costBasis,
    lastPrice: h.lastPrice, lastPriceDate: h.lastPriceDate,
    ticker: h.ticker,
    currentValue, currentValueIls, gainLoss, gainLossPercent,
    stale, notes: h.notes,
  };
}

export function computeHoldingUpdate(
  holding: { quantity: number; costBasis: number },
  type: string, quantity: number,
  pricePerUnit?: number | null, sourceAmount?: number | null,
): { quantity: number; costBasis: number } {
  let newQty = holding.quantity;
  let newCostBasis = holding.costBasis;

  if (type === 'buy') {
    newQty += quantity;
    newCostBasis += quantity * (pricePerUnit ?? 0);
  } else if (type === 'sell' || type === 'withdrawal') {
    if (holding.quantity > 0) {
      const proportion = Math.abs(quantity) / holding.quantity;
      newCostBasis -= holding.costBasis * proportion;
    }
    newQty += quantity;
  } else if (type === 'deposit') {
    newQty += quantity;
    newCostBasis += quantity;
  } else if (type === 'fee') {
    newCostBasis += Math.abs(sourceAmount ?? quantity);
  } else if (type === 'adjustment') {
    newQty += quantity;
  } else if (type === 'contribution') {
    newCostBasis += Math.abs(quantity);
  }

  return { quantity: newQty, costBasis: newCostBasis };
}

// ── Query Helpers ──

export function batchMovementAggregates(assetIds: number[]): Map<number, MovementAggregates> {
  if (assetIds.length === 0) return new Map();
  const rows = db.select({
    assetId: assetMovements.assetId,
    type: assetMovements.type,
    sourceTotal: sql<number>`COALESCE(SUM(COALESCE(${assetMovements.sourceAmount}, ${assetMovements.quantity})), 0)`,
    qtyTotal: sql<number>`COALESCE(SUM(${assetMovements.quantity}), 0)`,
  }).from(assetMovements)
    .where(and(
      inArray(assetMovements.assetId, assetIds),
      inArray(assetMovements.type, ['deposit', 'withdrawal', 'rent_income']),
    ))
    .groupBy(assetMovements.assetId, assetMovements.type)
    .all();

  const map = new Map<number, MovementAggregates>();
  for (const row of rows) {
    const entry = map.get(row.assetId) ?? { depositIls: 0, withdrawIls: 0, rentTotal: 0 };
    if (row.type === 'deposit') entry.depositIls = row.sourceTotal;
    else if (row.type === 'withdrawal') entry.withdrawIls = Math.abs(row.sourceTotal);
    else if (row.type === 'rent_income') entry.rentTotal = row.sourceTotal;
    map.set(row.assetId, entry);
  }
  return map;
}

export function buildAssetResponse(
  assetRow: AssetRow,
  rates: Record<string, number>,
  aggMap?: Map<number, MovementAggregates>,
) {
  const holdingRows = db.select().from(holdings).where(eq(holdings.assetId, assetRow.id)).all();
  const computedHoldings = holdingRows.map(h => computeHoldingValues(h, rates));
  const totalValueIls = computedHoldings.reduce((sum, h) => sum + h.currentValueIls, 0);

  let linkedAccountName: string | null = null;
  if (assetRow.linkedAccountId) {
    const acct = db.select({ displayName: accounts.displayName })
      .from(accounts).where(eq(accounts.id, assetRow.linkedAccountId)).get();
    linkedAccountName = acct?.displayName ?? null;
  }

  const category = getAssetCategory(assetRow.type);
  let totalInvestedIls: number | null = null;
  let totalRentEarned: number | null = null;

  const agg = aggMap?.get(assetRow.id) ?? (
    category === 'brokerage' || category === 'real_estate'
      ? batchMovementAggregates([assetRow.id]).get(assetRow.id) ?? { depositIls: 0, withdrawIls: 0, rentTotal: 0 }
      : { depositIls: 0, withdrawIls: 0, rentTotal: 0 }
  );

  if (category === 'brokerage') {
    totalInvestedIls = agg.depositIls > 0 ? agg.depositIls - agg.withdrawIls : null;
  } else if (category === 'simple_value' || category === 'real_estate') {
    const balanceHolding = computedHoldings.find(h => h.type === 'balance');
    totalInvestedIls = balanceHolding?.costBasis ?? null;
  } else if (category === 'crypto') {
    totalInvestedIls = computedHoldings.reduce((sum, h) => sum + h.costBasis, 0);
  }

  if (category === 'real_estate') {
    totalRentEarned = agg.rentTotal;
  }

  const totalReturnIls = totalInvestedIls != null
    ? totalValueIls + (totalRentEarned ?? 0) - totalInvestedIls
    : null;

  return {
    id: assetRow.id, name: assetRow.name, type: assetRow.type,
    currency: assetRow.currency, institution: assetRow.institution,
    liquidity: assetRow.liquidity, linkedAccountId: assetRow.linkedAccountId,
    linkedAccountName, isActive: assetRow.isActive, notes: assetRow.notes,
    holdings: computedHoldings, totalValueIls,
    totalInvestedIls, totalReturnIls, totalRentEarned,
  };
}

// ── Snapshot internals ──

async function generateAssetSnapshot(assetId: number): Promise<void> {
  const holdingRows = db.select().from(holdings).where(eq(holdings.assetId, assetId)).all();
  const { rates } = await getExchangeRates();

  let totalValueIls = 0;
  let totalValue = 0;
  const holdingsSnapshot = holdingRows.map(h => {
    const needsPrice = holdingNeedsPrice(h.type, h.currency, rates);
    const currentValue = needsPrice ? (h.lastPrice != null ? h.quantity * h.lastPrice : 0) : h.quantity;
    const valueIls = convertToIls(currentValue, h.currency, rates);
    totalValueIls += valueIls;
    totalValue += currentValue;
    return { name: h.name, quantity: h.quantity, currency: h.currency, price: h.lastPrice, value: currentValue, valueIls };
  });

  const today = todayInIsrael();
  const holdingsJson = JSON.stringify(holdingsSnapshot);
  const ratesJson = JSON.stringify(rates);

  db.insert(assetSnapshots).values({
    assetId, date: today, holdingsSnapshot: holdingsJson,
    totalValue, totalValueIls, exchangeRates: ratesJson,
  }).onConflictDoUpdate({
    target: [assetSnapshots.assetId, assetSnapshots.date],
    set: { holdingsSnapshot: holdingsJson, totalValue, totalValueIls, exchangeRates: ratesJson, createdAt: new Date().toISOString() },
  }).run();
}

async function replayMovementSnapshots(assetId: number, excludeMovementId?: number): Promise<void> {
  const { rates } = await getExchangeRates();

  let allMovements = db.select().from(assetMovements)
    .where(eq(assetMovements.assetId, assetId))
    .orderBy(asc(assetMovements.date), asc(assetMovements.id))
    .all();

  if (excludeMovementId) {
    allMovements = allMovements.filter(m => m.id !== excludeMovementId);
  }
  if (allMovements.length === 0) return;

  const holdingRows = db.select().from(holdings).where(eq(holdings.assetId, assetId)).all();
  const holdingMeta = new Map(holdingRows.map(h => [h.id, { name: h.name, type: h.type, currency: h.currency }]));
  const holdingState = new Map<number, { quantity: number; costBasis: number }>();

  const movementsByDate = new Map<string, typeof allMovements>();
  for (const m of allMovements) {
    if (!movementsByDate.has(m.date)) movementsByDate.set(m.date, []);
    movementsByDate.get(m.date)!.push(m);
  }

  const today = todayInIsrael();
  const snapshotDates = new Set<string>();

  for (const [date, dayMovements] of movementsByDate) {
    if (date === today) continue;

    for (const m of dayMovements) {
      if (!m.holdingId) continue;
      const state = holdingState.get(m.holdingId) ?? { quantity: 0, costBasis: 0 };
      holdingState.set(m.holdingId, computeHoldingUpdate(state, m.type, m.quantity, m.pricePerUnit, m.sourceAmount));
    }

    let totalValueIls = 0;
    let totalValue = 0;
    const holdingsSnapshotArr: { name: string; quantity: number; currency: string; price: number | null; value: number; valueIls: number }[] = [];

    for (const [holdingId, state] of holdingState) {
      if (state.quantity === 0) continue;
      const meta = holdingMeta.get(holdingId);
      if (!meta) continue;

      const needsPrice = holdingNeedsPrice(meta.type, meta.currency, rates);

      let ilsFromSource: number | null = null;
      for (const m of dayMovements) {
        if (m.holdingId === holdingId && m.sourceAmount != null && m.sourceCurrency?.toUpperCase() === 'ILS') {
          ilsFromSource = (ilsFromSource ?? 0) + Math.abs(m.sourceAmount);
        }
      }

      if (ilsFromSource != null) {
        let cumulativeIls = 0;
        for (const m of allMovements) {
          if (m.date > date) break;
          if (m.holdingId !== holdingId) continue;
          if (m.sourceAmount != null && m.sourceCurrency?.toUpperCase() === 'ILS') {
            if (m.type === 'sell' || m.type === 'withdrawal') cumulativeIls -= Math.abs(m.sourceAmount);
            else cumulativeIls += Math.abs(m.sourceAmount);
          } else {
            const currentValue = needsPrice ? m.quantity * (m.pricePerUnit ?? 0) : m.quantity;
            if (m.type === 'sell' || m.type === 'withdrawal') cumulativeIls -= Math.abs(convertToIls(currentValue, meta.currency, rates));
            else if (m.type !== 'dividend' && m.type !== 'fee') cumulativeIls += Math.abs(convertToIls(currentValue, meta.currency, rates));
          }
        }
        const nativeValue = needsPrice ? 0 : state.quantity;
        totalValueIls += Math.max(0, cumulativeIls);
        totalValue += nativeValue;
        holdingsSnapshotArr.push({ name: meta.name, quantity: state.quantity, currency: meta.currency, price: null, value: nativeValue, valueIls: Math.max(0, cumulativeIls) });
      } else {
        const currentValue = needsPrice ? 0 : state.quantity;
        const valueIls = convertToIls(currentValue, meta.currency, rates);
        totalValueIls += valueIls;
        totalValue += currentValue;
        holdingsSnapshotArr.push({ name: meta.name, quantity: state.quantity, currency: meta.currency, price: null, value: currentValue, valueIls });
      }
    }

    const holdingsJson = JSON.stringify(holdingsSnapshotArr);
    const ratesJson = JSON.stringify(rates);

    db.insert(assetSnapshots).values({
      assetId, date, holdingsSnapshot: holdingsJson, totalValue, totalValueIls, exchangeRates: ratesJson,
    }).onConflictDoUpdate({
      target: [assetSnapshots.assetId, assetSnapshots.date],
      set: { holdingsSnapshot: holdingsJson, totalValue, totalValueIls, exchangeRates: ratesJson, createdAt: new Date().toISOString() },
    }).run();
    snapshotDates.add(date);
  }

  if (excludeMovementId) {
    const activeDates = new Set(allMovements.map(m => m.date));
    const existingSnapshots = db.select({ id: assetSnapshots.id, date: assetSnapshots.date })
      .from(assetSnapshots).where(eq(assetSnapshots.assetId, assetId)).all();

    for (const snap of existingSnapshots) {
      if (snap.date === today || activeDates.has(snap.date) || snapshotDates.has(snap.date)) continue;
      const lastMovementDate = allMovements.length > 0 ? allMovements[allMovements.length - 1].date : '';
      if (snap.date > lastMovementDate) continue;
      db.delete(assetSnapshots).where(eq(assetSnapshots.id, snap.id)).run();
    }
  }
}

// ── Snapshot (public) ──

export async function generateAllAssetSnapshots(): Promise<void> {
  const allAssets = db.select({ id: assets.id }).from(assets).where(eq(assets.isActive, true)).all();
  for (const a of allAssets) {
    try {
      await generateAssetSnapshot(a.id);
    } catch (err) {
      console.error(`[assets] Snapshot error for asset ${a.id}:`, err);
    }
  }
}

// ── Reads ──

export function assetExists(id: number): boolean {
  return !!db.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).get();
}

export async function listAssets(opts: { includeInactive?: boolean } = {}) {
  const { rates } = await getExchangeRates();
  const rows = opts.includeInactive
    ? db.select().from(assets).all()
    : db.select().from(assets).where(eq(assets.isActive, true)).all();
  const aggMap = batchMovementAggregates(rows.map(r => r.id));
  return rows.map(row => buildAssetResponse(row, rates, aggMap));
}

export async function getAsset(id: number) {
  const row = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!row) return null;
  const { rates } = await getExchangeRates();
  return buildAssetResponse(row, rates);
}

export async function findAssetByName(name: string) {
  const exact = db.select().from(assets).where(and(eq(assets.name, name), eq(assets.isActive, true))).get();
  if (exact) {
    const { rates } = await getExchangeRates();
    return { asset: buildAssetResponse(exact, rates) };
  }
  const allAssets = db.select({ id: assets.id, name: assets.name, type: assets.type }).from(assets).where(eq(assets.isActive, true)).all();
  const lower = name.toLowerCase();
  const matches = allAssets.filter(a => a.name.toLowerCase().includes(lower));
  if (matches.length === 1) {
    const row = db.select().from(assets).where(eq(assets.id, matches[0].id)).get();
    if (!row) return { error: `Asset matching "${name}" was not found` };
    const { rates } = await getExchangeRates();
    return { asset: buildAssetResponse(row, rates) };
  }
  if (matches.length > 1) {
    return { error: `Multiple assets match "${name}"`, matches };
  }
  return { error: `No asset found matching "${name}"` };
}

export function getSnapshots(assetId: number, startDate?: string, endDate?: string) {
  const end = endDate ?? todayInIsrael();
  const start = startDate ?? (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  })();

  return db.select({
    date: assetSnapshots.date,
    totalValue: assetSnapshots.totalValue,
    totalValueIls: assetSnapshots.totalValueIls,
  }).from(assetSnapshots)
    .where(and(eq(assetSnapshots.assetId, assetId), gte(assetSnapshots.date, start), lte(assetSnapshots.date, end)))
    .orderBy(assetSnapshots.date)
    .all();
}

export function listMovements(assetId: number, filters: {
  holdingId?: number; type?: string; startDate?: string; endDate?: string;
  offset?: number; limit?: number;
}) {
  const conditions = [eq(assetMovements.assetId, assetId)];
  if (filters.holdingId) conditions.push(eq(assetMovements.holdingId, filters.holdingId));
  if (filters.type) conditions.push(eq(assetMovements.type, filters.type));
  if (filters.startDate) conditions.push(gte(assetMovements.date, filters.startDate));
  if (filters.endDate) conditions.push(lte(assetMovements.date, filters.endDate));

  const where = and(...conditions)!;
  const [totalRow] = db.select({ count: count() }).from(assetMovements).where(where).all();

  const rows = db.select({
    id: assetMovements.id, assetId: assetMovements.assetId,
    holdingId: assetMovements.holdingId, holdingName: holdings.name,
    date: assetMovements.date, type: assetMovements.type,
    quantity: assetMovements.quantity, currency: assetMovements.currency,
    pricePerUnit: assetMovements.pricePerUnit,
    sourceAmount: assetMovements.sourceAmount, sourceCurrency: assetMovements.sourceCurrency,
    notes: assetMovements.notes, createdAt: assetMovements.createdAt,
  }).from(assetMovements)
    .leftJoin(holdings, eq(assetMovements.holdingId, holdings.id))
    .where(where)
    .orderBy(desc(assetMovements.date), desc(assetMovements.id))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0)
    .all();

  return { movements: rows, total: totalRow.count };
}

// ── Writes ──

export async function createAsset(data: {
  name: string; type: string; currency: string;
  institution?: string; liquidity?: string;
  linkedAccountId?: number; notes?: string;
  initialValue?: number; initialCostBasis?: number;
}) {
  const existing = db.select({ id: assets.id }).from(assets).where(eq(assets.name, data.name)).get();
  if (existing) return { ok: false as const, error: 'Asset name already exists', status: 409 };

  if (data.linkedAccountId) {
    const acct = db.select({ id: accounts.id, accountType: accounts.accountType })
      .from(accounts).where(eq(accounts.id, data.linkedAccountId)).get();
    if (!acct) return { ok: false as const, error: 'Linked account not found', status: 400 };
    if (acct.accountType !== 'bank') return { ok: false as const, error: 'Linked account must be a bank account', status: 400 };
  }

  const result = db.insert(assets).values({
    name: data.name, type: data.type, currency: data.currency,
    institution: data.institution, liquidity: data.liquidity,
    linkedAccountId: data.linkedAccountId, notes: data.notes,
  }).returning().get();

  const category = getAssetCategory(data.type);
  if (category !== 'brokerage' && category !== 'crypto') {
    db.insert(holdings).values({
      assetId: result.id, name: data.name, type: 'balance',
      currency: data.currency, quantity: data.initialValue ?? 0,
      costBasis: data.initialCostBasis ?? 0,
    }).run();
  }

  if (data.initialValue && data.initialValue > 0) {
    try { await generateAssetSnapshot(result.id); } catch (err) { console.error(`[assets] Snapshot error for asset ${result.id}:`, err); }
  }

  const { rates } = await getExchangeRates();
  return { ok: true as const, asset: buildAssetResponse(result, rates) };
}

export async function updateAsset(id: number, data: {
  name?: string; type?: string; institution?: string | null;
  currency?: string; liquidity?: string;
  linkedAccountId?: number | null; notes?: string | null;
}) {
  const existing = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Asset not found', status: 404 };

  if (data.name && data.name !== existing.name) {
    const dup = db.select({ id: assets.id }).from(assets).where(eq(assets.name, data.name)).get();
    if (dup) return { ok: false as const, error: 'Asset name already exists', status: 409 };
  }

  if (data.linkedAccountId) {
    const acct = db.select({ id: accounts.id, accountType: accounts.accountType })
      .from(accounts).where(eq(accounts.id, data.linkedAccountId)).get();
    if (!acct) return { ok: false as const, error: 'Linked account not found', status: 400 };
    if (acct.accountType !== 'bank') return { ok: false as const, error: 'Linked account must be a bank account', status: 400 };
  }

  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.type !== undefined) updateSet.type = data.type;
  if (data.institution !== undefined) updateSet.institution = data.institution;
  if (data.currency !== undefined) updateSet.currency = data.currency;
  if (data.liquidity !== undefined) updateSet.liquidity = data.liquidity;
  if (data.linkedAccountId !== undefined) updateSet.linkedAccountId = data.linkedAccountId;
  if (data.notes !== undefined) updateSet.notes = data.notes;

  if (Object.keys(updateSet).length > 0) {
    db.update(assets).set(updateSet).where(eq(assets.id, id)).run();
  }

  const updated = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!updated) return { ok: false as const, error: 'Asset not found after update', status: 404 };
  const { rates } = await getExchangeRates();
  return { ok: true as const, asset: buildAssetResponse(updated, rates) };
}

export async function updateAssetValue(assetId: number, data: {
  currentValue: number; contribution?: number; date?: string; notes?: string;
}) {
  const assetRow = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!assetRow) return { ok: false as const, error: 'Asset not found', status: 404 };

  const category = getAssetCategory(assetRow.type);
  if (category === 'brokerage') return { ok: false as const, error: 'Use movements for brokerage assets', status: 400 };

  const holding = db.select().from(holdings)
    .where(and(eq(holdings.assetId, assetId), eq(holdings.type, 'balance'))).get();
  if (!holding) return { ok: false as const, error: 'No balance holding found. Re-create the asset.', status: 400 };

  const today = data.date ?? todayInIsrael();
  const now = new Date().toISOString();

  sqlite.transaction(() => {
    const updateSet: Record<string, unknown> = { quantity: data.currentValue, updatedAt: now };

    if (data.contribution && data.contribution > 0) {
      updateSet.costBasis = holding.costBasis + data.contribution;
      db.insert(assetMovements).values({
        assetId, holdingId: holding.id, date: today, type: 'contribution',
        quantity: data.contribution, currency: holding.currency, notes: data.notes, createdAt: now,
      }).run();
    }

    db.update(holdings).set(updateSet).where(eq(holdings.id, holding.id)).run();
  })();

  try { await generateAssetSnapshot(assetId); } catch (err) { console.error(`[assets] Snapshot error for asset ${assetId}:`, err); }

  const { rates } = await getExchangeRates();
  const refreshed = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!refreshed) return { ok: false as const, error: 'Asset not found after update', status: 404 };
  return { ok: true as const, asset: buildAssetResponse(refreshed, rates) };
}

export async function recordRent(assetId: number, data: { amount: number; date?: string; notes?: string }) {
  const assetRow = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!assetRow) return { ok: false as const, error: 'Asset not found', status: 404 };

  if (getAssetCategory(assetRow.type) !== 'real_estate') {
    return { ok: false as const, error: 'Rent income only applies to real estate assets', status: 400 };
  }

  const holding = db.select().from(holdings)
    .where(and(eq(holdings.assetId, assetId), eq(holdings.type, 'balance'))).get();
  if (!holding) return { ok: false as const, error: 'No balance holding found. Re-create the asset.', status: 400 };

  const today = data.date ?? todayInIsrael();
  const { rates } = await getExchangeRates();
  const rentAmountIls = convertToIls(data.amount, assetRow.currency, rates);

  db.insert(assetMovements).values({
    assetId, holdingId: holding.id, date: today, type: 'rent_income',
    quantity: data.amount, currency: assetRow.currency,
    sourceAmount: rentAmountIls, sourceCurrency: 'ILS',
    notes: data.notes, createdAt: new Date().toISOString(),
  }).run();

  try { await generateAssetSnapshot(assetId); } catch (err) { console.error(`[assets] Snapshot error for asset ${assetId}:`, err); }

  return { ok: true as const };
}

export async function deactivateAsset(id: number) {
  const existing = db.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Asset not found', status: 404 };

  db.update(assets).set({ isActive: false }).where(eq(assets.id, id)).run();
  return { ok: true as const };
}

// ── Holdings ──

export async function createHolding(assetId: number, data: {
  name: string; type: string; currency: string;
  quantity: number; costBasis?: number; lastPrice?: number; ticker?: string; notes?: string;
}) {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) return { ok: false as const, error: 'Asset not found', status: 404 };

  if (asset.linkedAccountId && data.currency === 'ILS' && data.type === 'cash') {
    return { ok: false as const, error: 'ILS cash for this institution is already tracked via the linked bank account', status: 400 };
  }

  const dup = db.select({ id: holdings.id }).from(holdings)
    .where(and(eq(holdings.assetId, assetId), eq(holdings.name, data.name))).get();
  if (dup) return { ok: false as const, error: 'Holding with this name already exists for this asset', status: 409 };

  const result = db.insert(holdings).values({
    assetId, name: data.name, type: data.type, currency: data.currency,
    quantity: data.quantity, costBasis: data.costBasis ?? 0,
    lastPrice: data.lastPrice, ticker: data.ticker, notes: data.notes,
  }).returning().get();

  try { await generateAssetSnapshot(assetId); } catch (err) { console.error(`[assets] Snapshot error for asset ${assetId}:`, err); }

  const { rates } = await getExchangeRates();
  return { ok: true as const, holding: computeHoldingValues(result, rates) };
}

export async function updateHolding(holdingId: number, data: {
  quantity?: number; costBasis?: number; lastPrice?: number | null; ticker?: string | null; notes?: string | null;
}) {
  const holding = db.select().from(holdings).where(eq(holdings.id, holdingId)).get();
  if (!holding) return { ok: false as const, error: 'Holding not found', status: 404 };

  const updateSet: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (data.quantity !== undefined) updateSet.quantity = data.quantity;
  if (data.costBasis !== undefined) updateSet.costBasis = data.costBasis;
  if (data.lastPrice !== undefined) updateSet.lastPrice = data.lastPrice;
  if (data.ticker !== undefined) updateSet.ticker = data.ticker;
  if (data.notes !== undefined) updateSet.notes = data.notes;

  db.update(holdings).set(updateSet).where(eq(holdings.id, holdingId)).run();

  try { await generateAssetSnapshot(holding.assetId); } catch (err) { console.error(`[assets] Snapshot error for asset ${holding.assetId}:`, err); }

  const updated = db.select().from(holdings).where(eq(holdings.id, holdingId)).get();
  if (!updated) return { ok: false as const, error: 'Holding not found after update', status: 404 };
  const { rates } = await getExchangeRates();
  return { ok: true as const, holding: computeHoldingValues(updated, rates) };
}

export async function deleteHolding(holdingId: number) {
  const holding = db.select().from(holdings).where(eq(holdings.id, holdingId)).get();
  if (!holding) return { ok: false as const, error: 'Holding not found', status: 404 };

  const assetId = holding.assetId;
  db.delete(holdings).where(eq(holdings.id, holdingId)).run();

  try { await generateAssetSnapshot(assetId); } catch (err) { console.error(`[assets] Snapshot error for asset ${assetId}:`, err); }

  return { ok: true as const };
}

// ── Movements ──

export async function createMovement(assetId: number, data: {
  holdingId?: number; date: string; type: string;
  quantity: number; currency: string;
  pricePerUnit?: number; sourceAmount?: number; sourceCurrency?: string;
  notes?: string;
}) {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) return { ok: false as const, error: 'Asset not found', status: 404 };

  const category = getAssetCategory(asset.type);
  const allowedTypes = CATEGORY_MOVEMENT_TYPES[category];
  if (!allowedTypes.includes(data.type as typeof allowedTypes[number])) {
    return { ok: false as const, error: `Movement type "${data.type}" is not allowed for ${asset.type} assets. Allowed: ${allowedTypes.join(', ')}`, status: 400 };
  }

  let holding: HoldingRow | undefined;
  if (data.holdingId) {
    holding = db.select().from(holdings)
      .where(and(eq(holdings.id, data.holdingId), eq(holdings.assetId, assetId))).get();
    if (!holding) return { ok: false as const, error: 'Holding not found or does not belong to this asset', status: 400 };
  }

  const { type, quantity } = data;
  if ((type === 'deposit' || type === 'buy' || type === 'dividend' || type === 'contribution' || type === 'rent_income') && quantity <= 0) {
    return { ok: false as const, error: `Quantity must be positive for ${type}`, status: 400 };
  }
  if ((type === 'withdrawal' || type === 'sell' || type === 'fee') && quantity >= 0) {
    return { ok: false as const, error: `Quantity must be negative for ${type}`, status: 400 };
  }

  if ((type === 'buy' || type === 'sell') && holding) {
    if ((holding.type === 'stock' || holding.type === 'etf' || holding.type === 'crypto') && !data.pricePerUnit) {
      return { ok: false as const, error: `pricePerUnit is required for ${type} on ${holding.type} holdings`, status: 400 };
    }
  }

  if (type === 'sell' && holding && Math.abs(quantity) > holding.quantity) {
    return { ok: false as const, error: 'Cannot sell more than current holding quantity', status: 400 };
  }
  if (type === 'withdrawal' && holding && Math.abs(quantity) > holding.quantity) {
    return { ok: false as const, error: 'Cannot withdraw more than current holding quantity', status: 400 };
  }

  const created = sqlite.transaction(() => {
    const movement = db.insert(assetMovements).values({
      assetId, holdingId: data.holdingId, date: data.date, type: data.type,
      quantity: data.quantity, currency: data.currency,
      pricePerUnit: data.pricePerUnit, sourceAmount: data.sourceAmount,
      sourceCurrency: data.sourceCurrency, notes: data.notes,
    }).returning().get();

    if (holding) {
      const updated = computeHoldingUpdate(holding, type, data.quantity, data.pricePerUnit, data.sourceAmount);
      if (updated.quantity !== holding.quantity || updated.costBasis !== holding.costBasis) {
        db.update(holdings).set({
          quantity: updated.quantity, costBasis: updated.costBasis,
          updatedAt: new Date().toISOString(),
        }).where(eq(holdings.id, holding!.id)).run();
      }
    }

    return movement;
  })();

  if (type !== 'dividend') {
    try { await generateAssetSnapshot(assetId); } catch (err) { console.error(`[assets] Snapshot error for asset ${assetId}:`, err); }
    try { await replayMovementSnapshots(assetId); } catch (err) { console.error(`[assets] Snapshot error for asset ${assetId}:`, err); }
  }

  return { ok: true as const, movement: created };
}

export async function deleteMovement(movementId: number) {
  const movement = db.select().from(assetMovements).where(eq(assetMovements.id, movementId)).get();
  if (!movement) return { ok: false as const, error: 'Movement not found', status: 404 };

  if (movement.holdingId) {
    const mostRecent = db.select({ id: assetMovements.id }).from(assetMovements)
      .where(eq(assetMovements.holdingId, movement.holdingId))
      .orderBy(desc(assetMovements.date), desc(assetMovements.id))
      .limit(1).get();

    if (mostRecent && mostRecent.id !== movement.id) {
      return { ok: false as const, error: 'Can only delete the most recent movement for this holding', status: 400 };
    }
  }

  const holding = movement.holdingId
    ? db.select().from(holdings).where(eq(holdings.id, movement.holdingId)).get()
    : undefined;

  sqlite.transaction(() => {
    if (holding) {
      const { type, quantity } = movement;
      let restoredQty = holding.quantity;
      let restoredCostBasis = holding.costBasis;

      if (type === 'buy') {
        restoredQty -= quantity;
        restoredCostBasis -= quantity * (movement.pricePerUnit ?? 0);
      } else if (type === 'sell' || type === 'withdrawal') {
        const oldQty = holding.quantity - quantity;
        const absQty = Math.abs(quantity);
        restoredQty = oldQty;
        restoredCostBasis = oldQty > absQty ? holding.costBasis * oldQty / (oldQty - absQty) : 0;
      } else if (type === 'deposit') {
        restoredQty -= quantity;
        restoredCostBasis -= quantity;
      } else if (type === 'fee') {
        restoredCostBasis -= Math.abs(movement.sourceAmount ?? quantity);
      } else if (type === 'adjustment') {
        restoredQty -= quantity;
      }

      if (restoredQty !== holding.quantity || restoredCostBasis !== holding.costBasis) {
        db.update(holdings).set({
          quantity: restoredQty, costBasis: restoredCostBasis,
          updatedAt: new Date().toISOString(),
        }).where(eq(holdings.id, holding.id)).run();
      }
    }

    db.delete(assetMovements).where(eq(assetMovements.id, movementId)).run();
  })();

  if (holding && movement.type !== 'dividend') {
    try { await generateAssetSnapshot(movement.assetId); } catch (err) { console.error(`[assets] Snapshot error for asset ${movement.assetId}:`, err); }
    try { await replayMovementSnapshots(movement.assetId, movementId); } catch (err) { console.error(`[assets] Snapshot error for asset ${movement.assetId}:`, err); }
  }

  return { ok: true as const };
}
