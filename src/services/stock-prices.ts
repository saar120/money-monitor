import { eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { holdings, assets } from '../db/schema.js';
import { todayInIsrael } from '../shared/dates.js';

export interface StockQuote {
  symbol: string;
  price: number;
  currency: string;
  name?: string;
  exchange?: string;
}

const PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const priceCache = new Map<string, { quote: StockQuote; fetchedAt: number }>();

/**
 * Fetch a single stock quote from Yahoo Finance.
 * Works for US stocks (e.g. AAPL) and TASE stocks (e.g. 137.TA or LUMI.TA).
 */
export async function fetchQuote(symbol: string): Promise<StockQuote | null> {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cached.quote;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MoneyMonitor/1.0)',
      },
    });

    if (!res.ok) {
      console.warn(`[stock-prices] Yahoo Finance returned ${res.status} for ${symbol}`);
      return null;
    }

    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            currency?: string;
            shortName?: string;
            exchangeName?: string;
            symbol?: string;
          };
        }>;
        error?: { code?: string; description?: string };
      };
    };

    if (data.chart?.error) {
      console.warn(`[stock-prices] Yahoo Finance error for ${symbol}: ${data.chart.error.description}`);
      return null;
    }

    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) {
      console.warn(`[stock-prices] No price data for ${symbol}`);
      return null;
    }

    let price = meta.regularMarketPrice;
    const rawCurrency = meta.currency ?? 'USD';

    // TASE stocks: Yahoo returns prices in ILA (Agorot, 1/100 ILS)
    if (rawCurrency === 'ILA') {
      price = price / 100;
    }

    const quote: StockQuote = {
      symbol: meta.symbol ?? symbol,
      price,
      currency: mapYahooCurrency(rawCurrency),
      name: meta.shortName,
      exchange: meta.exchangeName,
    };

    priceCache.set(symbol, { quote, fetchedAt: Date.now() });
    return quote;
  } catch (err) {
    console.error(`[stock-prices] Failed to fetch ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fetch multiple stock quotes in a single batch request.
 */
export async function fetchQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();
  if (symbols.length === 0) return results;

  // Check cache first
  const uncached: string[] = [];
  for (const sym of symbols) {
    const cached = priceCache.get(sym);
    if (cached && Date.now() - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
      results.set(sym, cached.quote);
    } else {
      uncached.push(sym);
    }
  }

  if (uncached.length === 0) return results;

  // Fetch uncached in parallel (batches of 5 to avoid rate limiting)
  const batchSize = 5;
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize);
    const promises = batch.map(async (sym) => {
      const quote = await fetchQuote(sym);
      if (quote) results.set(sym, quote);
    });
    await Promise.all(promises);

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < uncached.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

/**
 * Update prices for all holdings that have a ticker set.
 * Returns count of updated holdings.
 */
export async function updateAllStockPrices(): Promise<{
  updated: number;
  failed: string[];
  total: number;
}> {
  // Find all holdings with tickers (from active brokerage assets)
  const holdingsWithTickers = db
    .select({
      id: holdings.id,
      ticker: holdings.ticker,
      assetId: holdings.assetId,
    })
    .from(holdings)
    .innerJoin(assets, eq(holdings.assetId, assets.id))
    .where(isNotNull(holdings.ticker))
    .all()
    .filter((h) => h.ticker && h.ticker.trim() !== '');

  if (holdingsWithTickers.length === 0) {
    return { updated: 0, failed: [], total: 0 };
  }

  const tickers = [...new Set(holdingsWithTickers.map((h) => h.ticker!))];
  const quotes = await fetchQuotes(tickers);

  const today = todayInIsrael();
  const now = new Date().toISOString();
  let updated = 0;
  const failed: string[] = [];

  for (const h of holdingsWithTickers) {
    const quote = quotes.get(h.ticker!);
    if (!quote) {
      failed.push(h.ticker!);
      continue;
    }

    db.update(holdings)
      .set({
        lastPrice: quote.price,
        lastPriceDate: today,
        updatedAt: now,
      })
      .where(eq(holdings.id, h.id))
      .run();

    updated++;
  }

  console.log(
    `[stock-prices] Updated ${updated}/${holdingsWithTickers.length} holdings` +
      (failed.length > 0 ? `, failed: ${failed.join(', ')}` : ''),
  );

  return { updated, failed, total: holdingsWithTickers.length };
}

/** Map Yahoo Finance currency codes to our standard codes */
function mapYahooCurrency(currency: string): string {
  const map: Record<string, string> = {
    ILA: 'ILS', // Yahoo returns ILA (Israeli Agorot) for TASE, we need ILS
    USd: 'USD',
    GBp: 'GBP',
  };
  return map[currency] ?? currency;
}
