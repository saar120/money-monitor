import { MobileBootstrapSectionReadError, type MobileMoneyReadModel } from './bootstrap-adapter.js';

const ISO_CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));
const LEGACY_CURRENCY_CODE_PROJECTION: Readonly<Record<string, string>> = {
  '₪': 'ILS',
};

export function boundedMobileText(value: string, fallback: string, maximum: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return (normalized || fallback).slice(0, maximum);
}

export function projectedMobileCurrencyCode(persistedCurrency: string): string {
  return LEGACY_CURRENCY_CODE_PROJECTION[persistedCurrency] ?? persistedCurrency;
}

export function projectMobileMoney(value: number, persistedCurrency = 'ILS'): MobileMoneyReadModel {
  if (!Number.isFinite(value)) {
    throw new MobileBootstrapSectionReadError('calculation_failed', false);
  }

  const currencyCode = projectedMobileCurrencyCode(persistedCurrency);
  if (!/^[A-Z]{3}$/.test(currencyCode) || !ISO_CURRENCY_CODES.has(currencyCode)) {
    throw new MobileBootstrapSectionReadError('source_unavailable', false);
  }

  const normalized = Math.abs(value) < 0.005 ? 0 : Math.round(value * 100) / 100;
  return { value: normalized.toFixed(2), currencyCode };
}

export function projectMobileTransactionDirection(
  chargedAmount: number,
): 'debit' | 'credit' | 'unknown' {
  if (chargedAmount < 0) return 'debit';
  if (chargedAmount > 0) return 'credit';
  return 'unknown';
}

export function projectMobileTransactionStatus(
  persistedStatus: string,
): 'posted' | 'pending' | 'unknown' {
  if (persistedStatus === 'completed') return 'posted';
  if (persistedStatus === 'pending') return 'pending';
  return 'unknown';
}

/** Produces a display-only suffix on the server; the raw identifier never crosses the port. */
export function maskAccountIdentifier(accountNumber: string | null): string {
  const characters = (accountNumber ?? '').replace(/[^A-Za-z0-9]/g, '');
  const suffix = characters.length >= 2 ? characters.slice(-4) : 'NA';
  return `•••• ${suffix}`;
}
