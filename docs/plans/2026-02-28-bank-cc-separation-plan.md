# Bank vs Credit Card Separation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate banks from credit cards with distinct data capture, API filtering, and dashboard views.

**Architecture:** Add `accountType` and `balance` to accounts, `meta` JSON to transactions. Derive type from a hardcoded companyId→type mapping. Scraper captures type-specific data. Dashboard splits overview into bank balances and credit card spending sections.

**Tech Stack:** Drizzle ORM (SQLite), Fastify, Vue 3, israeli-bank-scrapers, Zod

---

### Task 1: Add provider-type mapping constant

**Files:**
- Modify: `src/shared/types.ts:44-51`

**Step 1: Add the type mapping and helper**

Add after the existing `CompanyId` type (line 51):

```typescript
export const ACCOUNT_TYPE_MAP: Record<CompanyId, 'bank' | 'credit_card'> = {
  hapoalim: 'bank',
  leumi: 'bank',
  discount: 'bank',
  mizrahi: 'bank',
  otsarHahayal: 'bank',
  mercantile: 'bank',
  massad: 'bank',
  beinleumi: 'bank',
  union: 'bank',
  yahav: 'bank',
  oneZero: 'bank',
  isracard: 'credit_card',
  amex: 'credit_card',
  max: 'credit_card',
  visaCal: 'credit_card',
  beyahadBishvilha: 'credit_card',
  behatsdaa: 'credit_card',
  pagi: 'credit_card',
};

export function getAccountType(companyId: CompanyId): 'bank' | 'credit_card' {
  return ACCOUNT_TYPE_MAP[companyId];
}
```

**Step 2: Also add `category` to `ScraperTransaction` interface**

In `ScraperTransaction` (line 13-28), add after `status: string;`:

```typescript
  category?: string;
```

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add provider-to-account-type mapping"
```

---

### Task 2: Update database schema

**Files:**
- Modify: `src/db/schema.ts:4-13` (accounts table)
- Modify: `src/db/schema.ts:15-34` (transactions table)

**Step 1: Add `accountType` and `balance` to accounts table**

Add after `accountNumber` (line 8):

```typescript
  accountType: text('account_type').notNull().default('bank'),
  balance: real('balance'),
```

**Step 2: Add `meta` to transactions table**

Add after `category` (line 30):

```typescript
  meta: text('meta'),
```

**Step 3: Generate migration**

Run: `npm run db:generate`

Expected: New migration SQL file created in `src/db/migrations/`, journal updated.

**Step 4: Verify migration file**

Check the generated SQL contains `ALTER TABLE accounts ADD COLUMN account_type` and `ALTER TABLE transactions ADD COLUMN meta`.

**Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add accountType, balance, and meta columns"
```

---

### Task 3: Update account creation to auto-set accountType

**Files:**
- Modify: `src/api/accounts.routes.ts:29-38`
- Modify: `src/api/validation.ts:6-13`

**Step 1: Import getAccountType in accounts routes**

Add to imports in `src/api/accounts.routes.ts` (line 1 area):

```typescript
import { getAccountType } from '../shared/types.js';
import type { CompanyId } from '../shared/types.js';
```

**Step 2: Set accountType on insert**

In the POST handler (line 34-38), update the insert to include accountType:

```typescript
    const result = db.insert(accounts).values({
      companyId,
      displayName,
      credentialsRef,
      accountType: getAccountType(companyId as CompanyId),
    }).returning().get();
```

**Step 3: Commit**

```bash
git add src/api/accounts.routes.ts
git commit -m "feat: auto-set accountType on account creation"
```

---

### Task 4: Backfill accountType for existing accounts

**Files:**
- Modify: `src/db/connection.ts` (add one-time backfill after migrate)

**Step 1: Read `src/db/connection.ts` to understand current structure**

**Step 2: Add backfill logic after migrate() call**

After the existing `migrate(db, ...)` call, add:

```typescript
import { ACCOUNT_TYPE_MAP } from '../shared/types.js';
import { accounts } from './schema.js';
import { eq } from 'drizzle-orm';

// Backfill accountType for existing accounts
for (const [companyId, accountType] of Object.entries(ACCOUNT_TYPE_MAP)) {
  db.update(accounts)
    .set({ accountType })
    .where(eq(accounts.companyId, companyId))
    .run();
}
```

This is idempotent — safe to run on every startup. It can be removed after the first deployment.

**Step 3: Commit**

```bash
git add src/db/connection.ts
git commit -m "feat: backfill accountType for existing accounts"
```

---

### Task 5: Update scraper to capture balance and meta

**Files:**
- Modify: `src/scraper/scraper.service.ts:18-35` (mapTransaction)
- Modify: `src/scraper/scraper.service.ts:75-83` (createScraper options)
- Modify: `src/scraper/scraper.service.ts:120-157` (result processing)

**Step 1: Import getAccountType**

Add to imports:

```typescript
import { getAccountType } from '../shared/types.js';
import type { CompanyId } from '../shared/types.js';
```

**Step 2: Update mapTransaction to include meta**

Add `meta` field to the return object in `mapTransaction` (line 19-35):

```typescript
function mapTransaction(accountId: number, txn: ScraperTransaction): NewTransaction {
  const meta: Record<string, string> = {};
  if (txn.category) meta.bankCategory = txn.category;

  return {
    accountId,
    identifier: txn.identifier != null ? Number(txn.identifier) : null,
    date: txn.date,
    processedDate: txn.processedDate,
    originalAmount: txn.originalAmount,
    originalCurrency: txn.originalCurrency,
    chargedAmount: txn.chargedAmount,
    description: txn.description,
    memo: txn.memo ?? null,
    type: txn.type,
    status: txn.status,
    installmentNumber: txn.installments?.number ?? null,
    installmentTotal: txn.installments?.total ?? null,
    meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    hash: computeHash(accountId, txn),
  };
}
```

**Step 3: Add type-specific scraper options**

In `scrapeAccount` (line 75-83), make options type-aware:

```typescript
    const accountType = getAccountType(account.companyId as CompanyId);

    const scraper = createScraper({
      companyId: CompanyTypes[account.companyId as keyof typeof CompanyTypes],
      startDate,
      combineInstallments: false,
      showBrowser: config.SCRAPE_SHOW_BROWSER,
      timeout: config.SCRAPE_TIMEOUT,
      defaultTimeout: config.SCRAPE_TIMEOUT,
      args: ['--no-sandbox', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
      ...(accountType === 'credit_card' ? { futureMonthsToScrape: 1 } : {}),
    });
```

**Step 4: Capture balance after scraping**

In the result processing loop (around line 124-131), after updating accountNumber, also update balance:

```typescript
    for (const scraperAccount of result.accounts ?? []) {
      if (scraperAccount.accountNumber && !account.accountNumber) {
        db.update(accounts)
          .set({ accountNumber: scraperAccount.accountNumber })
          .where(eq(accounts.id, account.id))
          .run();
      }

      if (scraperAccount.balance != null) {
        db.update(accounts)
          .set({ balance: scraperAccount.balance })
          .where(eq(accounts.id, account.id))
          .run();
      }
```

**Step 5: Commit**

```bash
git add src/scraper/scraper.service.ts
git commit -m "feat: capture balance, meta, and use type-specific scraper options"
```

---

### Task 6: Update AI categorizer to use meta

**Files:**
- Modify: `src/ai/agent.ts:81-83` (batchCategorize txnList formatting)
- Modify: `src/ai/agent.ts:147-149` (recategorize txnList formatting)

**Step 1: Update batchCategorize to include meta in prompt**

Change the txnList formatting (line 81-83):

```typescript
  const txnList = uncategorized.map(t => {
    const meta = t.meta ? JSON.parse(t.meta) : {};
    const bankCat = meta.bankCategory ? ` | bank-category: ${meta.bankCategory}` : '';
    return `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}${bankCat}`;
  }).join('\n');
```

**Step 2: Same change in recategorize**

Apply the same pattern to recategorize (line 147-149):

```typescript
  const txnList = toProcess.map(t => {
    const meta = t.meta ? JSON.parse(t.meta) : {};
    const bankCat = meta.bankCategory ? ` | bank-category: ${meta.bankCategory}` : '';
    return `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}${bankCat}`;
  }).join('\n');
```

**Step 3: Commit**

```bash
git add src/ai/agent.ts
git commit -m "feat: include bank-provided category in AI categorization prompt"
```

---

### Task 7: Add accountType filter to transactions API

**Files:**
- Modify: `src/api/validation.ts:23-36` (transactionQuerySchema)
- Modify: `src/api/transactions.routes.ts:9-56` (GET /api/transactions)
- Modify: `src/api/validation.ts:44-49` (summaryQuerySchema)

**Step 1: Add accountType to transactionQuerySchema**

In `transactionQuerySchema` (line 23-36), add after `accountId`:

```typescript
  accountType: z.enum(['bank', 'credit_card']).optional(),
```

**Step 2: Add accountType to summaryQuerySchema**

In `summaryQuerySchema` (line 44-49), add after `accountId`:

```typescript
  accountType: z.enum(['bank', 'credit_card']).optional(),
```

**Step 3: Update GET /api/transactions to filter by accountType**

In `src/api/transactions.routes.ts`, add import for accounts table and `inArray`/`eq`:

```typescript
import { accounts } from '../db/schema.js';
```

After extracting `parsed.data` (around line 21), add:

```typescript
    const { accountType, ...rest } = parsed.data;
    const {
      accountId, startDate, endDate, category, status,
      minAmount, maxAmount, search,
      offset, limit, sortBy, sortOrder,
    } = rest;
```

When `accountType` is provided, fetch matching account IDs and add a filter:

```typescript
    if (accountType) {
      const matchingAccounts = db.select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.accountType, accountType))
        .all();
      const ids = matchingAccounts.map(a => a.id);
      if (ids.length > 0) {
        conditions.push(inArray(transactions.accountId, ids));
      } else {
        // No accounts of this type — return empty
        return reply.send({ transactions: [], pagination: { total: 0, offset, limit, hasMore: false } });
      }
    }
```

Add `inArray` to the drizzle-orm import at line 2.

**Step 4: Update summary routes similarly**

Read `src/api/summary.routes.ts` and apply the same `accountType` filter pattern.

**Step 5: Commit**

```bash
git add src/api/validation.ts src/api/transactions.routes.ts src/api/summary.routes.ts
git commit -m "feat: add accountType filter to transactions and summary APIs"
```

---

### Task 8: Update dashboard API client and providers

**Files:**
- Modify: `dashboard/src/api/client.ts` (add accountType to filter types, expose balance/accountType)
- Modify: `dashboard/src/lib/providers.ts` (add accountType to Provider interface)

**Step 1: Read `dashboard/src/api/client.ts` to understand current types**

**Step 2: Add accountType to TransactionFilters interface**

Add `accountType?: 'bank' | 'credit_card'` to the filters type.

**Step 3: Add accountType to SummaryFilters**

Add `accountType?: 'bank' | 'credit_card'` to the summary filters type.

**Step 4: Update Provider type with accountType**

In `dashboard/src/lib/providers.ts`, add `accountType` to the Provider interface:

```typescript
export interface Provider {
  id: string
  name: string
  accountType: 'bank' | 'credit_card'
  fields: ProviderField[]
  otpNote?: string
}
```

And add `accountType` to each provider in the PROVIDERS array:
- Banks get `accountType: 'bank'`
- Credit cards get `accountType: 'credit_card'`

**Step 5: Commit**

```bash
git add dashboard/src/api/client.ts dashboard/src/lib/providers.ts
git commit -m "feat: add accountType to dashboard API client and providers"
```

---

### Task 9: Update AccountManager to group by type

**Files:**
- Modify: `dashboard/src/components/AccountManager.vue`

**Step 1: Read the component to understand current structure**

**Step 2: Split accounts into two computed lists**

Add computed properties that separate accounts by type:

```typescript
const bankAccounts = computed(() =>
  accounts.value.filter(a => a.accountType === 'bank')
)
const creditCardAccounts = computed(() =>
  accounts.value.filter(a => a.accountType === 'credit_card')
)
```

**Step 3: Update the template to show two sections**

Replace the single account grid with two sections:
- "Banks" heading → grid of bank account cards (show balance when available)
- "Credit Cards" heading → grid of credit card account cards

**Step 4: Show balance on bank account cards**

On bank account cards, display the balance if available:

```html
<p v-if="account.balance != null" class="text-lg font-semibold">
  ₪{{ account.balance.toLocaleString() }}
</p>
```

**Step 5: Commit**

```bash
git add dashboard/src/components/AccountManager.vue
git commit -m "feat: group accounts by type, show balance on bank cards"
```

---

### Task 10: Update TransactionTable with type filter

**Files:**
- Modify: `dashboard/src/components/TransactionTable.vue`

**Step 1: Read the component to understand current filters**

**Step 2: Add accountType filter toggle**

Add a segmented control / select above the table with options: "All" | "Banks" | "Credit Cards"

```typescript
const accountTypeFilter = ref<string>('')
```

**Step 3: Wire it to the API call**

In the `fetchTransactions` function, include accountType in the filter params:

```typescript
accountType: accountTypeFilter.value || undefined
```

**Step 4: When accountType changes, also filter the account dropdown**

The account dropdown should only show accounts of the selected type.

**Step 5: Commit**

```bash
git add dashboard/src/components/TransactionTable.vue
git commit -m "feat: add bank/credit card filter toggle to transactions"
```

---

### Task 11: Update OverviewDashboard with split sections

**Files:**
- Modify: `dashboard/src/components/OverviewDashboard.vue`

**Step 1: Read the component to understand current layout**

**Step 2: Add bank balances section**

Fetch accounts with `accountType === 'bank'` and display balance cards:

```typescript
const { data: accountsData } = useApi(() => getAccounts())
const bankAccounts = computed(() =>
  (accountsData.value?.accounts ?? []).filter(a => a.accountType === 'bank')
)
```

Add a "Bank Balances" section at the top showing each bank with its current balance.

**Step 3: Update spending sections to filter by credit cards**

The existing "This Month" / "Last Month" / "Spending by Category" sections should pass `accountType: 'credit_card'` to the summary API, since spending analysis is primarily about credit card expenses.

**Step 4: Keep "Per Account" section showing all accounts but grouped**

Show bank accounts first (with balances), then credit card accounts (with spending totals).

**Step 5: Commit**

```bash
git add dashboard/src/components/OverviewDashboard.vue
git commit -m "feat: split overview into bank balances and credit card spending"
```

---

### Task 12: Restart dev server and verify

**Step 1: Restart dev server**

Run: `npm run dev`

Expected: Migration applies automatically, backfill runs.

**Step 2: Verify schema**

Check that existing accounts have `accountType` populated correctly.

**Step 3: Manual smoke test**

- Open dashboard → Overview should show split sections
- Transactions page → type filter should work
- Accounts page → should show two groups
- Trigger a scrape → balance should update for bank accounts, meta should populate for credit cards

**Step 4: Final commit if any fixes needed**
