export interface ExchangeRateResult {
  rates: Record<string, number>;
  stale: boolean;
  fetchedAt: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedRates: Record<string, number> | null = null;
let lastFetched: Date | null = null;

async function fetchFiatRates(): Promise<Record<string, number>> {
  const res = await fetch(
    'https://www.boi.org.il/PublicApi/GetExchangeRates?asXml=false',
  );
  if (!res.ok) throw new Error(`Bank of Israel API returned ${res.status}`);
  const data = (await res.json()) as {
    exchangeRates: { key: string; currentExchangeRate: number }[];
  };

  const rates: Record<string, number> = {};
  for (const entry of data.exchangeRates) {
    if (entry.key && typeof entry.currentExchangeRate === 'number' && entry.currentExchangeRate > 0) {
      rates[entry.key] = entry.currentExchangeRate;
    }
  }
  if (Object.keys(rates).length === 0) {
    throw new Error('Bank of Israel API returned no valid exchange rates — response format may have changed');
  }
  return rates;
}

async function fetchBtcRate(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=ils',
  );
  if (!res.ok) throw new Error(`CoinGecko API returned ${res.status}`);
  const data = (await res.json()) as { bitcoin?: { ils?: number } };
  if (!data?.bitcoin?.ils || typeof data.bitcoin.ils !== 'number') {
    throw new Error('CoinGecko API returned unexpected response format');
  }
  return data.bitcoin.ils;
}

export async function getExchangeRates(): Promise<ExchangeRateResult> {
  // Return cached if fresh
  if (cachedRates && lastFetched && Date.now() - lastFetched.getTime() < CACHE_TTL_MS) {
    return {
      rates: { ...cachedRates },
      stale: false,
      fetchedAt: lastFetched.toISOString(),
    };
  }

  try {
    const [fiatRates, btcIls] = await Promise.all([
      fetchFiatRates(),
      fetchBtcRate(),
    ]);

    const rates: Record<string, number> = {
      ILS: 1,
      ...fiatRates,
      BTC: btcIls,
    };

    cachedRates = rates;
    lastFetched = new Date();

    return {
      rates: { ...rates },
      stale: false,
      fetchedAt: lastFetched.toISOString(),
    };
  } catch (err) {
    if (cachedRates && lastFetched) {
      console.error('Exchange rate fetch failed, returning stale cache:', err);
      return {
        rates: { ...cachedRates },
        stale: true,
        fetchedAt: lastFetched.toISOString(),
      };
    }
    throw err;
  }
}

export function convertToIls(
  amount: number,
  currency: string,
  rates: Record<string, number>,
): number {
  if (currency === 'ILS') return amount;

  const rate = rates[currency];
  if (rate === undefined) {
    throw new Error(`Exchange rate not available for currency "${currency}"`);
  }

  return amount * rate;
}
