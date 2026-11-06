import { language } from './language';

/** Default fallback color for categories without a color (slate-400). */
export const DEFAULT_CATEGORY_COLOR = '#94a3b8';

/** Format a number as ILS currency with shekel sign. Uses Math.abs() so the sign is always positive. */
export function formatCurrency(amount: number): string {
  return `₪${Math.abs(amount).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A moment in time, e.g. "5 Nov, 02:00"; the year appears only when it isn't this year. */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(language.value === 'he' ? 'he-IL' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Format chart-scale currency values without hiding their magnitude. */
export function formatCompactCurrency(amount: number): string {
  return `${amount < 0 ? '−' : ''}₪${compactCurrencyFormatter.format(Math.abs(amount))}`;
}

/** Match the mobile chart's short value labels on an axis. */
export function formatCompactNumber(amount: number): string {
  if (amount === 0) return '0';
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return String(Math.round(amount));
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/** Format a number with the appropriate currency symbol. */
export function formatAmount(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' ';
  const isSymbolPrefix = currency in CURRENCY_SYMBOLS;
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isSymbolPrefix ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
}

/** Format an ISO date string as a short locale date (he-IL). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

/** Build inline style for a category badge: semi-transparent background + matching text color. */
export function getCategoryStyle(color: string | null | undefined): {
  backgroundColor: string;
  color: string | undefined;
} {
  const c = color ?? DEFAULT_CATEGORY_COLOR;
  return { backgroundColor: c + '33', color: color ?? undefined };
}

/** Build a name→Category lookup map from a category array. */
export function buildCategoryMap<T extends { name: string }>(categories: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const cat of categories) {
    map.set(cat.name, cat);
  }
  return map;
}
