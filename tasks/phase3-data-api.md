# Phase 3: Data API

**Goal:** Implement CRUD routes for accounts and read-only routes for transactions with filtering, pagination, and aggregated summaries.

**Prerequisites:** Phase 1 + 2 complete — DB, credential store, scraper service, and Fastify server are all working.

---

## Task 3.1 — Accounts CRUD Routes

### File: `src/api/accounts.routes.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions } from '../db/schema.js';
import { setCredentials, deleteCredentials } from '../scraper/credential-store.js';
import { COMPANY_IDS } from '../shared/types.js';
import { randomUUID } from 'node:crypto';

export async function accountsRoutes(app: FastifyInstance) {

  // GET /api/accounts — list all accounts (never expose credentials)
  app.get('/api/accounts', async (_request, reply) => {
    const rows = db.select().from(accounts).all();
    return reply.send({ accounts: rows });
  });

  // POST /api/accounts — add a new account
  app.post<{
    Body: {
      companyId: string;
      displayName: string;
      credentials: Record<string, string>;
    }
  }>('/api/accounts', async (request, reply) => {
    const { companyId, displayName, credentials } = request.body;

    // Validate companyId
    if (!COMPANY_IDS.includes(companyId as any)) {
      return reply.status(400).send({
        error: `Invalid companyId. Must be one of: ${COMPANY_IDS.join(', ')}`,
      });
    }

    if (!displayName || !credentials || Object.keys(credentials).length === 0) {
      return reply.status(400).send({ error: 'displayName and credentials are required' });
    }

    // Store credentials with a unique ref
    const credentialsRef = randomUUID();
    setCredentials(credentialsRef, credentials);

    // Insert account
    const result = db.insert(accounts).values({
      companyId,
      displayName,
      credentialsRef,
    }).returning().get();

    return reply.status(201).send({ account: result });
  });

  // PUT /api/accounts/:id — update account config
  app.put<{
    Params: { id: string };
    Body: {
      displayName?: string;
      isActive?: boolean;
      credentials?: Record<string, string>;
    }
  }>('/api/accounts/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid account ID' });

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Account not found' });

    const { displayName, isActive, credentials } = request.body;

    // Update credentials if provided
    if (credentials && Object.keys(credentials).length > 0) {
      setCredentials(existing.credentialsRef, credentials);
    }

    // Build update set
    const updateSet: Record<string, any> = {};
    if (displayName !== undefined) updateSet.displayName = displayName;
    if (isActive !== undefined) updateSet.isActive = isActive;

    if (Object.keys(updateSet).length > 0) {
      db.update(accounts).set(updateSet).where(eq(accounts.id, id)).run();
    }

    const updated = db.select().from(accounts).where(eq(accounts.id, id)).get();
    return reply.send({ account: updated });
  });

  // DELETE /api/accounts/:id — remove account
  app.delete<{
    Params: { id: string };
    Querystring: { deleteTransactions?: string }
  }>('/api/accounts/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid account ID' });

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Account not found' });

    // Delete credentials from encrypted store
    deleteCredentials(existing.credentialsRef);

    // Optionally delete associated transactions
    if (request.query.deleteTransactions === 'true') {
      db.delete(transactions).where(eq(transactions.accountId, id)).run();
    }

    // Delete the account
    db.delete(accounts).where(eq(accounts.id, id)).run();

    return reply.send({ deleted: true, id });
  });
}
```

### Request/Response Examples

**POST /api/accounts**
```json
// Request
{
  "companyId": "hapoalim",
  "displayName": "My Hapoalim Account",
  "credentials": { "userCode": "abc123", "password": "secret" }
}
// Response 201
{
  "account": {
    "id": 1,
    "companyId": "hapoalim",
    "displayName": "My Hapoalim Account",
    "accountNumber": null,
    "credentialsRef": "uuid-here",
    "isActive": true,
    "lastScrapedAt": null,
    "createdAt": "2026-02-24T..."
  }
}
```

**PUT /api/accounts/1**
```json
// Request
{ "displayName": "Personal Hapoalim", "isActive": false }
// Response 200
{ "account": { ... } }
```

**DELETE /api/accounts/1?deleteTransactions=true**
```json
// Response 200
{ "deleted": true, "id": 1 }
```

### Acceptance Criteria
- `GET /api/accounts` lists all accounts without exposing credentials
- `POST /api/accounts` validates `companyId` against the known list
- `POST /api/accounts` stores credentials encrypted, never in the DB
- `PUT /api/accounts/:id` can update displayName, isActive, and credentials independently
- `DELETE /api/accounts/:id` removes credentials from the encrypted store
- `DELETE /api/accounts/:id?deleteTransactions=true` also removes associated transactions
- Returns 404 for non-existent accounts, 400 for invalid input

---

## Task 3.2 — Transactions Query Routes

### File: `src/api/transactions.routes.ts`

Supports filtering by account, date range, category, status, amount range, and text search. Paginated with `offset` and `limit`.

```typescript
import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lte, like, desc, sql, count } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions } from '../db/schema.js';

export async function transactionsRoutes(app: FastifyInstance) {

  // GET /api/transactions — list transactions with filters + pagination
  app.get<{
    Querystring: {
      accountId?: string;
      startDate?: string;    // ISO date string
      endDate?: string;      // ISO date string
      category?: string;
      status?: string;       // 'completed' | 'pending'
      minAmount?: string;
      maxAmount?: string;
      search?: string;       // partial match on description
      offset?: string;
      limit?: string;
      sortBy?: string;       // column name (default: 'date')
      sortOrder?: string;    // 'asc' | 'desc' (default: 'desc')
    }
  }>('/api/transactions', async (request, reply) => {
    const {
      accountId, startDate, endDate, category, status,
      minAmount, maxAmount, search,
      offset: offsetParam, limit: limitParam,
      sortBy = 'date', sortOrder = 'desc',
    } = request.query;

    const limit = Math.min(parseInt(limitParam ?? '50', 10), 500);
    const offset = parseInt(offsetParam ?? '0', 10);

    // Build conditions array
    const conditions = [];

    if (accountId) {
      conditions.push(eq(transactions.accountId, parseInt(accountId, 10)));
    }
    if (startDate) {
      conditions.push(gte(transactions.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(transactions.date, endDate));
    }
    if (category) {
      conditions.push(eq(transactions.category, category));
    }
    if (status) {
      conditions.push(eq(transactions.status, status));
    }
    if (minAmount) {
      conditions.push(gte(transactions.chargedAmount, parseFloat(minAmount)));
    }
    if (maxAmount) {
      conditions.push(lte(transactions.chargedAmount, parseFloat(maxAmount)));
    }
    if (search) {
      conditions.push(like(transactions.description, `%${search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ total }] = db
      .select({ total: count() })
      .from(transactions)
      .where(where)
      .all();

    // Determine sort column
    const sortColumn = sortBy === 'chargedAmount' ? transactions.chargedAmount
      : sortBy === 'description' ? transactions.description
      : sortBy === 'processedDate' ? transactions.processedDate
      : transactions.date;

    const orderFn = sortOrder === 'asc' ? sql`${sortColumn} asc` : sql`${sortColumn} desc`;

    // Get paginated rows
    const rows = db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(orderFn)
      .limit(limit)
      .offset(offset)
      .all();

    return reply.send({
      transactions: rows,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      },
    });
  });
}
```

### Request/Response Examples

**GET /api/transactions?accountId=1&startDate=2026-01-01&limit=20**
```json
{
  "transactions": [ ... ],
  "pagination": {
    "total": 153,
    "offset": 0,
    "limit": 20,
    "hasMore": true
  }
}
```

**GET /api/transactions?search=super&category=food&sortBy=chargedAmount&sortOrder=desc**
```json
{
  "transactions": [ ... ],
  "pagination": { "total": 5, "offset": 0, "limit": 50, "hasMore": false }
}
```

### Acceptance Criteria
- All filters work independently and in combination
- Pagination returns `total`, `offset`, `limit`, and `hasMore`
- Max limit is capped at 500 to prevent massive queries
- Default sort is by `date` descending
- `search` filter does a case-insensitive partial match on `description`

---

## Task 3.3 — Summary / Aggregation Routes

### File: `src/api/summary.routes.ts`

Provides aggregated financial summaries. Three query modes: by category, by month, by account.

```typescript
import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';

export async function summaryRoutes(app: FastifyInstance) {

  // GET /api/transactions/summary
  app.get<{
    Querystring: {
      accountId?: string;
      startDate?: string;
      endDate?: string;
      groupBy?: string;  // 'category' | 'month' | 'account' (default: 'category')
    }
  }>('/api/transactions/summary', async (request, reply) => {
    const { accountId, startDate, endDate, groupBy = 'category' } = request.query;

    // Build conditions
    const conditions = [];
    if (accountId) conditions.push(eq(transactions.accountId, parseInt(accountId, 10)));
    if (startDate) conditions.push(gte(transactions.date, startDate));
    if (endDate) conditions.push(lte(transactions.date, endDate));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    if (groupBy === 'month') {
      // Group by year-month
      const rows = db
        .select({
          month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as('month'),
          totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
          transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
        })
        .from(transactions)
        .where(where)
        .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
        .orderBy(sql`month desc`)
        .all();

      return reply.send({ groupBy: 'month', summary: rows });
    }

    if (groupBy === 'account') {
      // Group by account with display name
      const rows = db
        .select({
          accountId: transactions.accountId,
          displayName: accounts.displayName,
          companyId: accounts.companyId,
          totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
          transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(where)
        .groupBy(transactions.accountId)
        .all();

      return reply.send({ groupBy: 'account', summary: rows });
    }

    // Default: group by category
    const rows = db
      .select({
        category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
        totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
        transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
      })
      .from(transactions)
      .where(where)
      .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
      .orderBy(sql`total_amount desc`)
      .all();

    return reply.send({ groupBy: 'category', summary: rows });
  });
}
```

### Request/Response Examples

**GET /api/transactions/summary?groupBy=category&startDate=2026-01-01**
```json
{
  "groupBy": "category",
  "summary": [
    { "category": "food", "totalAmount": 3200.50, "transactionCount": 45 },
    { "category": "transport", "totalAmount": 1500.00, "transactionCount": 12 },
    { "category": "uncategorized", "totalAmount": 800.00, "transactionCount": 20 }
  ]
}
```

**GET /api/transactions/summary?groupBy=month**
```json
{
  "groupBy": "month",
  "summary": [
    { "month": "2026-02", "totalAmount": 8500.00, "transactionCount": 95 },
    { "month": "2026-01", "totalAmount": 7200.00, "transactionCount": 88 }
  ]
}
```

**GET /api/transactions/summary?groupBy=account**
```json
{
  "groupBy": "account",
  "summary": [
    { "accountId": 1, "displayName": "My Hapoalim", "companyId": "hapoalim", "totalAmount": 12000.00, "transactionCount": 150 }
  ]
}
```

### Acceptance Criteria
- Three groupBy modes: `category`, `month`, `account`
- Date and account filters apply to all modes
- Uncategorized transactions are grouped under `"uncategorized"` (not null)
- Monthly summaries are ordered newest first
- Category summaries are ordered by total amount descending

---

## Task 3.4 — Register All Routes in `src/index.ts`

Update `src/index.ts` to register the new route modules:

```typescript
import { scrapeRoutes } from './api/scrape.routes.js';
import { accountsRoutes } from './api/accounts.routes.js';
import { transactionsRoutes } from './api/transactions.routes.js';
import { summaryRoutes } from './api/summary.routes.js';

await app.register(scrapeRoutes);
await app.register(accountsRoutes);
await app.register(transactionsRoutes);
await app.register(summaryRoutes);
```

### Acceptance Criteria
- All routes from Phase 2 and Phase 3 are registered
- Server boots without errors
- No route conflicts

---

## Final Verification

```bash
npm run dev

# Accounts CRUD
curl -X POST http://localhost:3000/api/accounts \
  -H 'Content-Type: application/json' \
  -d '{"companyId":"hapoalim","displayName":"Test","credentials":{"userCode":"x","password":"y"}}'
# → 201

curl http://localhost:3000/api/accounts
# → { "accounts": [{ "id": 1, ... }] }

curl -X PUT http://localhost:3000/api/accounts/1 \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"Updated Name"}'
# → 200

# Transactions (will be empty until scraping works)
curl "http://localhost:3000/api/transactions?limit=10"
# → { "transactions": [], "pagination": { "total": 0, ... } }

# Summary
curl "http://localhost:3000/api/transactions/summary?groupBy=month"
# → { "groupBy": "month", "summary": [] }

# Delete account
curl -X DELETE "http://localhost:3000/api/accounts/1?deleteTransactions=true"
# → { "deleted": true, "id": 1 }
```

---

## Files Created in This Phase

```
src/
├── api/
│   ├── accounts.routes.ts      (NEW)
│   ├── transactions.routes.ts  (NEW)
│   └── summary.routes.ts       (NEW)
└── index.ts                     (MODIFIED — register new routes)
```
