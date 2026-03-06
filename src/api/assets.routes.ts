import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lte, desc, asc, count } from 'drizzle-orm';
import { db, sqlite } from '../db/connection.js';
import { assets, holdings, accounts, assetSnapshots, assetMovements } from '../db/schema.js';
import { parseIntParam, validateBody, validateQuery } from './helpers.js';
import {
  createAssetSchema, updateAssetSchema,
  createHoldingSchema, updateHoldingSchema,
  assetsQuerySchema, snapshotsQuerySchema,
  createMovementSchema, movementQuerySchema,
} from './validation.js';
import { getExchangeRates, convertToIls } from '../services/exchange-rates.js';
import { todayInIsrael } from '../shared/dates.js';

type HoldingRow = typeof holdings.$inferSelect;

function computeHoldingValues(h: HoldingRow, rates: Record<string, number>) {
  const isCrypto = h.type === 'crypto';
  // Crypto holdings with an exchange rate (e.g. BTC) use quantity directly like cash;
  // the exchange rate service handles BTC→ILS conversion.
  const cryptoHasRate = isCrypto && h.currency in rates;
  const needsPrice = (h.type === 'stock' || h.type === 'etf' || (isCrypto && !cryptoHasRate));

  let currentValue: number;
  let stale: boolean;

  if (needsPrice) {
    if (h.lastPrice == null) {
      currentValue = 0;
      stale = true;
    } else {
      currentValue = h.quantity * h.lastPrice;
      stale = false;
    }
  } else {
    currentValue = h.quantity;
    stale = false;
  }

  const currentValueIls = convertToIls(currentValue, h.currency, rates);

  let gainLoss: number | null = null;
  let gainLossPercent: number | null = null;

  if (!isCrypto) {
    gainLoss = currentValue - h.costBasis;
    gainLossPercent = h.costBasis !== 0 ? (gainLoss / h.costBasis) * 100 : null;
  }

  return {
    id: h.id,
    name: h.name,
    type: h.type,
    currency: h.currency,
    quantity: h.quantity,
    costBasis: h.costBasis,
    lastPrice: h.lastPrice,
    lastPriceDate: h.lastPriceDate,
    currentValue,
    currentValueIls,
    gainLoss,
    gainLossPercent,
    stale,
    notes: h.notes,
  };
}

function buildAssetResponse(assetRow: typeof assets.$inferSelect, rates: Record<string, number>) {
  const holdingRows = db.select().from(holdings).where(eq(holdings.assetId, assetRow.id)).all();
  const computedHoldings = holdingRows.map(h => computeHoldingValues(h, rates));
  const totalValueIls = computedHoldings.reduce((sum, h) => sum + h.currentValueIls, 0);

  let linkedAccountName: string | null = null;
  if (assetRow.linkedAccountId) {
    const acct = db.select({ displayName: accounts.displayName })
      .from(accounts).where(eq(accounts.id, assetRow.linkedAccountId)).get();
    linkedAccountName = acct?.displayName ?? null;
  }

  return {
    id: assetRow.id,
    name: assetRow.name,
    type: assetRow.type,
    currency: assetRow.currency,
    institution: assetRow.institution,
    liquidity: assetRow.liquidity,
    linkedAccountId: assetRow.linkedAccountId,
    linkedAccountName,
    isActive: assetRow.isActive,
    notes: assetRow.notes,
    holdings: computedHoldings,
    totalValueIls,
  };
}

export async function generateAssetSnapshot(assetId: number): Promise<void> {
  const holdingRows = db.select().from(holdings).where(eq(holdings.assetId, assetId)).all();
  const { rates } = await getExchangeRates();

  let totalValueIls = 0;
  let totalValue = 0;
  const holdingsSnapshot = holdingRows.map(h => {
    const cryptoHasRate = h.type === 'crypto' && h.currency in rates;
    const needsPrice = h.type === 'stock' || h.type === 'etf' || (h.type === 'crypto' && !cryptoHasRate);
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
    assetId,
    date: today,
    holdingsSnapshot: holdingsJson,
    totalValue,
    totalValueIls,
    exchangeRates: ratesJson,
  }).onConflictDoUpdate({
    target: [assetSnapshots.assetId, assetSnapshots.date],
    set: {
      holdingsSnapshot: holdingsJson,
      totalValue,
      totalValueIls,
      exchangeRates: ratesJson,
      createdAt: new Date().toISOString(),
    },
  }).run();
}

/**
 * Replay all movements for an asset chronologically and generate/update
 * a snapshot for each movement date. On delete, pass excludeMovementId
 * so the deleted movement is skipped and its date cleaned up if empty.
 */
export async function replayMovementSnapshots(
  assetId: number,
  excludeMovementId?: number,
): Promise<void> {
  const { rates } = await getExchangeRates();

  // Fetch all movements for this asset, sorted by date then id
  let allMovements = db.select().from(assetMovements)
    .where(eq(assetMovements.assetId, assetId))
    .orderBy(asc(assetMovements.date), asc(assetMovements.id))
    .all();

  if (excludeMovementId) {
    allMovements = allMovements.filter(m => m.id !== excludeMovementId);
  }

  if (allMovements.length === 0) return;

  // Fetch holding metadata (type, currency) for value calculation
  const holdingRows = db.select().from(holdings)
    .where(eq(holdings.assetId, assetId)).all();
  const holdingMeta = new Map(holdingRows.map(h => [h.id, { name: h.name, type: h.type, currency: h.currency }]));

  // Running state per holding: { quantity, costBasis }
  const holdingState = new Map<number, { quantity: number; costBasis: number }>();

  // Group movements by date for snapshot generation
  const movementsByDate = new Map<string, typeof allMovements>();
  for (const m of allMovements) {
    if (!movementsByDate.has(m.date)) movementsByDate.set(m.date, []);
    movementsByDate.get(m.date)!.push(m);
  }

  const today = todayInIsrael();
  const snapshotDates = new Set<string>();

  for (const [date, dayMovements] of movementsByDate) {
    // Don't overwrite today's live snapshot
    if (date === today) continue;

    // Apply each movement to running state
    for (const m of dayMovements) {
      if (!m.holdingId) continue;
      const state = holdingState.get(m.holdingId) ?? { quantity: 0, costBasis: 0 };

      if (m.type === 'buy') {
        state.quantity += m.quantity;
        state.costBasis += m.quantity * (m.pricePerUnit ?? 0);
      } else if (m.type === 'sell' || m.type === 'withdrawal') {
        if (state.quantity > 0) {
          const proportion = Math.abs(m.quantity) / state.quantity;
          state.costBasis -= state.costBasis * proportion;
        }
        state.quantity += m.quantity;
      } else if (m.type === 'deposit') {
        state.quantity += m.quantity;
        state.costBasis += m.quantity;
      } else if (m.type === 'fee') {
        state.costBasis += Math.abs(m.sourceAmount ?? m.quantity);
      } else if (m.type === 'adjustment') {
        state.quantity += m.quantity;
      }
      // dividend: no holding changes

      holdingState.set(m.holdingId, state);
    }

    // Compute total value at this date from running state
    let totalValueIls = 0;
    let totalValue = 0;
    const holdingsSnapshotArr: { name: string; quantity: number; currency: string; price: number | null; value: number; valueIls: number }[] = [];

    for (const [holdingId, state] of holdingState) {
      if (state.quantity === 0) continue;
      const meta = holdingMeta.get(holdingId);
      if (!meta) continue;

      const cryptoHasRate = meta.type === 'crypto' && meta.currency in rates;
      const needsPrice = meta.type === 'stock' || meta.type === 'etf' || (meta.type === 'crypto' && !cryptoHasRate);

      // Try to get ILS value from sourceAmount of movements on this date for this holding
      let ilsFromSource: number | null = null;
      for (const m of dayMovements) {
        if (m.holdingId === holdingId && m.sourceAmount != null && m.sourceCurrency?.toUpperCase() === 'ILS') {
          ilsFromSource = (ilsFromSource ?? 0) + Math.abs(m.sourceAmount);
        }
      }

      if (ilsFromSource != null) {
        // Use cumulative ILS: previous snapshot value + this day's source amount
        // For simplicity, compute running total from all movements up to this date
        let cumulativeIls = 0;
        for (const m of allMovements) {
          if (m.date > date) break;
          if (m.holdingId !== holdingId) continue;
          if (m.sourceAmount != null && m.sourceCurrency?.toUpperCase() === 'ILS') {
            if (m.type === 'sell' || m.type === 'withdrawal') {
              cumulativeIls -= Math.abs(m.sourceAmount);
            } else {
              cumulativeIls += Math.abs(m.sourceAmount);
            }
          } else {
            // No ILS source — use current rates as fallback for this movement
            const currentValue = needsPrice ? m.quantity * (m.pricePerUnit ?? 0) : m.quantity;
            if (m.type === 'sell' || m.type === 'withdrawal') {
              cumulativeIls -= Math.abs(convertToIls(currentValue, meta.currency, rates));
            } else if (m.type !== 'dividend' && m.type !== 'fee') {
              cumulativeIls += Math.abs(convertToIls(currentValue, meta.currency, rates));
            }
          }
        }
        const nativeValue = needsPrice ? 0 : state.quantity;
        totalValueIls += Math.max(0, cumulativeIls);
        totalValue += nativeValue;
        holdingsSnapshotArr.push({
          name: meta.name,
          quantity: state.quantity,
          currency: meta.currency,
          price: null,
          value: nativeValue,
          valueIls: Math.max(0, cumulativeIls),
        });
      } else {
        // No source amounts — fall back to current exchange rates
        const currentValue = needsPrice ? 0 : state.quantity;
        const valueIls = convertToIls(currentValue, meta.currency, rates);
        totalValueIls += valueIls;
        totalValue += currentValue;
        holdingsSnapshotArr.push({
          name: meta.name,
          quantity: state.quantity,
          currency: meta.currency,
          price: null,
          value: currentValue,
          valueIls,
        });
      }
    }

    const holdingsJson = JSON.stringify(holdingsSnapshotArr);
    const ratesJson = JSON.stringify(rates);

    db.insert(assetSnapshots).values({
      assetId,
      date,
      holdingsSnapshot: holdingsJson,
      totalValue,
      totalValueIls,
      exchangeRates: ratesJson,
    }).onConflictDoUpdate({
      target: [assetSnapshots.assetId, assetSnapshots.date],
      set: {
        holdingsSnapshot: holdingsJson,
        totalValue,
        totalValueIls,
        exchangeRates: ratesJson,
        createdAt: new Date().toISOString(),
      },
    }).run();

    snapshotDates.add(date);
  }

  // Clean up: remove snapshots on movement dates that no longer have any movements
  // (Only relevant after a movement delete — snapshotDates tracks what we just wrote)
  if (excludeMovementId) {
    const activeDates = new Set(allMovements.map(m => m.date));
    const existingSnapshots = db.select({ id: assetSnapshots.id, date: assetSnapshots.date })
      .from(assetSnapshots)
      .where(eq(assetSnapshots.assetId, assetId))
      .all();

    for (const snap of existingSnapshots) {
      // Only remove snapshots on dates we didn't just write and that have no movements
      // Keep today's snapshot and any non-movement snapshots (from holding edits etc.)
      if (snap.date === today || activeDates.has(snap.date) || snapshotDates.has(snap.date)) continue;
      // Only delete if the date is NOT after the last movement (those are live snapshots)
      const lastMovementDate = allMovements.length > 0 ? allMovements[allMovements.length - 1].date : '';
      if (snap.date > lastMovementDate) continue;
      db.delete(assetSnapshots).where(eq(assetSnapshots.id, snap.id)).run();
    }
  }
}

export async function assetsRoutes(app: FastifyInstance) {

  // GET /api/assets
  app.get<{ Querystring: Record<string, string> }>('/api/assets', async (request, reply) => {
    const query = validateQuery(assetsQuerySchema, request.query, reply);
    if (!query) return;

    const { rates } = await getExchangeRates();

    let rows;
    if (query.includeInactive) {
      rows = db.select().from(assets).all();
    } else {
      rows = db.select().from(assets).where(eq(assets.isActive, true)).all();
    }

    const result = rows.map(row => buildAssetResponse(row, rates));
    return reply.send(result);
  });

  // GET /api/assets/:id
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'asset ID', reply);
    if (id === null) return;

    const row = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!row) return reply.status(404).send({ error: 'Asset not found' });

    const { rates } = await getExchangeRates();
    const result = buildAssetResponse(row, rates);
    return reply.send(result);
  });

  // POST /api/assets
  app.post('/api/assets', async (request, reply) => {
    const data = validateBody(createAssetSchema, request.body, reply);
    if (!data) return;

    // Check unique name
    const existing = db.select({ id: assets.id }).from(assets).where(eq(assets.name, data.name)).get();
    if (existing) return reply.status(409).send({ error: 'Asset name already exists' });

    // Validate linkedAccountId if provided
    if (data.linkedAccountId) {
      const acct = db.select({ id: accounts.id, accountType: accounts.accountType })
        .from(accounts).where(eq(accounts.id, data.linkedAccountId)).get();
      if (!acct) return reply.status(400).send({ error: 'Linked account not found' });
      if (acct.accountType !== 'bank') return reply.status(400).send({ error: 'Linked account must be a bank account' });
    }

    const result = db.insert(assets).values({
      name: data.name,
      type: data.type,
      currency: data.currency,
      institution: data.institution,
      liquidity: data.liquidity,
      linkedAccountId: data.linkedAccountId,
      notes: data.notes,
    }).returning().get();

    const { rates } = await getExchangeRates();
    const response = buildAssetResponse(result, rates);
    return reply.status(201).send(response);
  });

  // PUT /api/assets/:id
  app.put<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'asset ID', reply);
    if (id === null) return;

    const existing = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Asset not found' });

    const data = validateBody(updateAssetSchema, request.body, reply);
    if (!data) return;

    // Check unique name if changing
    if (data.name && data.name !== existing.name) {
      const dup = db.select({ id: assets.id }).from(assets).where(eq(assets.name, data.name)).get();
      if (dup) return reply.status(409).send({ error: 'Asset name already exists' });
    }

    // Validate linkedAccountId if provided
    if (data.linkedAccountId) {
      const acct = db.select({ id: accounts.id, accountType: accounts.accountType })
        .from(accounts).where(eq(accounts.id, data.linkedAccountId)).get();
      if (!acct) return reply.status(400).send({ error: 'Linked account not found' });
      if (acct.accountType !== 'bank') return reply.status(400).send({ error: 'Linked account must be a bank account' });
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
    if (!updated) return reply.status(404).send({ error: 'Asset not found after update' });
    const { rates } = await getExchangeRates();
    const response = buildAssetResponse(updated, rates);
    return reply.send(response);
  });

  // DELETE /api/assets/:id (soft delete)
  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'asset ID', reply);
    if (id === null) return;

    const existing = db.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Asset not found' });

    db.update(assets).set({ isActive: false }).where(eq(assets.id, id)).run();
    return reply.status(204).send();
  });

  // POST /api/assets/:id/holdings
  app.post<{ Params: { id: string } }>('/api/assets/:id/holdings', async (request, reply) => {
    const assetId = parseIntParam(request.params.id, 'asset ID', reply);
    if (assetId === null) return;

    const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    const data = validateBody(createHoldingSchema, request.body, reply);
    if (!data) return;

    // Double-counting guard
    if (asset.linkedAccountId && data.currency === 'ILS' && data.type === 'cash') {
      return reply.status(400).send({
        error: 'ILS cash for this institution is already tracked via the linked bank account',
      });
    }

    // Check unique (asset_id, name)
    const dup = db.select({ id: holdings.id }).from(holdings)
      .where(and(eq(holdings.assetId, assetId), eq(holdings.name, data.name))).get();
    if (dup) return reply.status(409).send({ error: 'Holding with this name already exists for this asset' });

    const result = db.insert(holdings).values({
      assetId,
      name: data.name,
      type: data.type,
      currency: data.currency,
      quantity: data.quantity,
      costBasis: data.costBasis,
      lastPrice: data.lastPrice,
      notes: data.notes,
    }).returning().get();

    try { await generateAssetSnapshot(assetId); } catch (err) {
      request.log.error({ err, assetId }, 'Failed to generate asset snapshot');
    }

    const { rates } = await getExchangeRates();
    return reply.status(201).send(computeHoldingValues(result, rates));
  });

  // PUT /api/holdings/:id
  app.put<{ Params: { id: string } }>('/api/holdings/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'holding ID', reply);
    if (id === null) return;

    const holding = db.select().from(holdings).where(eq(holdings.id, id)).get();
    if (!holding) return reply.status(404).send({ error: 'Holding not found' });

    const data = validateBody(updateHoldingSchema, request.body, reply);
    if (!data) return;

    const updateSet: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (data.quantity !== undefined) updateSet.quantity = data.quantity;
    if (data.costBasis !== undefined) updateSet.costBasis = data.costBasis;
    if (data.lastPrice !== undefined) updateSet.lastPrice = data.lastPrice;
    if (data.notes !== undefined) updateSet.notes = data.notes;

    db.update(holdings).set(updateSet).where(eq(holdings.id, id)).run();

    try { await generateAssetSnapshot(holding.assetId); } catch (err) {
      request.log.error({ err, assetId: holding.assetId }, 'Failed to generate asset snapshot');
    }

    const updated = db.select().from(holdings).where(eq(holdings.id, id)).get();
    if (!updated) return reply.status(404).send({ error: 'Holding not found after update' });
    const { rates } = await getExchangeRates();
    return reply.send(computeHoldingValues(updated, rates));
  });

  // DELETE /api/holdings/:id
  app.delete<{ Params: { id: string } }>('/api/holdings/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'holding ID', reply);
    if (id === null) return;

    const holding = db.select().from(holdings).where(eq(holdings.id, id)).get();
    if (!holding) return reply.status(404).send({ error: 'Holding not found' });

    const assetId = holding.assetId;
    db.delete(holdings).where(eq(holdings.id, id)).run();

    try { await generateAssetSnapshot(assetId); } catch (err) {
      request.log.error({ err, assetId }, 'Failed to generate asset snapshot');
    }

    return reply.status(204).send();
  });

  // GET /api/assets/:id/snapshots
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/assets/:id/snapshots', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'asset ID', reply);
    if (id === null) return;

    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).get();
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    const query = validateQuery(snapshotsQuerySchema, request.query, reply);
    if (!query) return;

    // Default to last 12 months
    const endDate = query.endDate ?? todayInIsrael();
    const startDate = query.startDate ?? (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    })();

    const rows = db.select({
      date: assetSnapshots.date,
      totalValue: assetSnapshots.totalValue,
      totalValueIls: assetSnapshots.totalValueIls,
    }).from(assetSnapshots)
      .where(and(
        eq(assetSnapshots.assetId, id),
        gte(assetSnapshots.date, startDate),
        lte(assetSnapshots.date, endDate),
      ))
      .orderBy(assetSnapshots.date)
      .all();

    return reply.send({ snapshots: rows });
  });

  // ─── Movements ───

  // GET /api/assets/:id/movements
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/api/assets/:id/movements', async (request, reply) => {
    const assetId = parseIntParam(request.params.id, 'asset ID', reply);
    if (assetId === null) return;

    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    const query = validateQuery(movementQuerySchema, request.query, reply);
    if (!query) return;

    const conditions = [eq(assetMovements.assetId, assetId)];
    if (query.holdingId) conditions.push(eq(assetMovements.holdingId, query.holdingId));
    if (query.type) conditions.push(eq(assetMovements.type, query.type));
    if (query.startDate) conditions.push(gte(assetMovements.date, query.startDate));
    if (query.endDate) conditions.push(lte(assetMovements.date, query.endDate));

    const where = and(...conditions)!;

    const [totalRow] = db.select({ count: count() }).from(assetMovements).where(where).all();

    const rows = db.select({
      id: assetMovements.id,
      assetId: assetMovements.assetId,
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
      createdAt: assetMovements.createdAt,
    })
      .from(assetMovements)
      .leftJoin(holdings, eq(assetMovements.holdingId, holdings.id))
      .where(where)
      .orderBy(desc(assetMovements.date), desc(assetMovements.id))
      .limit(query.limit)
      .offset(query.offset)
      .all();

    return reply.send({ movements: rows, total: totalRow.count });
  });

  // POST /api/assets/:id/movements
  app.post<{ Params: { id: string } }>('/api/assets/:id/movements', async (request, reply) => {
    const assetId = parseIntParam(request.params.id, 'asset ID', reply);
    if (assetId === null) return;

    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    const data = validateBody(createMovementSchema, request.body, reply);
    if (!data) return;

    // Validate holdingId belongs to this asset
    let holding: typeof holdings.$inferSelect | undefined;
    if (data.holdingId) {
      holding = db.select().from(holdings)
        .where(and(eq(holdings.id, data.holdingId), eq(holdings.assetId, assetId))).get();
      if (!holding) return reply.status(400).send({ error: 'Holding not found or does not belong to this asset' });
    }

    // Validate quantity sign based on type
    const { type, quantity } = data;
    if ((type === 'deposit' || type === 'buy' || type === 'dividend') && quantity <= 0) {
      return reply.status(400).send({ error: `Quantity must be positive for ${type}` });
    }
    if ((type === 'withdrawal' || type === 'sell' || type === 'fee') && quantity >= 0) {
      return reply.status(400).send({ error: `Quantity must be negative for ${type}` });
    }

    // Require pricePerUnit for buy/sell on stock/etf/crypto
    if ((type === 'buy' || type === 'sell') && holding) {
      if ((holding.type === 'stock' || holding.type === 'etf' || holding.type === 'crypto') && !data.pricePerUnit) {
        return reply.status(400).send({ error: `pricePerUnit is required for ${type} on ${holding.type} holdings` });
      }
    }

    // Sell validation: can't sell more than you own
    if (type === 'sell' && holding) {
      if (Math.abs(quantity) > holding.quantity) {
        return reply.status(400).send({ error: 'Cannot sell more than current holding quantity' });
      }
    }

    // Withdrawal validation: can't withdraw more than you have
    if (type === 'withdrawal' && holding) {
      if (Math.abs(quantity) > holding.quantity) {
        return reply.status(400).send({ error: 'Cannot withdraw more than current holding quantity' });
      }
    }

    const needsSnapshot = type !== 'dividend';

    const created = sqlite.transaction(() => {
      // Insert movement
      const movement = db.insert(assetMovements).values({
        assetId,
        holdingId: data.holdingId,
        date: data.date,
        type: data.type,
        quantity: data.quantity,
        currency: data.currency,
        pricePerUnit: data.pricePerUnit,
        sourceAmount: data.sourceAmount,
        sourceCurrency: data.sourceCurrency,
        notes: data.notes,
      }).returning().get();

      // Update holding if applicable
      if (holding) {
        let newQty = holding.quantity;
        let newCostBasis = holding.costBasis;

        if (type === 'buy') {
          newQty += data.quantity;
          newCostBasis += data.quantity * (data.pricePerUnit ?? 0);
        } else if (type === 'sell' || type === 'withdrawal') {
          const proportion = Math.abs(data.quantity) / holding.quantity;
          newCostBasis -= holding.costBasis * proportion;
          newQty += data.quantity;
        } else if (type === 'deposit') {
          newQty += data.quantity;
          newCostBasis += data.quantity;
        } else if (type === 'fee') {
          // Fees increase cost basis (they're an investment cost) but don't change quantity
          newCostBasis += Math.abs(data.sourceAmount ?? data.quantity);
        } else if (type === 'adjustment') {
          newQty += data.quantity;
        }
        // dividend: no holding changes

        if (newQty !== holding.quantity || newCostBasis !== holding.costBasis) {
          db.update(holdings).set({
            quantity: newQty,
            costBasis: newCostBasis,
            updatedAt: new Date().toISOString(),
          }).where(eq(holdings.id, holding.id)).run();
        }
      }

      return movement;
    })();

    if (needsSnapshot) {
      try { await generateAssetSnapshot(assetId); } catch (err) {
        request.log.error({ err, assetId }, 'Failed to generate asset snapshot');
      }
      try { await replayMovementSnapshots(assetId); } catch (err) {
        request.log.error({ err, assetId }, 'Failed to replay movement snapshots');
      }
    }

    return reply.status(201).send(created);
  });

  // DELETE /api/movements/:id
  app.delete<{ Params: { id: string } }>('/api/movements/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'movement ID', reply);
    if (id === null) return;

    const movement = db.select().from(assetMovements).where(eq(assetMovements.id, id)).get();
    if (!movement) return reply.status(404).send({ error: 'Movement not found' });

    // Check if this is the most recent movement for its holding
    if (movement.holdingId) {
      const mostRecent = db.select({ id: assetMovements.id })
        .from(assetMovements)
        .where(eq(assetMovements.holdingId, movement.holdingId))
        .orderBy(desc(assetMovements.date), desc(assetMovements.id))
        .limit(1)
        .get();

      if (mostRecent && mostRecent.id !== movement.id) {
        return reply.status(400).send({ error: 'Can only delete the most recent movement for this holding' });
      }
    }

    const holding = movement.holdingId
      ? db.select().from(holdings).where(eq(holdings.id, movement.holdingId)).get()
      : undefined;

    sqlite.transaction(() => {
      // Reverse holding changes
      if (holding) {
        const { type, quantity } = movement;
        let restoredQty = holding.quantity;
        let restoredCostBasis = holding.costBasis;

        if (type === 'buy') {
          restoredQty -= quantity;
          restoredCostBasis -= quantity * (movement.pricePerUnit ?? 0);
        } else if (type === 'sell' || type === 'withdrawal') {
          // Reverse proportional reduction: oldQty = currentQty - qty (subtract negative = add)
          // oldCB = currentCB * oldQty / (oldQty - |qty|)
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
            quantity: restoredQty,
            costBasis: restoredCostBasis,
            updatedAt: new Date().toISOString(),
          }).where(eq(holdings.id, holding.id)).run();
        }
      }

      db.delete(assetMovements).where(eq(assetMovements.id, id)).run();
    })();

    if (holding && movement.type !== 'dividend') {
      try { await generateAssetSnapshot(movement.assetId); } catch (err) {
        request.log.error({ err, assetId: movement.assetId }, 'Failed to generate asset snapshot');
      }
      try { await replayMovementSnapshots(movement.assetId, id); } catch (err) {
        request.log.error({ err, assetId: movement.assetId }, 'Failed to replay movement snapshots');
      }
    }

    return reply.status(204).send();
  });
}
