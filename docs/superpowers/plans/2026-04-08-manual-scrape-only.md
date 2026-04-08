# Manual Scrape Only — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-account `manualScrapeOnly` flag that excludes accounts from scheduled scrapes, with a per-account staleness alert threshold that reminds the user via Telegram when manual-only accounts haven't been scraped recently.

**Architecture:** Two new boolean/integer columns on the `accounts` table. The scheduler's account selection query adds a filter. The post-scrape alert pipeline queries stale manual-only accounts and includes them in the LLM agent's context. Frontend gets a toggle + number input on each account card.

**Tech Stack:** Drizzle ORM (SQLite), Fastify API, Vitest, Vue 3 + reka-ui, Telegram alerts via LLM agent

**Spec:** `docs/superpowers/specs/2026-04-08-manual-scrape-only-design.md`

---

## Chunk 1: Backend — Schema, Migration, API

### Task 1: Add columns to Drizzle schema

**Files:**

- Modify: `src/db/schema.ts:4-19` (accounts table definition)

- [ ] **Step 1: Add the two new columns to the accounts table definition**

In `src/db/schema.ts`, add after the `showBrowser` line (line 13):

```typescript
manualScrapeOnly: integer('manual_scrape_only', { mode: 'boolean' }).notNull().default(false),
stalenessDays: integer('staleness_days'),
```

The full accounts block becomes:

```typescript
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: text('company_id').notNull(),
  displayName: text('display_name').notNull(),
  accountNumber: text('account_number'),
  accountType: text('account_type').notNull().default('bank'),
  balance: real('balance'),
  credentialsRef: text('credentials_ref').notNull(),
  manualLogin: integer('manual_login', { mode: 'boolean' }).notNull().default(false),
  showBrowser: integer('show_browser', { mode: 'boolean' }).notNull().default(false),
  manualScrapeOnly: integer('manual_scrape_only', { mode: 'boolean' }).notNull().default(false),
  stalenessDays: integer('staleness_days'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastScrapedAt: text('last_scraped_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Expected: A new migration file is created in `src/db/migrations/` with two `ALTER TABLE` statements adding the columns.

- [ ] **Step 3: Verify the migration SQL**

Read the generated migration file and confirm it contains:

```sql
ALTER TABLE `accounts` ADD `manual_scrape_only` integer DEFAULT false NOT NULL;
ALTER TABLE `accounts` ADD `staleness_days` integer;
```

- [ ] **Step 4: Run tests to verify nothing is broken**

Run: `npm test`
Expected: All existing tests pass (the new columns have defaults, so no existing data is affected).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add manualScrapeOnly and stalenessDays columns to accounts"
```

---

### Task 2: Update API validation schema

**Files:**

- Modify: `src/api/validation.ts:21-27` (updateAccountSchema)

- [ ] **Step 1: Add the new fields to updateAccountSchema**

In `src/api/validation.ts`, update the `updateAccountSchema` object:

```typescript
export const updateAccountSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  manualLogin: z.boolean().optional(),
  showBrowser: z.boolean().optional(),
  manualScrapeOnly: z.boolean().optional(),
  stalenessDays: z.number().int().min(1).nullable().optional(),
  credentials: z.record(z.string(), z.string()).optional(),
});
```

Note: `stalenessDays` is `.nullable().optional()` — `undefined` means "not included in request", `null` means "clear the value".

- [ ] **Step 2: Commit**

```bash
git add src/api/validation.ts
git commit -m "feat: add manualScrapeOnly and stalenessDays to update account validation"
```

---

### Task 3: Update PUT /api/accounts/:id route handler

**Files:**

- Modify: `src/api/accounts.routes.ts:46-73` (PUT handler)

- [ ] **Step 1: Add the new fields to the destructuring and updateSet**

In the PUT handler, update the destructuring line (currently line 55):

```typescript
const {
  displayName,
  isActive,
  manualLogin,
  showBrowser,
  manualScrapeOnly,
  stalenessDays,
  credentials,
} = data;
```

Add to the `updateSet` building block (after the `showBrowser` line):

```typescript
if (manualScrapeOnly !== undefined) updateSet.manualScrapeOnly = manualScrapeOnly;
if (stalenessDays !== undefined) updateSet.stalenessDays = stalenessDays;
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/api/accounts.routes.ts
git commit -m "feat: handle manualScrapeOnly and stalenessDays in account update route"
```

---

### Task 4: Filter manual-only accounts from scheduled scrapes

**Files:**

- Modify: `src/scraper/session-manager.ts:82-93` (getUniqueActiveAccounts)
- Create: `src/scraper/session-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/scraper/session-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount } from '../__tests__/helpers/fixtures.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
  get sqlite() {
    return testDb.sqlite;
  },
  isDemoMode: () => false,
  closeAll: () => {},
}));

const { getUniqueActiveAccounts } = await import('./session-manager.js');

describe('getUniqueActiveAccounts', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('excludes manual-scrape-only accounts', () => {
    insertAccount(testDb.db, { displayName: 'Regular', manualScrapeOnly: false });
    insertAccount(testDb.db, { displayName: 'Manual Only', manualScrapeOnly: true });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Regular');
  });

  it('excludes inactive accounts', () => {
    insertAccount(testDb.db, { displayName: 'Active', isActive: true });
    insertAccount(testDb.db, { displayName: 'Inactive', isActive: false });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Active');
  });

  it('deduplicates by credentialsRef', () => {
    const ref = 'shared-ref';
    insertAccount(testDb.db, { displayName: 'First', credentialsRef: ref });
    insertAccount(testDb.db, { displayName: 'Second', credentialsRef: ref });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('First');
  });

  it('includes manual-scrape-only=false even if sibling is manual-only (shared credentialsRef)', () => {
    const ref = 'shared-ref';
    insertAccount(testDb.db, {
      displayName: 'Manual',
      credentialsRef: ref,
      manualScrapeOnly: true,
    });
    insertAccount(testDb.db, { displayName: 'Auto', credentialsRef: ref, manualScrapeOnly: false });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Auto');
  });

  it('returns empty array when all accounts are manual-only', () => {
    insertAccount(testDb.db, { manualScrapeOnly: true });
    insertAccount(testDb.db, { manualScrapeOnly: true });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scraper/session-manager.test.ts`
Expected: FAIL — `excludes manual-scrape-only accounts` fails because the filter doesn't exist yet.

- [ ] **Step 3: Update getUniqueActiveAccounts to filter manual-only accounts**

In `src/scraper/session-manager.ts`, update `getUniqueActiveAccounts()`:

```typescript
export function getUniqueActiveAccounts(): Account[] {
  const activeAccounts = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.isActive, true), eq(accounts.manualScrapeOnly, false)))
    .all();
  const seen = new Set<string>();
  const unique: Account[] = [];
  for (const account of activeAccounts) {
    if (!seen.has(account.credentialsRef)) {
      seen.add(account.credentialsRef);
      unique.push(account);
    }
  }
  return unique;
}
```

Add `and` to the drizzle-orm import at the top of the file if not already imported:

```typescript
import { eq, and } from 'drizzle-orm';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scraper/session-manager.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/session-manager.ts src/scraper/session-manager.test.ts
git commit -m "feat: exclude manual-scrape-only accounts from scheduled scrapes"
```

---

## Chunk 2: Backend — Staleness Alerts

### Task 5: Add staleness check to post-scrape alerts

**Files:**

- Modify: `src/telegram/alerts.ts:70-117` (buildPostScrapeUserMessage), `src/telegram/alerts.ts:149-174` (runPostScrapeAlerts)
- Modify: `src/telegram/alerts.test.ts`

- [ ] **Step 1: Write the failing test for stale accounts in the alert message**

In `src/telegram/alerts.test.ts`, make these changes:

**a) Update the vitest import at line 1** — add `afterAll`:

```typescript
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
```

**b) Add new imports at the top of the file** (after the vitest import, before the mock blocks):

```typescript
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount } from '../__tests__/helpers/fixtures.js';
```

**c) Add a `testDb` variable and db mock** — add after the existing mock blocks (before `const { registerSendMessage, ... } = await import('./alerts.js');`):

```typescript
// ── Mock db/connection for stale account queries ──
let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
  get sqlite() {
    return testDb.sqlite;
  },
  isDemoMode: () => false,
  closeAll: () => {},
}));
```

**d) Update the `beforeEach`** — add `testDb = createTestDb()` as the first line:

```typescript
beforeEach(() => {
  testDb = createTestDb();
  sentMessages = [];
  alertsSent = [];
  mockSendMessage.mockClear();
  mockOnAlertSent.mockClear();
  mockGetChatIds.mockClear();
  mockRunAlertAgent.mockClear();
  mockDetectRecurring.mockClear();
  mockGetNetWorth.mockClear();
  resetMockSettings();
  mockGetChatIds.mockReturnValue([12345]);
  mockGetNetWorth.mockResolvedValue({ total: 500000 });
});
```

**e) Add `afterAll`** — after the `beforeEach` block:

```typescript
afterAll(() => {
  testDb?.close();
});
```

Then add this test inside the `runPostScrapeAlerts` describe block:

```typescript
it('includes stale manual-only accounts in the alert message', async () => {
  // Insert a manual-only account that was last scraped 10 days ago
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  insertAccount(testDb.db, {
    displayName: 'Stale Isracard',
    manualScrapeOnly: true,
    stalenessDays: 7,
    isActive: true,
    lastScrapedAt: tenDaysAgo.toISOString(),
  });

  // Insert a manual-only account that is NOT stale
  insertAccount(testDb.db, {
    displayName: 'Fresh Amex',
    manualScrapeOnly: true,
    stalenessDays: 7,
    isActive: true,
    lastScrapedAt: new Date().toISOString(),
  });

  mockRunAlertAgent.mockResolvedValue('Alert message');

  await runPostScrapeAlerts([
    { accountId: 99, success: true, transactionsFound: 5, transactionsNew: 2 },
  ]);

  const userMessage = mockRunAlertAgent.mock.calls[0][0].userMessage;
  expect(userMessage).toContain('stale-manual-accounts');
  expect(userMessage).toContain('Stale Isracard');
  expect(userMessage).toContain('Remind the user to manually scrape');
  expect(userMessage).not.toContain('Fresh Amex');
});

it('shows "none" for stale accounts when no manual-only accounts are stale', async () => {
  mockRunAlertAgent.mockResolvedValue('Alert message');

  await runPostScrapeAlerts([
    { accountId: 99, success: true, transactionsFound: 5, transactionsNew: 2 },
  ]);

  const userMessage = mockRunAlertAgent.mock.calls[0][0].userMessage;
  expect(userMessage).toContain('<stale-manual-accounts>\nnone\n</stale-manual-accounts>');
});

it('does not alert for manual-only accounts with stalenessDays = null', async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  insertAccount(testDb.db, {
    displayName: 'No Alert Account',
    manualScrapeOnly: true,
    stalenessDays: null,
    isActive: true,
    lastScrapedAt: thirtyDaysAgo.toISOString(),
  });

  mockRunAlertAgent.mockResolvedValue('Alert message');

  await runPostScrapeAlerts([
    { accountId: 99, success: true, transactionsFound: 5, transactionsNew: 2 },
  ]);

  const userMessage = mockRunAlertAgent.mock.calls[0][0].userMessage;
  expect(userMessage).not.toContain('No Alert Account');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/telegram/alerts.test.ts`
Expected: FAIL — the new tests fail because `buildPostScrapeUserMessage` doesn't include stale accounts yet.

- [ ] **Step 3: Implement getStaleManualAccounts and update the alert pipeline**

In `src/telegram/alerts.ts`, add the import for db and schema at the top:

```typescript
import { db } from '../db/connection.js';
import { accounts } from '../db/schema.js';
import { and, eq, isNotNull } from 'drizzle-orm';
```

Add the `getStaleManualAccounts` function (before `buildPostScrapeUserMessage`):

```typescript
interface StaleAccountInfo {
  id: number;
  displayName: string;
  daysSinceLastScrape: number | null; // null = never scraped
  stalenessDays: number;
}

export function getStaleManualAccounts(): StaleAccountInfo[] {
  const manualAccounts = db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.manualScrapeOnly, true),
        eq(accounts.isActive, true),
        isNotNull(accounts.stalenessDays),
      ),
    )
    .all();

  const now = new Date();
  const stale: StaleAccountInfo[] = [];

  for (const account of manualAccounts) {
    const threshold = account.stalenessDays!;
    let daysSince: number | null = null;

    if (account.lastScrapedAt) {
      const lastScraped = new Date(account.lastScrapedAt);
      daysSince = Math.floor((now.getTime() - lastScraped.getTime()) / (1000 * 60 * 60 * 24));
    }

    if (daysSince === null || daysSince > threshold) {
      stale.push({
        id: account.id,
        displayName: account.displayName,
        daysSinceLastScrape: daysSince,
        stalenessDays: threshold,
      });
    }
  }

  return stale;
}
```

Update `buildPostScrapeUserMessage` to accept and render stale accounts:

```typescript
function buildPostScrapeUserMessage(
  scrapeResults: ScrapeResult[],
  settings: AlertSettings,
  staleAccounts: StaleAccountInfo[],
): string {
```

Add the stale accounts section before the closing `<task>` block:

```typescript
const staleLines =
  staleAccounts.length > 0
    ? staleAccounts
        .map(
          (a) =>
            `  - "${a.displayName}" (id: ${a.id}) — ${a.daysSinceLastScrape === null ? 'never scraped' : `last scraped ${a.daysSinceLastScrape} days ago`} (threshold: ${a.stalenessDays} days)`,
        )
        .join('\n')
    : 'none';
```

Insert the section before `<task>`:

```
<stale-manual-accounts>
${staleAccounts.length > 0 ? 'The following accounts are marked "manual scrape only" and have exceeded their staleness threshold:\n' + staleLines + '\nRemind the user to manually scrape these accounts.' : 'none'}
</stale-manual-accounts>

```

Update `runPostScrapeAlerts` to call `getStaleManualAccounts()` and pass it through:

```typescript
export async function runPostScrapeAlerts(scrapeResults: ScrapeResult[]): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  try {
    const systemPrompt = withMemory(buildPostScrapeAlertPrompt());
    const staleAccounts = getStaleManualAccounts();
    const userMessage = buildPostScrapeUserMessage(scrapeResults, settings, staleAccounts);
    const message = await runAlertAgent({ systemPrompt, userMessage });

    if (message) {
      await sendAlert(
        chatIds,
        message,
        'A bank/credit-card scrape just completed and new transactions were found. The following is an automated financial alert.',
      );
    }
  } catch (err) {
    console.error('[Alerts] Post-scrape agent failed:', err instanceof Error ? err.message : err);
  }

  // Always update internal state regardless of agent outcome
  await updateInternalState();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/telegram/alerts.test.ts`
Expected: All tests PASS (including the 3 new ones).

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/telegram/alerts.ts src/telegram/alerts.test.ts
git commit -m "feat: include stale manual-only accounts in post-scrape alerts"
```

---

## Chunk 3: Frontend — API Client and UI

### Task 6: Update frontend Account interface and API client

**Files:**

- Modify: `dashboard/src/api/client.ts:47-59` (Account interface)
- Modify: `dashboard/src/api/client.ts:73-87` (updateAccount function)

- [ ] **Step 1: Add the new fields to the Account interface**

In `dashboard/src/api/client.ts`, add after `showBrowser: boolean;`:

```typescript
manualScrapeOnly: boolean;
stalenessDays: number | null;
```

- [ ] **Step 2: Add the new fields to the updateAccount function type**

In the `updateAccount` function's `data` parameter type, add:

```typescript
manualScrapeOnly?: boolean;
stalenessDays?: number | null;
```

The full data type becomes:

```typescript
data: {
  displayName?: string;
  isActive?: boolean;
  manualLogin?: boolean;
  showBrowser?: boolean;
  manualScrapeOnly?: boolean;
  stalenessDays?: number | null;
  credentials?: Record<string, string>;
},
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd dashboard && npx vue-tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add manualScrapeOnly and stalenessDays to frontend Account type"
```

---

### Task 7: Add Manual Scrape Only toggle and staleness input to account cards

**Files:**

- Modify: `dashboard/src/components/AccountManager.vue:326-345` (toggles section)

- [ ] **Step 1: Add the toggle and conditional staleness input**

In `AccountManager.vue`, find the toggles `div` (the one containing the `manualLogin` and `showBrowser` switches). Add a new `manualScrapeOnly` toggle and a conditional staleness days input after the existing toggles, inside the same container `div`:

```html
<label class="flex items-center gap-2 text-[12px] text-text-secondary">
  <Switch
    :model-value="account.manualScrapeOnly"
    @update:model-value="patchAccount(account.id, { manualScrapeOnly: $event })"
  />
  Manual scrape only
</label>
```

Then, after the closing `</div>` of the toggles row, add a conditional staleness input that shows when `manualScrapeOnly` is true:

```html
<div v-if="account.manualScrapeOnly" class="flex items-center gap-2 mt-2">
  <label class="text-[12px] text-text-secondary whitespace-nowrap">
    Alert if not scraped for
  </label>
  <input
    type="number"
    :model-value="account.stalenessDays ?? undefined"
    placeholder="No alert"
    min="1"
    class="w-20 h-7 text-xs"
    @change="patchAccount(account.id, { stalenessDays: $event.target.value ? Number($event.target.value) : null })"
  />
  <span class="text-[12px] text-text-secondary">days</span>
</div>
```

- [ ] **Step 2: Verify the Input component is imported**

Check if `Input` is already imported in the component's script section. If not, add to the imports from the UI library (it should already be imported since it's used for the inline name edit).

- [ ] **Step 3: Verify it compiles**

Run: `cd dashboard && npx vue-tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Manual testing**

Open the app in the browser. On an account card:

1. Toggle "Manual scrape only" ON — verify the staleness input appears
2. Enter `7` in the staleness input — verify it saves (check network tab for PUT request)
3. Clear the input — verify it sends `stalenessDays: null`
4. Toggle "Manual scrape only" OFF — verify the input disappears

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/AccountManager.vue
git commit -m "feat: add manual scrape only toggle and staleness input to account cards"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run TypeScript check on both backend and frontend**

Run: `npx tsc --noEmit && cd dashboard && npx vue-tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: No lint errors.

- [ ] **Step 4: Final commit if any formatting changes from lint**

```bash
git add -A && git commit -m "chore: fix formatting"
```
