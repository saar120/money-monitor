/** Hint text shown under each alert card — describes what triggers the alert and when. */
export const ALERT_HINTS = {
  postScrape:
    'Runs after each scrape. An AI agent analyzes new transactions and spending patterns, alerting only when something noteworthy is found.',
  monthlySummary:
    "Sent once a month at 9:00 AM on your configured day. An AI agent summarizes last month's finances with contextual insights.",
} as const;
