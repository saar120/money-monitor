export type FixtureScenarioName = 'normal' | 'needs-attention' | 'light-data';

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
  budget: number;
  color: string;
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
  freshness: Freshness[];
};

export type FixtureScenario = HomeData & {
  name: FixtureScenarioName;
  transactions: Transaction[];
};

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
  available: 5280,
  budget: 24200,
  budgetStatus: 'On track',
  budgetNote: '₪730 below pace for today',
  netWorth: 1284500,
  netWorthChange: 29400,
  assets: 1512000,
  liabilities: 227500,
  categories: [
    { name: 'Housing', spent: 7200, budget: 7600, color: '#446E60' },
    { name: 'Groceries', spent: 2850, budget: 3500, color: '#C47A45' },
    { name: 'Dining', spent: 2160, budget: 2400, color: '#9C5B67' },
    { name: 'Transport', spent: 1550, budget: 2200, color: '#52799A' },
    { name: 'Shopping', spent: 1360, budget: 1800, color: '#8B7651' },
  ],
  trend: [
    { day: 1, current: 2920, previous: 2600 },
    { day: 7, current: 18920, previous: 20100 },
    { day: 14, current: 18920, previous: 27300 },
    { day: 21, current: 18920, previous: 34600 },
    { day: 30, current: 18920, previous: 41200 },
  ],
  freshness: [
    { account: 'One Zero · 4421', detail: 'Updated just now', state: 'fresh' },
    { account: 'Amex · 1004', detail: 'Updated 14 min ago', state: 'fresh' },
    { account: 'Isracard · 3098', detail: 'Updated 2 hr ago', state: 'aging' },
    { account: 'Altshuler pension', detail: 'Last valued 3 days ago', state: 'stale' },
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
  freshness: [
    { account: 'One Zero · 4421', detail: 'Updated 5 min ago', state: 'fresh' },
    { account: 'Amex · 1004', detail: 'Connection needs attention', state: 'stale' },
    { account: 'Isracard · 3098', detail: 'Last updated yesterday', state: 'stale' },
  ],
};

const lightData: FixtureScenario = {
  ...normal,
  name: 'light-data',
  spent: 627,
  available: 6573,
  budget: 7200,
  budgetStatus: 'Plenty available',
  budgetNote: '7 days of activity',
  netWorth: 48200,
  netWorthChange: 320,
  assets: 48200,
  liabilities: 0,
  categories: [{ name: 'Groceries', spent: 627, budget: 1800, color: '#C47A45' }],
  trend: [
    { day: 1, current: 0, previous: 0 },
    { day: 7, current: 627, previous: 910 },
    { day: 14, current: 627, previous: 910 },
    { day: 21, current: 627, previous: 910 },
    { day: 30, current: 627, previous: 910 },
  ],
  freshness: [{ account: 'One Zero · 4421', detail: 'Updated just now', state: 'fresh' }],
  transactions: [normalTransactions[4]!],
};

export const fixtureScenarios: Record<FixtureScenarioName, FixtureScenario> = {
  normal,
  'needs-attention': needsAttention,
  'light-data': lightData,
};
