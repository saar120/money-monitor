const wholeShekels = new Intl.NumberFormat('en-IL', {
  maximumFractionDigits: 0,
});

const preciseShekels = new Intl.NumberFormat('en-IL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatShekels(value: number, precise = false): string {
  const absolute = (precise ? preciseShekels : wholeShekels).format(Math.abs(value));
  if (value > 0) return `+₪${absolute}`;
  if (value < 0) return `−₪${absolute}`;
  return `₪${absolute}`;
}

export function formatUnsignedShekels(value: number): string {
  return `₪${wholeShekels.format(Math.abs(value))}`;
}

export function formatMoney(value: number, currencyCode = 'ILS', precise = false): string {
  if (currencyCode === 'ILS') return formatShekels(value, precise);
  const formatted = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currencyCode,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: precise ? 2 : 0,
    maximumFractionDigits: precise ? 2 : 0,
  }).format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

export function formatUnsignedMoney(value: number, currencyCode = 'ILS'): string {
  const formatted = formatMoney(Math.abs(value), currencyCode);
  return formatted.startsWith('+') ? formatted.slice(1) : formatted;
}

// Both inputs are Mac-calculated, posted/included overview aggregates in the same currency.
export function overviewCashFlow(income: number, spending: number): number {
  return Math.round((income - spending + Number.EPSILON) * 100) / 100;
}
