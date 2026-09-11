export type FixtureScenarioName =
  | 'normal'
  | 'needs-attention'
  | 'light-data'
  | 'review-heavy'
  | 'inbox-zero'
  | 'no-budget'
  | 'no-transactions'
  | 'category-shift'
  | 'slower-spending'
  | 'mixed-currency';

export type Transaction = {
  id: string;
  occurredAt: string;
  merchant: string;
  description?: string;
  amount: number;
  category: string;
  account: string;
  pending?: boolean;
  needsReview?: boolean;
  owner: string;
  included: boolean;
  effectiveDate: string;
  currencyCode?: string;
};

type CategorySpend = {
  name: string;
  spent: number;
  previous: number;
  budget: number | null;
  color: string;
};

export type BudgetProgress = {
  name: string;
  spent: number;
  limit: number;
  remaining: number;
  usedPercent: number;
  elapsedPercent: number;
  status: 'on_track' | 'watch' | 'over_budget';
};

export type MerchantChange = {
  name: string;
  category: string;
  current: number;
  previous: number;
  count: number;
};

type Freshness = {
  account: string;
  detail: string;
  state: 'fresh' | 'aging' | 'stale';
};

export type HomeData = {
  currentDate: string;
  month: string;
  currencyCode: string;
  spent: number;
  income: number;
  previousSpent: number;
  spendingVsIncomePercent: number | null;
  available: number | null;
  budget: number | null;
  budgetStatus: string;
  budgetNote: string;
  netWorth: number;
  netWorthChange: number | null;
  assets: number | null;
  liabilities: number | null;
  categories: CategorySpend[];
  trend: Array<{ day: number; current: number; previous: number }>;
  budgets: BudgetProgress[];
  merchants: MerchantChange[];
  reviewCount: number;
  sinceLastVisit: { transactions: number; spent: number } | null;
  netWorthHistory: Array<{ date: string; total: number }>;
  freshness: Freshness[];
};

export type FixtureScenario = HomeData & {
  name: FixtureScenarioName;
  transactions: Transaction[];
};

// Deterministic review metadata mirrors a realistically sized Mac category response.
export const FIXTURE_REVIEW_CATEGORIES = [
  'Dining',
  'Groceries',
  'Housing',
  'Transport',
  'Travel',
  'Shopping',
  'Health',
  'Subscriptions',
  'Utilities',
  'Entertainment',
  'Education',
  'Personal',
  'Gifts',
  'Insurance',
  'Taxes',
  'Pets',
  'Fees',
  'Transfer',
  'Income',
  'Other',
] as const;

const normalTransactions: Transaction[] = [
  {
    id: 'txn-wolt',
    occurredAt: '2026-09-07T18:42:00+03:00',
    merchant: 'Wolt · וולט',
    description: 'Dinner delivery',
    amount: -86.4,
    category: 'Dining',
    account: 'One Zero · 4421',
    pending: true,
    owner: 'Saar',
    included: true,
    effectiveDate: '2026-09-07',
  },
  {
    id: 'txn-salary',
    occurredAt: '2026-09-07T09:10:00+03:00',
    merchant: 'משכורת · Acme Labs',
    description: 'Monthly salary',
    amount: 32500,
    category: 'Income',
    account: 'One Zero · 4421',
    owner: 'Saar',
    included: true,
    effectiveDate: '2026-09-07',
  },
  {
    id: 'txn-superpharm',
    occurredAt: '2026-09-06T20:16:00+03:00',
    merchant: 'סופר־פארם',
    description: 'Dizengoff Center',
    amount: -214.9,
    category: 'Health',
    account: 'Isracard · 3098',
    needsReview: true,
    owner: 'Household',
    included: true,
    effectiveDate: '2026-09-06',
  },
  {
    id: 'txn-apple',
    occurredAt: '2026-09-06T08:03:00+03:00',
    merchant: 'Apple.com/bill',
    description: 'iCloud+',
    amount: -39.9,
    category: 'Subscriptions',
    account: 'Amex · 1004',
    owner: 'Saar',
    included: true,
    effectiveDate: '2026-09-06',
  },
  {
    id: 'txn-rami-levy',
    occurredAt: '2026-09-05T17:36:00+03:00',
    merchant: 'רמי לוי שיווק השקמה',
    description: 'Groceries · Bnei Brak',
    amount: -627.45,
    category: 'Groceries',
    account: 'One Zero · 4421',
    owner: 'Household',
    included: true,
    effectiveDate: '2026-09-05',
  },
  {
    id: 'txn-bit-noa',
    occurredAt: '2026-09-05T12:04:00+03:00',
    merchant: 'bit · העברה לנועה',
    description: 'Weekend apartment',
    amount: -1800,
    category: 'Transfer',
    account: 'One Zero · 4421',
    needsReview: true,
    owner: 'Saar',
    included: true,
    effectiveDate: '2026-09-05',
  },
  {
    id: 'txn-gett',
    occurredAt: '2026-09-04T23:18:00+03:00',
    merchant: 'Gett',
    description: 'Ride · Tel Aviv',
    amount: -63.2,
    category: 'Transport',
    account: 'Amex · 1004',
    pending: true,
    owner: 'Saar',
    included: true,
    effectiveDate: '2026-09-04',
  },
  {
    id: 'txn-arnona',
    occurredAt: '2026-09-03T07:48:00+03:00',
    merchant: 'עיריית תל אביב־יפו',
    description: 'ארנונה · Jul–Aug',
    amount: -1248.6,
    category: 'Housing',
    account: 'One Zero · 4421',
    owner: 'Household',
    included: true,
    effectiveDate: '2026-09-03',
  },
  {
    id: 'txn-interest',
    occurredAt: '2026-09-02T06:00:00+03:00',
    merchant: 'Interest credit',
    description: 'Current account interest',
    amount: 12.84,
    category: 'Income',
    account: 'One Zero · 4421',
    owner: 'Saar',
    included: true,
    effectiveDate: '2026-09-02',
  },
  {
    id: 'txn-booking',
    occurredAt: '2026-09-01T22:41:00+03:00',
    merchant: 'Booking.com · Amsterdam',
    description: 'Hotel reservation',
    amount: -4850,
    category: 'Travel',
    account: 'Amex · 1004',
    needsReview: true,
    owner: 'Household',
    included: true,
    effectiveDate: '2026-09-01',
  },
  {
    id: 'txn-coffee',
    occurredAt: '2026-09-01T08:12:00+03:00',
    merchant: 'Coffee Lab',
    description: 'אספרסו',
    amount: -18,
    category: 'Dining',
    account: 'One Zero · 4421',
    owner: 'Saar',
    included: true,
    effectiveDate: '2026-09-01',
  },
];

const normal: FixtureScenario = {
  name: 'normal',
  currentDate: '2026-09-07',
  month: 'September',
  currencyCode: 'ILS',
  spent: 18920,
  income: 27000,
  previousSpent: 19620,
  spendingVsIncomePercent: 70,
  available: 41080,
  budget: 60000,
  budgetStatus: 'On track',
  budgetNote: '15 points behind the month',
  netWorth: 1284500,
  netWorthChange: 29400,
  assets: 1512000,
  liabilities: 227500,
  categories: [
    { name: 'Housing', spent: 7200, previous: 7200, budget: 15000, color: '#446E60' },
    { name: 'Groceries', spent: 2850, previous: 3160, budget: 7500, color: '#C47A45' },
    { name: 'Dining', spent: 2160, previous: 1740, budget: 6000, color: '#9C5B67' },
    { name: 'Transport', spent: 1550, previous: 2010, budget: 5000, color: '#52799A' },
    { name: 'Shopping', spent: 1360, previous: 850, budget: 4500, color: '#8B7651' },
  ],
  budgets: [
    {
      name: 'Monthly spending',
      spent: 18920,
      limit: 60000,
      remaining: 41080,
      usedPercent: 32,
      elapsedPercent: 23,
      status: 'on_track',
    },
    {
      name: 'Dining',
      spent: 2160,
      limit: 7000,
      remaining: 4840,
      usedPercent: 31,
      elapsedPercent: 23,
      status: 'on_track',
    },
  ],
  merchants: [
    { name: 'Wolt', category: 'Dining', current: 870, previous: 440, count: 6 },
    { name: 'Restaurants', category: 'Dining', current: 910, previous: 620, count: 4 },
    { name: 'Zara', category: 'Shopping', current: 680, previous: 180, count: 2 },
    { name: 'Gett', category: 'Transport', current: 330, previous: 710, count: 5 },
  ],
  reviewCount: 3,
  sinceLastVisit: { transactions: 6, spent: 384 },
  netWorthHistory: [
    { date: '2026-04-01', total: 1198000 },
    { date: '2026-05-01', total: 1214000 },
    { date: '2026-06-01', total: 1238000 },
    { date: '2026-07-01', total: 1246000 },
    { date: '2026-08-01', total: 1255100 },
    { date: '2026-09-07', total: 1284500 },
  ],
  trend: [
    { day: 1, current: 2920, previous: 2600 },
    { day: 3, current: 6450, previous: 7200 },
    { day: 5, current: 12680, previous: 14100 },
    { day: 7, current: 18920, previous: 19620 },
  ],
  freshness: [
    { account: 'One Zero · 4421', detail: 'Updated just now', state: 'fresh' },
    { account: 'Amex · 1004', detail: 'Updated 14 min ago', state: 'fresh' },
    { account: 'Isracard · 3098', detail: 'Updated 2 hr ago', state: 'aging' },
    { account: 'Altshuler pension', detail: 'Last valued 3 days ago', state: 'aging' },
  ],
  transactions: normalTransactions,
};

const needsAttention: FixtureScenario = {
  ...normal,
  name: 'needs-attention',
  spent: 26840,
  available: -2640,
  budgetStatus: 'Over budget',
  budgetNote: '₪2,640 over September plan',
  categories: normal.categories.map((category) =>
    category.name === 'Dining'
      ? { ...category, spent: 3610 }
      : category.name === 'Shopping'
        ? { ...category, spent: 4280 }
        : category,
  ),
  budgets: [
    {
      name: 'Monthly spending',
      spent: 26840,
      limit: 24200,
      remaining: -2640,
      usedPercent: 111,
      elapsedPercent: 23,
      status: 'over_budget',
    },
    {
      name: 'Dining',
      spent: 3610,
      limit: 2400,
      remaining: -1210,
      usedPercent: 150,
      elapsedPercent: 23,
      status: 'over_budget',
    },
  ],
  trend: [
    { day: 1, current: 4100, previous: 2600 },
    { day: 3, current: 9800, previous: 7200 },
    { day: 5, current: 18200, previous: 14100 },
    { day: 7, current: 26840, previous: 19620 },
  ],
  freshness: [
    { account: 'One Zero · 4421', detail: 'Updated 5 min ago', state: 'fresh' },
    { account: 'Amex · 1004', detail: 'Connection needs attention', state: 'stale' },
    { account: 'Isracard · 3098', detail: 'Last updated yesterday', state: 'stale' },
    { account: 'Max · 7712', detail: 'Never synced', state: 'stale' },
    { account: 'Bank Hapoalim · 2468', detail: 'Last updated 3 days ago', state: 'stale' },
    { account: 'Altshuler pension', detail: 'Last valued 8 days ago', state: 'stale' },
  ],
};

const lightData: FixtureScenario = {
  ...normal,
  name: 'light-data',
  spent: 627,
  income: 0,
  previousSpent: 910,
  spendingVsIncomePercent: null,
  available: 6573,
  budget: 7200,
  budgetStatus: 'Plenty available',
  budgetNote: '7 days of activity',
  netWorth: 48200,
  netWorthChange: 320,
  assets: 48200,
  liabilities: 0,
  categories: [{ name: 'Groceries', spent: 627, previous: 910, budget: 1800, color: '#C47A45' }],
  trend: [
    { day: 1, current: 0, previous: 0 },
    { day: 3, current: 220, previous: 350 },
    { day: 5, current: 410, previous: 610 },
    { day: 7, current: 627, previous: 910 },
  ],
  budgets: [
    {
      name: 'Monthly spending',
      spent: 627,
      limit: 7200,
      remaining: 6573,
      usedPercent: 9,
      elapsedPercent: 23,
      status: 'on_track',
    },
  ],
  merchants: [{ name: 'Rami Levy', category: 'Groceries', current: 627, previous: 910, count: 1 }],
  reviewCount: 0,
  sinceLastVisit: null,
  freshness: [{ account: 'One Zero · 4421', detail: 'Updated just now', state: 'fresh' }],
  transactions: [normalTransactions[4]!],
};

export const fixtureScenarios: Record<FixtureScenarioName, FixtureScenario> = {
  normal,
  'needs-attention': needsAttention,
  'light-data': lightData,
  'review-heavy': {
    ...normal,
    name: 'review-heavy',
    reviewCount: 8,
    transactions: normalTransactions.map((transaction) => ({
      ...transaction,
      needsReview: transaction.amount < 0 && transaction.id !== 'txn-coffee',
    })),
  },
  'inbox-zero': {
    ...normal,
    name: 'inbox-zero',
    reviewCount: 0,
    transactions: normalTransactions.map((transaction) => ({ ...transaction, needsReview: false })),
  },
  'no-budget': {
    ...normal,
    name: 'no-budget',
    available: null,
    budget: null,
    budgetStatus: 'No budget',
    budgetNote: 'No monthly budget',
    budgets: [],
    categories: normal.categories.map((category) => ({ ...category, budget: null })),
  },
  'no-transactions': {
    ...lightData,
    name: 'no-transactions',
    spent: 0,
    previousSpent: 0,
    available: lightData.budget,
    categories: [],
    merchants: [],
    budgets: lightData.budgets.map((budget) => ({
      ...budget,
      spent: 0,
      remaining: budget.limit,
      usedPercent: 0,
    })),
    transactions: [],
    trend: [],
    sinceLastVisit: null,
  },
  'category-shift': {
    ...normal,
    name: 'category-shift',
    categories: normal.categories.map((category) =>
      category.name === 'Dining' ? { ...category, spent: 4120, previous: 1540 } : category,
    ),
    merchants: normal.merchants.map((merchant) =>
      merchant.category === 'Dining' ? { ...merchant, current: merchant.current * 2 } : merchant,
    ),
  },
  'slower-spending': {
    ...normal,
    name: 'slower-spending',
    spent: 14300,
    previousSpent: 19620,
    spendingVsIncomePercent: 53,
    budgetNote: '₪5,320 below last month’s pace',
    trend: normal.trend.map((point) => ({ ...point, current: Math.round(point.current * 0.76) })),
  },
  'mixed-currency': {
    ...normal,
    name: 'mixed-currency',
    transactions: normalTransactions.map((transaction, index) =>
      index === 0 ? { ...transaction, amount: -22.5, currencyCode: 'USD' } : transaction,
    ),
  },
};
