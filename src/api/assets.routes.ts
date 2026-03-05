import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lte, desc, count } from 'drizzle-orm';
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
  const needsPrice = h.type === 'stock' || h.type === 'etf' || h.type === 'crypto';
  const isCrypto = h.type === 'crypto';

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
  const holdingsSnapshot = holdingRows.map(h => {
    const needsPrice = h.type === 'stock' || h.type === 'etf' || h.type === 'crypto';
    const currentValue = needsPrice ? (h.lastPrice != null ? h.quantity * h.lastPrice : 0) : h.quantity;
    const valueIls = convertToIls(currentValue, h.currency, rates);
    totalValueIls += valueIls;
    return { name: h.name, quantity: h.quantity, currency: h.currency, price: h.lastPrice, valueIls };
  });

  const today = todayInIsrael();
  const holdingsJson = JSON.stringify(holdingsSnapshot);
  const ratesJson = JSON.stringify(rates);

  db.insert(assetSnapshots).values({
    assetId,
    date: today,
    holdingsSnapshot: holdingsJson,
    totalValueIls,
    exchangeRates: ratesJson,
  }).onConflictDoUpdate({
    target: [assetSnapshots.assetId, assetSnapshots.date],
    set: {
      holdingsSnapshot: holdingsJson,
      totalValueIls,
      exchangeRates: ratesJson,
      createdAt: new Date().toISOString(),
    },
  }).run();
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
    if (data.liquidity !== undefined) updateSet.liquidity = data.liquidity;
    if (data.linkedAccountId !== undefined) updateSet.linkedAccountId = data.linkedAccountId;
    if (data.notes !== undefined) updateSet.notes = data.notes;

    if (Object.keys(updateSet).length > 0) {
      db.update(assets).set(updateSet).where(eq(assets.id, id)).run();
    }

    const updated = db.select().from(assets).where(eq(assets.id, id)).get()!;
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

    await generateAssetSnapshot(assetId);

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

    await generateAssetSnapshot(holding.assetId);

    const updated = db.select().from(holdings).where(eq(holdings.id, id)).get()!;
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

    await generateAssetSnapshot(assetId);

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
    if ((type === 'withdrawal' || type === 'sell') && quantity >= 0) {
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

    const needsSnapshot = type !== 'dividend' && type !== 'fee';

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
        } else if (type === 'adjustment') {
          newQty += data.quantity;
        }
        // dividend and fee: no holding changes

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
      await generateAssetSnapshot(assetId);
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

    if (holding && movement.type !== 'dividend' && movement.type !== 'fee') {
      await generateAssetSnapshot(movement.assetId);
    }

    return reply.status(204).send();
  });
}
