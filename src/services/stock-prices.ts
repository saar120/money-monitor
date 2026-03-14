import YahooFinance from 'yahoo-finance2';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { holdings } from '../db/schema.js';
import { todayInIsrael } from '../shared/dates.js';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export interface StockQuote {
  price: number;
  currency: string;
}

/**
 * Fetch current prices for a list of ticker symbols via Yahoo Finance.
 * Returns a map of ticker → { price, currency }. Failed tickers are omitted.
 */
export async function fetchStockPrices(tickers: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();
  if (tickers.length === 0) return results;

  const unique = [...new Set(tickers)];

  // Fetch in parallel with individual error handling
  const settled = await Promise.allSettled(
    unique.map(async (ticker) => {
      const quote = await yf.quote(ticker);
      if (quote.regularMarketPrice != null) {
        return {
          ticker,
          price: quote.regularMarketPrice,
          currency: quote.currency ?? 'USD',
        };
      }
      return null;
    }),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      results.set(result.value.ticker, {
        price: result.value.price,
        currency: result.value.currency,
      });
    } else if (result.status === 'rejected') {
      console.error('[stock-prices] Quote fetch failed:', result.reason);
    }
  }

  return results;
}

/**
 * Refresh lastPrice/lastPriceDate for all holdings that have a ticker.
 * Optionally scoped to a single asset.
 */
export async function refreshHoldingPrices(
  assetId?: number,
): Promise<{ updated: number; errors: string[] }> {
  const conditions = [isNotNull(holdings.ticker), inArray(holdings.type, ['stock', 'etf'])];
  if (assetId != null) {
    conditions.push(eq(holdings.assetId, assetId));
  }

  const rows = db
    .select({
      id: holdings.id,
      ticker: holdings.ticker,
      assetId: holdings.assetId,
    })
    .from(holdings)
    .where(and(...conditions))
    .all();

  if (rows.length === 0) {
    return { updated: 0, errors: [] };
  }

  const tickers = rows.map((r) => r.ticker).filter((t): t is string => t != null);
  const quotes = await fetchStockPrices(tickers);

  const errors: string[] = [];
  let updated = 0;
  const now = new Date().toISOString();
  const today = todayInIsrael();
  const affectedAssetIds = new Set<number>();

  for (const row of rows) {
    if (!row.ticker) continue;
    const quote = quotes.get(row.ticker);
    if (!quote) {
      errors.push(`No price returned for ${row.ticker}`);
      continue;
    }

    db.update(holdings)
      .set({
        lastPrice: quote.price,
        lastPriceDate: today,
        updatedAt: now,
      })
      .where(eq(holdings.id, row.id))
      .run();

    updated++;
    affectedAssetIds.add(row.assetId);
  }

  // Regenerate snapshots for affected assets
  // Import dynamically to avoid circular dependency
  const { generateSnapshotForAsset } = await import('./assets.js');
  for (const id of affectedAssetIds) {
    try {
      await generateSnapshotForAsset(id);
    } catch (err) {
      console.error(`[stock-prices] Snapshot regeneration failed for asset ${id}:`, err);
    }
  }

  if (updated > 0) {
    console.log(`[stock-prices] Updated ${updated} holding(s), ${errors.length} error(s)`);
  }

  return { updated, errors };
}

/**
 * Refresh all stock prices. Called by cron scheduler.
 */
export async function refreshAllStockPrices(): Promise<{
  updated: number;
  errors: string[];
}> {
  return refreshHoldingPrices();
}
