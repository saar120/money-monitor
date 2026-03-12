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

export const ALERT_HINTS = {
  postScrape:
    'Runs after each scrape. An AI agent analyzes new transactions and spending patterns, alerting only when something noteworthy is found.',
  monthlySummary:
    "Sent once a month at 9:00 AM on your configured day. An AI agent summarizes last month's finances with contextual insights.",
} as const;
