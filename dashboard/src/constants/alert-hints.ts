/** Hint text shown under each alert card — describes what triggers the alert and when. */
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
