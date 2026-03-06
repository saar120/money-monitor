/** Default fallback color for categories without a color (slate-400). */
export const DEFAULT_CATEGORY_COLOR = '#94a3b8';

/** Format a number as ILS currency with shekel sign. Uses Math.abs() so the sign is always positive. */
export function formatCurrency(amount: number): string {
  return `₪${Math.abs(amount).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/** Format a number with the appropriate currency symbol. */
export function formatAmount(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' ';
  const isSymbolPrefix = currency in CURRENCY_SYMBOLS;
  const formatted = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return isSymbolPrefix ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
}

/** Format an ISO date string as a short locale date (he-IL). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

/** Format an ISO datetime string as a short date + time (en-GB). */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** Build inline style for a category badge: semi-transparent background + matching text color. */
export function getCategoryStyle(color: string | null | undefined): { backgroundColor: string; color: string | undefined } {
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
