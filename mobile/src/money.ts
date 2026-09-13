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

export function spendingTotal(value: number, currencyCode = 'ILS') {
  return {
    amount: formatUnsignedMoney(value, currencyCode),
    label: value > 0 ? 'Net spent' : value < 0 ? 'Net received' : 'No net spending',
  } as const;
}

export function formatSpendingChange(value: number, currencyCode = 'ILS'): string {
  if (value === 0) return 'No change';
  return `${formatUnsignedMoney(value, currencyCode)} ${value > 0 ? 'more spent' : 'less spent'}`;
}

// Both inputs are Mac-calculated, posted/included overview aggregates in the same currency.
export function overviewCashFlow(income: number, spending: number): number {
  return Math.round((income - spending + Number.EPSILON) * 100) / 100;
}

export function cashFlowSummary(months: ReadonlyArray<{ income: number; spending: number }>) {
  const income = months.reduce((sum, month) => sum + month.income, 0);
  const spending = months.reduce((sum, month) => sum + month.spending, 0);
  const total = overviewCashFlow(income, spending);
  const average = months.length
    ? Math.round((total / months.length + Number.EPSILON) * 100) / 100
    : 0;
  return { average, income, spending, total };
}

export function monthlyCategoryNames(
  months: ReadonlyArray<{ categories: ReadonlyArray<{ name: string; spent: number }> }>,
  limit = 6,
): string[] {
  const totals = new Map<string, number>();
  for (const month of months) {
    for (const category of month.categories) {
      totals.set(category.name, (totals.get(category.name) ?? 0) + Math.max(0, category.spent));
    }
  }
  return [...totals]
    .sort(
      ([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName),
    )
    .slice(0, limit)
    .map(([name]) => name);
}

export function niceChartMaximum(value: number, divisions = 4): number {
  if (value <= 0) return divisions;
  const roughStep = value / divisions;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceStep = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceStep * magnitude * divisions;
}
