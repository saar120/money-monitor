import { eq, and, lte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, assets, holdings, liabilities, accountBalanceHistory, assetSnapshots } from '../db/schema.js';
import { getExchangeRates, convertToIls } from './exchange-rates.js';
import { computeHoldingValues } from './assets.js';
import { todayInIsrael } from '../shared/dates.js';

// ── Date Points ──

export function generateDatePoints(startDate: string, endDate: string, granularity: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  if (granularity === 'monthly') {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      dates.push(`${y}-${m}-01`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else if (granularity === 'weekly') {
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

// ── Current Net Worth ──

export async function getNetWorth() {
  const { rates, stale: ratesStale } = await getExchangeRates();

  // 1. Bank accounts
  const bankRows = db.select().from(accounts)
    .where(and(eq(accounts.accountType, 'bank'), eq(accounts.isActive, true))).all();

  const banks = bankRows.map(b => ({
    id: b.id, name: b.displayName,
    balance: b.balance ?? 0, balanceIls: b.balance ?? 0,
  }));
  const banksTotal = banks.reduce((sum, b) => sum + b.balanceIls, 0);

  // 2. Assets with holdings
  const assetRows = db.select().from(assets).where(eq(assets.isActive, true)).all();

  const assetsResult: {
    id: number; name: string; type: string; currency: string; liquidity: string;
    totalValueIls: number; holdings: { name: string; currency: string; valueIls: number }[];
  }[] = [];

  let assetsTotal = 0;
  let liquidAssetsTotal = 0;

  for (const asset of assetRows) {
    const holdingRows = db.select().from(holdings).where(eq(holdings.assetId, asset.id)).all();
    const holdingResults: { name: string; currency: string; valueIls: number }[] = [];
    let assetValueIls = 0;

    for (const h of holdingRows) {
      const computed = computeHoldingValues(h, rates);
      assetValueIls += computed.currentValueIls;
      holdingResults.push({ name: h.name, currency: h.currency, valueIls: computed.currentValueIls });
    }

    assetsResult.push({
      id: asset.id, name: asset.name, type: asset.type,
      currency: asset.currency, liquidity: asset.liquidity,
      totalValueIls: assetValueIls, holdings: holdingResults,
    });

    assetsTotal += assetValueIls;
    if (asset.liquidity === 'liquid') liquidAssetsTotal += assetValueIls;
  }

  // 3. Liabilities
  const liabilityRows = db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
  const liabilitiesResult = liabilityRows.map(l => ({
    id: l.id, name: l.name,
    currentBalanceIls: convertToIls(l.currentBalance, l.currency, rates),
  }));
  const liabilitiesTotal = liabilitiesResult.reduce((sum, l) => sum + l.currentBalanceIls, 0);

  const total = banksTotal + assetsTotal - liabilitiesTotal;
  const liquidTotal = banksTotal + liquidAssetsTotal - liabilitiesTotal;

  return {
    total, liquidTotal,
    banks, banksTotal,
    assets: assetsResult, assetsTotal,
    liabilities: liabilitiesResult, liabilitiesTotal,
    exchangeRates: rates,
    ratesStale,
    calculatedAt: new Date().toISOString(),
  };
}

// ── Net Worth History ──

export async function getNetWorthHistory(opts: {
  startDate?: string; endDate?: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
}) {
  const today = todayInIsrael();
  const endDate = opts.endDate ?? today;
  const startDate = opts.startDate ?? (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  })();

  const datePoints = generateDatePoints(startDate, endDate, opts.granularity ?? 'monthly');

  if (datePoints.length > 1000) {
    return { error: 'Date range too large for selected granularity (max 1000 points)' };
  }
  if (datePoints.length === 0) {
    return { series: [] as { date: string; total: number; liquidTotal: number; banks: number; assets: number; liabilities: number }[] };
  }

  const bankAccounts = db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.accountType, 'bank'), eq(accounts.isActive, true))).all();

  const activeAssets = db.select({ id: assets.id, liquidity: assets.liquidity })
    .from(assets).where(eq(assets.isActive, true)).all();

  const lockedAssetIds = new Set(activeAssets.filter(a => a.liquidity === 'locked').map(a => a.id));
  const liabilityRows = db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
  const { rates } = await getExchangeRates();

  const lastDate = datePoints[datePoints.length - 1];

  const allBalanceHistory = db.select({
    accountId: accountBalanceHistory.accountId,
    date: accountBalanceHistory.date,
    balance: accountBalanceHistory.balance,
  }).from(accountBalanceHistory)
    .where(lte(accountBalanceHistory.date, lastDate))
    .orderBy(accountBalanceHistory.accountId, accountBalanceHistory.date).all();

  const allSnapshots = db.select({
    assetId: assetSnapshots.assetId,
    date: assetSnapshots.date,
    totalValueIls: assetSnapshots.totalValueIls,
  }).from(assetSnapshots)
    .orderBy(assetSnapshots.assetId, assetSnapshots.date).all();

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

  return { series };
}
