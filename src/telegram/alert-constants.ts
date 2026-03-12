// ── Alert hint descriptions (shown in the UI under each card) ────────────────

export const ALERT_HINTS = {
  dailyDigest:
    'Runs after each scheduled scrape. Shows new transactions, spending & income totals, and flags large charges above the threshold.',
  unusualSpending:
    'Runs after each scrape. Compares your month-to-date spending by category against the same period last month.',
  newRecurring:
    'Runs after each scrape. Detects newly identified subscriptions by analyzing the last 6 months of transactions.',
  reviewReminder:
    'Runs after each scrape. Alerts when transactions are flagged for review or still uncategorized.',
  monthlySummary:
    "Sent once a month at 9:00 AM on your configured day. Shows last month's income, spending, savings rate, top categories, and month-over-month comparison.",
  netWorthChange:
    'Runs after each scrape. Alerts on significant changes or milestone crossings in your total net worth.',
} as const;

// ── Telegram message copy ────────────────────────────────────────────────────

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const MSG = {
  // Post-Scrape Digest
  digestHeader: '**📊 Scrape Complete**',
  noTransactions: 'No new transactions found.',
  largeChargesHeader: (threshold: string) => `**⚠️ Large charges (≥₪${threshold}):**`,
  scrapeErrorsHeader: (count: number) => `**❌ ${count} scrape error(s):**`,

  // Unusual Spending
  unusualSpendingHeader: '**📈 Unusual Spending Alert**',

  // New Recurring
  newRecurringHeader: '**🔄 New Recurring Charges Detected**',

  // Review Needed
  reviewHeader: '**🔍 Transactions Need Review**',
  reviewCta: 'Open the Insights page to review them.',

  // Monthly Summary
  monthlySummaryHeader: (monthLabel: string, year: number) =>
    `**📅 Monthly Summary — ${monthLabel} ${year}**`,

  // Net Worth
  netWorthMilestone: '**🎉 Net Worth Milestone!**',
  netWorthDrop: '**📉 Net Worth Alert**',
  netWorthChange: (emoji: string, dir: string, amount: string) =>
    `**${emoji} Net Worth ${dir} by ₪${amount}**`,
} as const;
