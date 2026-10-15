import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/connection.js', () => ({ db: {}, sqlite: {} }));

const { computeHoldingValues } = await import('./assets.js');
import type { HoldingRow } from './assets.js';

const coin: HoldingRow = {
  id: 1,
  assetId: 1,
  name: 'Sample coin',
  type: 'crypto',
  currency: 'BTC',
  quantity: 0.15,
  costBasis: 18_000,
  lastPrice: 220_000,
  lastPriceDate: '2026-10-01',
  notes: null,
  updatedAt: '2026-10-01',
};

describe('holding return currencies', () => {
  it('compares a coin value in ILS with its ILS cost basis when an exchange rate exists', () => {
    const holding = computeHoldingValues(coin, { ILS: 1, BTC: 220_000 });
    expect(holding.currentValueIls).toBe(33_000);
    expect(holding.gainLoss).toBe(15_000);
    expect(holding.gainLossPercent).toBeCloseTo(83.3333);
  });

  it('uses the manual ILS coin price when its ticker has no exchange rate', () => {
    const holding = computeHoldingValues({ ...coin, currency: 'SAMPLE' }, { ILS: 1 });
    expect(holding.currentValueIls).toBe(33_000);
    expect(holding.gainLoss).toBe(15_000);
  });

  it('keeps brokerage returns in the holding currency', () => {
    const holding = computeHoldingValues(
      { ...coin, type: 'stock', currency: 'USD', quantity: 10, costBasis: 800, lastPrice: 100 },
      { ILS: 1, USD: 3.5 },
    );
    expect(holding.currentValueIls).toBe(3_500);
    expect(holding.gainLoss).toBe(200);
    expect(holding.gainLossPercent).toBe(25);
  });
});
