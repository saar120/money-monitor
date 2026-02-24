# Phase 2: Scraping Core

**Goal:** Implement the scraper service that wraps `israeli-bank-scrapers`, deduplicates transactions, and stores them in the DB. Add API routes to trigger scrapes manually, and a cron-based scheduler pinned to Israel timezone.

**Prerequisites:** Phase 1 complete — DB, config, credential store, and Fastify server are all working.

---

## Task 2.1 — Scraper Service

### File: `src/scraper/scraper.service.ts`

This module wraps `israeli-bank-scrapers`. It:
1. Takes an account record + decrypted credentials
2. Creates a scraper instance via `createScraper`
3. Runs the scrape
4. Deduplicates transactions using a hash (date + chargedAmount + description + accountId)
5. Upserts new transactions into the DB
6. Updates the account's `lastScrapedAt`
7. Writes a scrape log entry

```typescript
import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions, scrapeLogs } from '../db/schema.js';
import { getCredentials } from './credential-store.js';
import { config } from '../config.js';
import type { Account, ScraperTransaction, NewTransaction } from '../shared/types.js';

function computeHash(accountId: number, txn: ScraperTransaction): string {
  const raw = `${accountId}:${txn.date}:${txn.chargedAmount}:${txn.description}`;
  return createHash('sha256').update(raw).digest('hex');
}

function mapTransaction(accountId: number, txn: ScraperTransaction): NewTransaction {
  return {
    accountId,
    identifier: txn.identifier ?? null,
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
    hash: computeHash(accountId, txn),
  };
}

export interface ScrapeResult {
  success: boolean;
  accountId: number;
  transactionsFound: number;
  transactionsNew: number;
  error?: string;
  errorType?: string;
}

export async function scrapeAccount(account: Account): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();

  // Get credentials
  const credentials = getCredentials(account.credentialsRef);
  if (!credentials) {
    const errorResult = {
      success: false,
      accountId: account.id,
      transactionsFound: 0,
      transactionsNew: 0,
      error: `No credentials found for ref: ${account.credentialsRef}`,
      errorType: 'MISSING_CREDENTIALS',
    };
    db.insert(scrapeLogs).values({
      accountId: account.id,
      status: 'error',
      errorType: 'MISSING_CREDENTIALS',
      errorMessage: errorResult.error,
      transactionsFound: 0,
      startedAt,
      completedAt: new Date().toISOString(),
    }).run();
    return errorResult;
  }

  // Calculate start date
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - config.SCRAPE_START_DATE_MONTHS_BACK);

  try {
    // Create and run scraper
    const scraper = createScraper({
      companyId: CompanyTypes[account.companyId as keyof typeof CompanyTypes],
      startDate,
      combineInstallments: false,
      showBrowser: false,
    });

    const result = await scraper.scrape(credentials);

    if (!result.success) {
      db.insert(scrapeLogs).values({
        accountId: account.id,
        status: 'error',
        errorType: result.errorType ?? 'UNKNOWN_ERROR',
        errorMessage: result.errorMessage ?? 'Scrape failed',
        transactionsFound: 0,
        startedAt,
        completedAt: new Date().toISOString(),
      }).run();

      return {
        success: false,
        accountId: account.id,
        transactionsFound: 0,
        transactionsNew: 0,
        error: result.errorMessage,
        errorType: result.errorType,
      };
    }

    // Process all accounts returned by the scraper
    let totalFound = 0;
    let totalNew = 0;

    for (const scraperAccount of result.accounts ?? []) {
      // Update account number if we got one
      if (scraperAccount.accountNumber && !account.accountNumber) {
        db.update(accounts)
          .set({ accountNumber: scraperAccount.accountNumber })
          .where(eq(accounts.id, account.id))
          .run();
      }

      const txns = scraperAccount.txns ?? [];
      totalFound += txns.length;

      for (const txn of txns) {
        const mapped = mapTransaction(account.id, txn);
        try {
          db.insert(transactions)
            .values(mapped)
            .onConflictDoNothing({ target: transactions.hash })
            .run();
          totalNew++;
        } catch {
          // Hash conflict = duplicate, skip silently
        }
      }
    }

    // Update lastScrapedAt
    db.update(accounts)
      .set({ lastScrapedAt: new Date().toISOString() })
      .where(eq(accounts.id, account.id))
      .run();

    // Log success
    db.insert(scrapeLogs).values({
      accountId: account.id,
      status: 'success',
      transactionsFound: totalFound,
      startedAt,
      completedAt: new Date().toISOString(),
    }).run();

    return {
      success: true,
      accountId: account.id,
      transactionsFound: totalFound,
      transactionsNew: totalNew,
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    db.insert(scrapeLogs).values({
      accountId: account.id,
      status: 'error',
      errorType: 'EXCEPTION',
      errorMessage,
      transactionsFound: 0,
      startedAt,
      completedAt: new Date().toISOString(),
    }).run();

    return {
      success: false,
      accountId: account.id,
      transactionsFound: 0,
      transactionsNew: 0,
      error: errorMessage,
      errorType: 'EXCEPTION',
    };
  }
}

/**
 * Scrape all active accounts sequentially.
 */
export async function scrapeAllAccounts(): Promise<ScrapeResult[]> {
  const activeAccounts = db
    .select()
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .all();

  const results: ScrapeResult[] = [];
  for (const account of activeAccounts) {
    const result = await scrapeAccount(account);
    results.push(result);
  }
  return results;
}
```

### Key Design Decisions
- **Sequential scraping**: One account at a time — puppeteer is resource-heavy
- **Hash-based dedup**: SHA-256 of `accountId:date:chargedAmount:description`
- **`onConflictDoNothing`**: If the hash already exists, silently skip the duplicate
- **Account number**: Auto-populated from the first successful scrape

### Acceptance Criteria
- `scrapeAccount()` creates scraper with correct options
- Duplicate transactions (same hash) are not inserted twice
- `scrape_logs` entry is created for every attempt (success or failure)
- `accounts.lastScrapedAt` is updated on success
- `accounts.accountNumber` is populated from scraper result if null

---

## Task 2.2 — Scrape API Routes

### File: `src/api/scrape.routes.ts`

Registers three routes on the Fastify instance:

```typescript
import type { FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, scrapeLogs } from '../db/schema.js';
import { scrapeAccount, scrapeAllAccounts } from '../scraper/scraper.service.js';

export async function scrapeRoutes(app: FastifyInstance) {

  // POST /api/scrape/:accountId — trigger scrape for one account
  app.post<{ Params: { accountId: string } }>('/api/scrape/:accountId', async (request, reply) => {
    const accountId = parseInt(request.params.accountId, 10);
    if (isNaN(accountId)) {
      return reply.status(400).send({ error: 'Invalid account ID' });
    }

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    const result = await scrapeAccount(account);
    return reply.status(result.success ? 200 : 500).send(result);
  });

  // POST /api/scrape/all — trigger scrape for all active accounts
  app.post('/api/scrape/all', async (_request, reply) => {
    const results = await scrapeAllAccounts();
    return reply.send({ results });
  });

  // GET /api/scrape/logs — recent scrape history
  app.get<{
    Querystring: { accountId?: string; limit?: string }
  }>('/api/scrape/logs', async (request, reply) => {
    const limit = parseInt(request.query.limit ?? '50', 10);
    const accountIdParam = request.query.accountId;

    let query = db.select().from(scrapeLogs).orderBy(desc(scrapeLogs.startedAt)).limit(limit);

    if (accountIdParam) {
      const accountId = parseInt(accountIdParam, 10);
      query = db.select().from(scrapeLogs)
        .where(eq(scrapeLogs.accountId, accountId))
        .orderBy(desc(scrapeLogs.startedAt))
        .limit(limit);
    }

    const logs = query.all();
    return reply.send({ logs });
  });
}
```

### Register in `src/index.ts`

Add the following after CORS registration:

```typescript
import { scrapeRoutes } from './api/scrape.routes.js';

await app.register(scrapeRoutes);
```

### Acceptance Criteria
- `POST /api/scrape/123` triggers a scrape for account 123
- `POST /api/scrape/all` scrapes all active accounts sequentially
- `GET /api/scrape/logs` returns recent scrape logs (default limit 50)
- `GET /api/scrape/logs?accountId=1&limit=10` filters by account
- Invalid account IDs return 400, missing accounts return 404

---

## Task 2.3 — Cron Scheduler

### File: `src/scraper/scheduler.ts`

Uses `node-cron` with the `timezone` option set to `Asia/Jerusalem`.

```typescript
import cron from 'node-cron';
import { config } from '../config.js';
import { scrapeAllAccounts } from './scraper.service.js';

let scheduledTask: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  if (scheduledTask) {
    console.log('[Scheduler] Already running, skipping start');
    return;
  }

  const cronExpression = config.SCRAPE_CRON;
  const timezone = config.SCRAPE_TIMEZONE;

  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: ${cronExpression}`);
    return;
  }

  console.log(`[Scheduler] Starting with schedule "${cronExpression}" (timezone: ${timezone})`);

  scheduledTask = cron.schedule(cronExpression, async () => {
    console.log(`[Scheduler] Triggered at ${new Date().toISOString()}`);
    try {
      const results = await scrapeAllAccounts();
      const successes = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success).length;
      console.log(`[Scheduler] Completed: ${successes} succeeded, ${failures} failed`);
    } catch (err) {
      console.error('[Scheduler] Unhandled error during scheduled scrape:', err);
    }
  }, {
    timezone,
  });
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Stopped');
  }
}
```

### Register in `src/index.ts`

Add the following after route registration:

```typescript
import { startScheduler } from './scraper/scheduler.js';

// Start cron scheduler after server is listening
startScheduler();
```

### Important: `node-cron` timezone support

`node-cron` supports the `timezone` option natively. Passing `{ timezone: 'Asia/Jerusalem' }` ensures the cron expression is evaluated in Israel time, regardless of the server's system timezone.

### Acceptance Criteria
- Scheduler starts when the server boots
- Cron expression from `SCRAPE_CRON` env var is used
- Timezone is `Asia/Jerusalem` (from `SCRAPE_TIMEZONE` env var)
- Invalid cron expressions are rejected with an error log (not a crash)
- `stopScheduler()` cleanly stops the cron job

---

## Final Verification

```bash
# Start server — should see scheduler start message
npm run dev
# → [Scheduler] Starting with schedule "0 6 * * *" (timezone: Asia/Jerusalem)

# Trigger manual scrape (will fail without real credentials, but route should respond)
curl -X POST http://localhost:3000/api/scrape/all
# → { "results": [] }  (no active accounts yet)

# Check scrape logs
curl http://localhost:3000/api/scrape/logs
# → { "logs": [] }
```

---

## Files Created in This Phase

```
src/
├── scraper/
│   ├── scraper.service.ts    (NEW)
│   └── scheduler.ts          (NEW)
├── api/
│   └── scrape.routes.ts      (NEW)
└── index.ts                   (MODIFIED — register routes + scheduler)
```
