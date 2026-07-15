import { describe, expect, it } from 'vitest';
import { resolveChargedCurrency } from './transaction-currency.js';

describe('resolveChargedCurrency', () => {
  it('prefers a valid provider settlement currency', () => {
    expect(
      resolveChargedCurrency({
        chargedCurrency: ' usd ',
        originalCurrency: 'EUR',
        originalAmount: 10,
        chargedAmount: 38,
      }),
    ).toBe('USD');
  });

  it('retains the original currency when the provider reports an unchanged amount', () => {
    expect(
      resolveChargedCurrency({
        originalCurrency: 'EUR',
        originalAmount: -25,
        chargedAmount: -25,
      }),
    ).toBe('EUR');
  });

  it('falls back to ILS for converted or invalid ambiguous settlements', () => {
    expect(
      resolveChargedCurrency({
        chargedCurrency: 'secret-value',
        originalCurrency: 'USD',
        originalAmount: -25,
        chargedAmount: -92.5,
      }),
    ).toBe('ILS');
  });
});
