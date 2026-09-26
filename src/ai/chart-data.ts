import { getSpendingSummary } from '../services/summary.js';
import { monthsAgoStart, todayInIsrael } from '../shared/dates.js';
import { advisorChartSchema, type AdvisorChart } from './advisor-chart.js';

/** Chart points always come from the same Mac calculations used by Advisor's tools. */
export function makeAdvisorChart(
  kind: 'spending_trend' | 'category_spending',
  months = 6,
  requestedMonth?: string,
  language: 'en' | 'he' = 'en',
): AdvisorChart | null {
  if (kind === 'spending_trend') {
    const count = Number.isFinite(months) ? Math.max(1, Math.min(12, Math.trunc(months))) : 6;
    const result = getSpendingSummary(
      {
        startDate: monthsAgoStart(count - 1),
        endDate: todayInIsrael(),
        expensesOnly: true,
      },
      'month',
    );
    if (!Array.isArray(result.summary) || !result.summary.length) return null;
    return advisorChartSchema.parse({
      kind: 'line',
      title: language === 'he' ? 'הוצאות חודשיות' : 'Monthly spending',
      currencyCode: 'ILS',
      points: result.summary
        .filter(
          (row): row is Extract<typeof row, { month: string; totalAmount: number }> =>
            'totalAmount' in row && 'month' in row,
        )
        .map((row) => ({ label: row.month, value: Math.abs(row.totalAmount) }))
        .reverse(),
    });
  }
  const month = requestedMonth ?? todayInIsrael().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > todayInIsrael().slice(0, 7)) return null;
  const result = getSpendingSummary(
    { startDate: `${month}-01`, endDate: `${month}-31`, expensesOnly: true },
    'category',
  );
  if (!Array.isArray(result.summary) || !result.summary.length) return null;
  return advisorChartSchema.parse({
    kind: 'bar',
    title: `${language === 'he' ? 'הוצאות לפי קטגוריה' : 'Spending by category'} · ${month}`,
    currencyCode: 'ILS',
    points: result.summary
      .filter((row): row is Extract<typeof row, { category: string }> => 'category' in row)
      .map((row) => ({ label: row.category, value: Math.abs(row.totalAmount) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
  });
}
