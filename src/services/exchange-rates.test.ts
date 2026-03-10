import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('exchange-rates service', () => {
  let getExchangeRates: typeof import('./exchange-rates.js')['getExchangeRates'];
  let convertToIls: typeof import('./exchange-rates.js')['convertToIls'];
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // Default mock responses
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('boi.org.il')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            exchangeRates: [
              { key: 'USD', currentExchangeRate: 3.6 },
              { key: 'EUR', currentExchangeRate: 3.9 },
              { key: 'GBP', currentExchangeRate: 4.5 },
            ],
          }),
        });
      }
      if (url.includes('coingecko')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ bitcoin: { ils: 250000 } }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    const mod = await import('./exchange-rates.js');
    getExchangeRates = mod.getExchangeRates;
    convertToIls = mod.convertToIls;
  });

  // ── convertToIls ──

  describe('convertToIls', () => {
    it('returns amount unchanged for ILS', () => {
      expect(convertToIls(100, 'ILS', { ILS: 1, USD: 3.6 })).toBe(100);
    });

    it('converts USD using rate', () => {
      expect(convertToIls(100, 'USD', { ILS: 1, USD: 3.6 })).toBe(360);
    });

    it('converts EUR using rate', () => {
      expect(convertToIls(50, 'EUR', { ILS: 1, EUR: 3.9 })).toBe(195);
    });

    it('returns 0 for unknown currency', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(convertToIls(100, 'XYZ', { ILS: 1 })).toBe(0);
      consoleSpy.mockRestore();
    });

    it('handles zero amount', () => {
      expect(convertToIls(0, 'USD', { ILS: 1, USD: 3.6 })).toBe(0);
    });

    it('handles negative amounts', () => {
      expect(convertToIls(-100, 'USD', { ILS: 1, USD: 3.6 })).toBe(-360);
    });
  });

  // ── getExchangeRates ──

  describe('getExchangeRates', () => {
    it('fetches both fiat and BTC rates', async () => {
      const result = await getExchangeRates();

      expect(result.stale).toBe(false);
      expect(result.rates.ILS).toBe(1);
      expect(result.rates.USD).toBe(3.6);
      expect(result.rates.EUR).toBe(3.9);
      expect(result.rates.GBP).toBe(4.5);
      expect(result.rates.BTC).toBe(250000);
      expect(result.fetchedAt).toBeDefined();

      // Should have made exactly 2 fetch calls (fiat + BTC)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('uses cache on second call', async () => {
      const result1 = await getExchangeRates();
      const result2 = await getExchangeRates();

      // Both should succeed
      expect(result1.rates.USD).toBe(3.6);
      expect(result2.rates.USD).toBe(3.6);

      // Only 2 fetch calls total (not 4)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result2.stale).toBe(false);
    });

    it('returns ILS-only fallback when fiat API fails with no cache', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('boi.org.il')) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ bitcoin: { ils: 250000 } }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await getExchangeRates();
      expect(result.rates).toEqual({ ILS: 1 });
      expect(result.stale).toBe(true);
    });

    it('returns ILS-only fallback when BTC API returns unexpected format with no cache', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('boi.org.il')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              exchangeRates: [{ key: 'USD', currentExchangeRate: 3.6 }],
            }),
          });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ unexpected: 'format' }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await getExchangeRates();
      expect(result.rates).toEqual({ ILS: 1 });
      expect(result.stale).toBe(true);
    });
  });
});
