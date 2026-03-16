# Latest Scrape Transactions — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Telegram chat bot answer "what was scraped?" by linking new transactions to their scrape session and exposing a `get_latest_scrape_transactions` tool.

**Architecture:** Add a nullable `scrapeSessionId` FK column on `transactions` pointing to `scrapeSessions.id`. The scraper populates it on insert. A new zero-parameter AI tool queries the latest completed session's transactions and returns them to the LLM.

**Tech Stack:** Drizzle ORM, SQLite, TypeBox (for tool parameter schemas), pi-agent-core (tool adapter pattern)

**Spec:** `docs/superpowers/specs/2026-03-16-latest-scrape-transactions-design.md`

---

## Chunk 1: Schema + Scraper Changes

### Task 1: Add `scrapeSessionId` column to schema

**Files:**

- Modify: `src/db/schema.ts:19-51` (transactions table definition)

- [ ] **Step 1: Add the column and index to the schema**

In `src/db/schema.ts`, add `scrapeSessionId` to the `transactions` table definition and add an index:

```typescript
// Add after the `createdAt` column (line 41), before the closing `}, (table) => [`
scrapeSessionId: integer('scrape_session_id').references(() => scrapeSessions.id),
```

And add an index in the table's index function (after the existing indexes):

```typescript
index('idx_transactions_scrape_session_id').on(table.scrapeSessionId),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Expected: A new migration file is created in `src/db/migrations/` with an `ALTER TABLE transactions ADD COLUMN scrape_session_id` and `CREATE INDEX` statement.

**Important:** Do NOT hand-write the migration. Do NOT edit `_journal.json`. Only use `drizzle-kit generate`.

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx vitest run src/db/schema.test.ts`

Expected: All tests pass. The new nullable column doesn't break existing inserts since `insertTransaction` in fixtures doesn't set it (and it defaults to null).

- [ ] **Step 4: Add a schema test for the new column**

In `src/db/schema.test.ts`, add inside the "default values" describe block:

```typescript
it('sets scrapeSessionId to null by default for transactions', () => {
  const account = insertAccount(testDb.db);
  const tx = insertTransaction(testDb.db, account.id);
  expect(tx.scrapeSessionId).toBeNull();
});
```

- [ ] **Step 5: Run the new test**

Run: `npx vitest run src/db/schema.test.ts`

Expected: All tests pass, including the new one.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations/ src/db/schema.test.ts
git commit -m "feat: add scrapeSessionId column to transactions table"
```

---

### Task 2: Populate `scrapeSessionId` in the scraper

**Files:**

- Modify: `src/scraper/scraper.service.ts:302-308` (transaction insert site)

- [ ] **Step 1: Set `scrapeSessionId` at the insert callsite**

In `src/scraper/scraper.service.ts`, find the insert block inside the `for (const txn of txns)` loop (around line 302-308):

```typescript
        const mapped = mapTransaction(targetAccount.id, txn);
        try {
          const insertResult = db
            .insert(transactions)
            .values(mapped)
            .onConflictDoNothing({ target: transactions.hash })
            .run();
```

Change `.values(mapped)` to `.values({ ...mapped, scrapeSessionId: sessionId ?? null })`:

```typescript
        const mapped = mapTransaction(targetAccount.id, txn);
        try {
          const insertResult = db
            .insert(transactions)
            .values({ ...mapped, scrapeSessionId: sessionId ?? null })
            .onConflictDoNothing({ target: transactions.hash })
            .run();
```

This sets the FK for new transactions. Duplicate transactions (hash conflict) are unaffected since they're skipped.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors. `sessionId` is `number | undefined` (from the function parameter), and the column is nullable, so `sessionId ?? null` is valid.

- [ ] **Step 3: Commit**

```bash
git add src/scraper/scraper.service.ts
git commit -m "feat: populate scrapeSessionId when inserting new transactions"
```

---

## Chunk 2: New Tool + Registration

### Task 3: Create the `get_latest_scrape_transactions` tool

**Files:**

- Modify: `src/ai/tools.ts` (add new tool builder + implementation function)

- [ ] **Step 1: Add imports**

At the top of `src/ai/tools.ts`:

1. Update the schema import (line 5) from `import { accounts } from '../db/schema.js'` to:

```typescript
import { accounts, transactions, scrapeSessions, scrapeLogs } from '../db/schema.js';
```

2. Update the drizzle-orm import (line 3) from `import { sql } from 'drizzle-orm'` to:

```typescript
import { sql, eq, desc } from 'drizzle-orm';
```

- [ ] **Step 2: Add the implementation function**

Add this function at the bottom of `src/ai/tools.ts`, in the "Direct DB query" section (after `getAccountBalances`):

```typescript
export function getLatestScrapeTransactions(): string {
  // 1. Find latest completed session
  const session = db
    .select()
    .from(scrapeSessions)
    .where(eq(scrapeSessions.status, 'completed'))
    .orderBy(desc(scrapeSessions.completedAt))
    .limit(1)
    .get();

  if (!session) {
    return JSON.stringify({ error: 'No completed scrape sessions found' });
  }

  // 2. Get per-account stats from scrape logs
  const logs = db
    .select({
      accountId: scrapeLogs.accountId,
      displayName: accounts.displayName,
      status: scrapeLogs.status,
      transactionsFound: scrapeLogs.transactionsFound,
      transactionsNew: scrapeLogs.transactionsNew,
      errorType: scrapeLogs.errorType,
      errorMessage: scrapeLogs.errorMessage,
    })
    .from(scrapeLogs)
    .leftJoin(accounts, eq(scrapeLogs.accountId, accounts.id))
    .where(eq(scrapeLogs.sessionId, session.id))
    .all();

  // 3. Get new transactions from this session (with account name)
  const MAX_TRANSACTIONS = 200;
  const newTxns = db
    .select({
      id: transactions.id,
      date: transactions.date,
      chargedAmount: transactions.chargedAmount,
      description: transactions.description,
      category: transactions.category,
      memo: transactions.memo,
      accountName: accounts.displayName,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(eq(transactions.scrapeSessionId, session.id))
    .orderBy(desc(transactions.date))
    .limit(MAX_TRANSACTIONS + 1)
    .all();

  const truncated = newTxns.length > MAX_TRANSACTIONS;
  const txnsToReturn = truncated ? newTxns.slice(0, MAX_TRANSACTIONS) : newTxns;

  // 4. Count total if truncated
  const totalNew = truncated
    ? db
        .select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(eq(transactions.scrapeSessionId, session.id))
        .get()!.count
    : newTxns.length;

  return JSON.stringify({
    session: {
      id: session.id,
      trigger: session.trigger,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    },
    accounts: logs.map((l) => ({
      accountId: l.accountId,
      displayName: l.displayName,
      status: l.status,
      transactionsFound: l.transactionsFound,
      transactionsNew: l.transactionsNew,
      ...(l.errorType ? { errorType: l.errorType, errorMessage: l.errorMessage } : {}),
    })),
    newTransactions: txnsToReturn,
    totalNew,
    ...(truncated ? { truncated: true } : {}),
  });
}
```

- [ ] **Step 3: Add the tool builder function**

Add in the "Individual tool builders" section of `src/ai/tools.ts`:

```typescript
export function buildGetLatestScrapeTransactionsTool() {
  return createAgentTool({
    name: 'get_latest_scrape_transactions',
    description:
      "Get all transactions that were newly found in the latest scrape session. Use this when the user asks what was scraped, what's new, or what transactions were found.",
    label: 'Looking up latest scrape results',
    parameters: Type.Object({}),
    execute: async () => getLatestScrapeTransactions(),
  });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools.ts
git commit -m "feat: add get_latest_scrape_transactions tool"
```

---

### Task 4: Register the tool in chat and alert agents

**Files:**

- Modify: `src/ai/agent.ts:19-31` (imports), `src/ai/agent.ts:109-131` (TOOL_STATUS), `src/ai/agent.ts:200-222` (tools array)
- Modify: `src/ai/alert-agent.ts:1-13` (imports), `src/ai/alert-agent.ts:23-36` (buildAlertTools)

- [ ] **Step 1: Register in chat agent**

In `src/ai/agent.ts`:

1. Add to imports (around line 20):

```typescript
import {
  // ... existing imports ...
  buildGetLatestScrapeTransactionsTool,
} from './tools.js';
```

2. Add to `TOOL_STATUS` map (around line 131):

```typescript
get_latest_scrape_transactions: 'Looking up latest scrape results...',
```

3. Add to the `tools` array in the `chat()` function (around line 221, before the alert tools):

```typescript
buildGetLatestScrapeTransactionsTool(),
```

- [ ] **Step 2: Register in alert agent**

In `src/ai/alert-agent.ts`:

1. Add to imports:

```typescript
import {
  // ... existing imports ...
  buildGetLatestScrapeTransactionsTool,
} from './tools.js';
```

2. Add to `buildAlertTools()` return array:

```typescript
buildGetLatestScrapeTransactionsTool(),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/ai/agent.ts src/ai/alert-agent.ts
git commit -m "feat: register get_latest_scrape_transactions in chat and alert agents"
```

---

### Task 5: Add prompt hint

**Files:**

- Modify: `src/ai/prompts.ts:56-91` (buildFinancialAdvisorPrompt)

- [ ] **Step 1: Add the hint to the financial advisor prompt**

In `src/ai/prompts.ts`, in the `buildFinancialAdvisorPrompt` function, add this line right after the "Spending Analysis" paragraph (after `"Use tables for comparative data."`):

```typescript
**Latest Scrape Results** — When the user asks what was scraped, what's new, or what transactions were found in the latest scrape, use the \`get_latest_scrape_transactions\` tool. Do NOT guess or search by date — use this tool for precise results.
```

This goes inside the template literal, as a new paragraph after the spending analysis section.

- [ ] **Step 2: Run prompt tests**

Run: `npx vitest run src/ai/prompts.test.ts`

Expected: All tests pass. If any test snapshots check prompt content, update them.

- [ ] **Step 3: Commit**

```bash
git add src/ai/prompts.ts
git commit -m "feat: add prompt hint for get_latest_scrape_transactions tool"
```

---

## Chunk 3: Testing

### Task 6: Add tool unit test

**Files:**

- Create: `src/ai/tools.test.ts`

This test validates the `getLatestScrapeTransactions()` function directly against an in-memory DB, following the same pattern as `src/db/schema.test.ts`.

- [ ] **Step 1: Write the test file**

Create `src/ai/tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';

// We need to mock `../db/connection.js` so that the tools module uses our test DB.
// The tools module imports `db` from `../db/connection.js` at the top level.
let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
}));

// Import after mocking so the module picks up our mock
const { getLatestScrapeTransactions } = await import('./tools.js');

function insertSession(overrides: Partial<typeof schema.scrapeSessions.$inferInsert> = {}) {
  return testDb.db
    .insert(schema.scrapeSessions)
    .values({
      trigger: 'manual',
      status: 'completed',
      accountIds: '[]',
      startedAt: '2026-03-16T08:00:00Z',
      completedAt: '2026-03-16T08:02:00Z',
      ...overrides,
    })
    .returning()
    .get();
}

function insertScrapeLog(
  accountId: number,
  sessionId: number,
  overrides: Partial<typeof schema.scrapeLogs.$inferInsert> = {},
) {
  return testDb.db
    .insert(schema.scrapeLogs)
    .values({
      accountId,
      sessionId,
      status: 'success',
      transactionsFound: 10,
      transactionsNew: 2,
      ...overrides,
    })
    .returning()
    .get();
}

describe('getLatestScrapeTransactions', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('returns error when no completed sessions exist', () => {
    const result = JSON.parse(getLatestScrapeTransactions());
    expect(result).toEqual({ error: 'No completed scrape sessions found' });
  });

  it('ignores non-completed sessions', () => {
    insertSession({ status: 'running' });
    insertSession({ status: 'error' });

    const result = JSON.parse(getLatestScrapeTransactions());
    expect(result).toEqual({ error: 'No completed scrape sessions found' });
  });

  it('returns the latest completed session with its transactions', () => {
    const account = insertAccount(testDb.db);

    // Older session
    const oldSession = insertSession({
      completedAt: '2026-03-15T08:00:00Z',
    });
    insertTransaction(testDb.db, account.id, {
      description: 'Old Txn',
      scrapeSessionId: oldSession.id,
    });

    // Latest session
    const newSession = insertSession({
      completedAt: '2026-03-16T08:00:00Z',
    });
    insertScrapeLog(account.id, newSession.id, {
      transactionsFound: 5,
      transactionsNew: 1,
    });
    insertTransaction(testDb.db, account.id, {
      description: 'New Txn',
      scrapeSessionId: newSession.id,
    });

    const result = JSON.parse(getLatestScrapeTransactions());

    expect(result.session.id).toBe(newSession.id);
    expect(result.newTransactions).toHaveLength(1);
    expect(result.newTransactions[0].description).toBe('New Txn');
    expect(result.newTransactions[0].accountName).toBe('Test Bank');
    expect(result.totalNew).toBe(1);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].transactionsNew).toBe(1);
  });

  it('returns session info with zero transactions when all were duplicates', () => {
    const account = insertAccount(testDb.db);
    const session = insertSession();
    insertScrapeLog(account.id, session.id, {
      transactionsFound: 10,
      transactionsNew: 0,
    });
    // No transactions linked to this session

    const result = JSON.parse(getLatestScrapeTransactions());

    expect(result.session.id).toBe(session.id);
    expect(result.newTransactions).toHaveLength(0);
    expect(result.totalNew).toBe(0);
  });

  it('includes error info for failed accounts in a multi-account session', () => {
    const goodAccount = insertAccount(testDb.db, { displayName: 'Good Bank' });
    const badAccount = insertAccount(testDb.db, { displayName: 'Bad Bank' });
    const session = insertSession();

    insertScrapeLog(goodAccount.id, session.id, {
      status: 'success',
      transactionsFound: 5,
      transactionsNew: 2,
    });
    insertScrapeLog(badAccount.id, session.id, {
      status: 'error',
      transactionsFound: 0,
      transactionsNew: 0,
      errorType: 'TIMEOUT',
      errorMessage: 'Login timed out',
    });
    insertTransaction(testDb.db, goodAccount.id, {
      scrapeSessionId: session.id,
    });

    const result = JSON.parse(getLatestScrapeTransactions());

    expect(result.accounts).toHaveLength(2);
    const errorAccount = result.accounts.find(
      (a: { displayName: string }) => a.displayName === 'Bad Bank',
    );
    expect(errorAccount.status).toBe('error');
    expect(errorAccount.errorType).toBe('TIMEOUT');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/ai/tools.test.ts`

Expected: All 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/ai/tools.test.ts
git commit -m "test: add unit tests for getLatestScrapeTransactions"
```

---

### Task 7: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Final commit if any fixups were needed**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address test/type issues from latest-scrape-transactions feature"
```
