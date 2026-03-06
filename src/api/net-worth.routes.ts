import type { FastifyInstance } from 'fastify';
import { eq, and, lte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, assets, holdings, liabilities, accountBalanceHistory, assetSnapshots } from '../db/schema.js';
import { validateQuery } from './helpers.js';
import { netWorthHistoryQuerySchema } from './validation.js';
import { getExchangeRates, convertToIls } from '../services/exchange-rates.js';
import { todayInIsrael } from '../shared/dates.js';

type HoldingRow = typeof holdings.$inferSelect;

function computeHoldingValueIls(h: HoldingRow, rates: Record<string, number>): number {
  const needsPrice = h.type === 'stock' || h.type === 'etf' || h.type === 'crypto';
  let currentValue: number;
  if (needsPrice) {
    currentValue = h.lastPrice != null ? h.quantity * h.lastPrice : 0;
  } else {
    currentValue = h.quantity;
  }
  return convertToIls(currentValue, h.currency, rates);
}

function generateDatePoints(startDate: string, endDate: string, granularity: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  if (granularity === 'monthly') {
    // First of each month
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      dates.push(`${y}-${m}-01`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else if (granularity === 'weekly') {
    // Mondays
    const cursor = new Date(start);
    const dayOfWeek = cursor.getDay();
    const daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
    cursor.setDate(cursor.getDate() + daysToMonday);
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    // daily
    const cursor = new Date(start);
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return dates;
}

export async function netWorthRoutes(app: FastifyInstance) {

  // GET /api/net-worth
  app.get('/api/net-worth', async (_request, reply) => {
    const { rates } = await getExchangeRates();

    // 1. Bank accounts
    const bankRows = db.select()
      .from(accounts)
      .where(and(eq(accounts.accountType, 'bank'), eq(accounts.isActive, true)))
      .all();

    const banks = bankRows.map(b => ({
      id: b.id,
      name: b.displayName,
      balance: b.balance ?? 0,
      balanceIls: b.balance ?? 0, // bank balances are in ILS
    }));
    const banksTotal = banks.reduce((sum, b) => sum + b.balanceIls, 0);

    // 2. Assets with holdings
    const assetRows = db.select().from(assets).where(eq(assets.isActive, true)).all();

    const assetsResult: {
      id: number;
      name: string;
      type: string;
      liquidity: string;
      totalValueIls: number;
      holdings: { name: string; currency: string; valueIls: number }[];
    }[] = [];

    let assetsTotal = 0;
    let liquidAssetsTotal = 0;

    for (const asset of assetRows) {
      const holdingRows = db.select().from(holdings).where(eq(holdings.assetId, asset.id)).all();
      const holdingResults: { name: string; currency: string; valueIls: number }[] = [];
      let assetValueIls = 0;

      for (const h of holdingRows) {
        const valueIls = computeHoldingValueIls(h, rates);
        assetValueIls += valueIls;
        holdingResults.push({ name: h.name, currency: h.currency, valueIls });
      }

      assetsResult.push({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        liquidity: asset.liquidity,
        totalValueIls: assetValueIls,
        holdings: holdingResults,
      });

      assetsTotal += assetValueIls;
      if (asset.liquidity === 'liquid') {
        liquidAssetsTotal += assetValueIls;
      }
    }

    // 3. Liabilities
    const liabilityRows = db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();

    const liabilitiesResult = liabilityRows.map(l => ({
      id: l.id,
      name: l.name,
      currentBalanceIls: convertToIls(l.currentBalance, l.currency, rates),
    }));
    const liabilitiesTotal = liabilitiesResult.reduce((sum, l) => sum + l.currentBalanceIls, 0);

    // 4. Totals
    const total = banksTotal + assetsTotal - liabilitiesTotal;
    const liquidTotal = banksTotal + liquidAssetsTotal - liabilitiesTotal;

    return reply.send({
      total,
      liquidTotal,
      banks,
      banksTotal,
      assets: assetsResult,
      assetsTotal,
      liabilities: liabilitiesResult,
      liabilitiesTotal,
      exchangeRates: rates,
      calculatedAt: new Date().toISOString(),
    });
  });

  // GET /api/net-worth/history
  app.get<{ Querystring: Record<string, string> }>('/api/net-worth/history', async (request, reply) => {
    const query = validateQuery(netWorthHistoryQuerySchema, request.query, reply);
    if (!query) return;

    const today = todayInIsrael();
    const endDate = query.endDate ?? today;
    const startDate = query.startDate ?? (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    })();

    const datePoints = generateDatePoints(startDate, endDate, query.granularity);

    if (datePoints.length > 1000) {
      return reply.status(400).send({ error: 'Date range too large for selected granularity (max 1000 points)' });
    }

    if (datePoints.length === 0) {
      return reply.send({ series: [] });
    }

    // Get all active bank accounts and active assets for lookups
    const bankAccounts = db.select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.accountType, 'bank'), eq(accounts.isActive, true)))
      .all();

    const activeAssets = db.select({ id: assets.id })
      .from(assets)
      .where(eq(assets.isActive, true))
      .all();

    // Liabilities total (current balance, no history)
    const liabilityRows = db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
    // Use current exchange rates for liability conversion
    const { rates } = await getExchangeRates();
    const liabilitiesTotal = liabilityRows.reduce(
      (sum, l) => sum + convertToIls(l.currentBalance, l.currency, rates), 0,
    );

    // Pre-fetch all balance history and snapshots in the date range (avoid N+1 queries)
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
      .where(lte(assetSnapshots.date, lastDate))
      .orderBy(assetSnapshots.assetId, assetSnapshots.date)
      .all();

    // Group by account/asset, sorted by date (already sorted from query)
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

    const series: { date: string; total: number; banks: number; assets: number; liabilities: number }[] = [];

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
      for (const asset of activeAssets) {
        const entries = snapshotByAsset.get(asset.id);
        if (entries) {
          const entry = entries.findLast(e => e.date <= date);
          if (entry) assetsValue += entry.totalValueIls;
        }
      }

      const total = banksValue + assetsValue - liabilitiesTotal;

      series.push({
        date,
        total,
        banks: banksValue,
        assets: assetsValue,
        liabilities: liabilitiesTotal,
      });
    }

    return reply.send({ series });
  });
}
