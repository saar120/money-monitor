interface TransactionCurrencyInput {
  chargedCurrency?: string;
  originalCurrency: string;
  chargedAmount: number;
  originalAmount: number;
}

const ISO_CURRENCY_CODE = /^[A-Z]{3}$/;

function normalizedCurrency(value: string | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && ISO_CURRENCY_CODE.test(code) ? code : null;
}

/**
 * Preserves the provider's settlement currency when present. For older
 * providers, an unchanged amount can safely retain its original currency;
 * converted or ambiguous settlements keep the app's ILS default.
 */
export function resolveChargedCurrency(input: TransactionCurrencyInput): string {
  const charged = normalizedCurrency(input.chargedCurrency);
  if (charged) return charged;

  const original = normalizedCurrency(input.originalCurrency);
  if (original && Math.abs(input.originalAmount - input.chargedAmount) < 0.000_001) {
    return original;
  }
  return 'ILS';
}
