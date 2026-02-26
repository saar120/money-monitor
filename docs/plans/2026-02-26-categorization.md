# Categorization Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add DB-driven category management, inline category assignment in the transaction table, and auto-categorization of newly scraped transactions.

**Architecture:** A new `categories` SQLite table replaces the hardcoded `CATEGORIES` constant as the source of truth. The AI prompt, tool definitions, and batch categorizer all read from the DB dynamically. The scraper calls `batchCategorize` on newly inserted transaction IDs after each scrape. The frontend gets a new Categories page and an inline dropdown in the transaction table.

**Tech Stack:** Drizzle ORM (SQLite), Fastify, Zod, Vue 3, shadcn-vue components already installed (`Select`, `Badge`, `Input`, `Button`, `Card`, `Table`)

---

### Task 1: DB migration — create `categories` table

**Files:**
- Create: `src/db/migrations/0002_categories.sql`
- Modify: `src/db/schema.ts`

**Step 1: Create the migration file**

Create `src/db/migrations/0002_categories.sql`:

```sql
CREATE TABLE `categories` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL UNIQUE,
  `label` text NOT NULL,
  `color` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO `categories` (`name`, `label`, `color`) VALUES
  ('food', 'Food', '#22c55e'),
  ('transport', 'Transport', '#3b82f6'),
  ('housing', 'Housing', '#f59e0b'),
  ('utilities', 'Utilities', '#6366f1'),
  ('entertainment', 'Entertainment', '#ec4899'),
  ('health', 'Health', '#14b8a6'),
  ('shopping', 'Shopping', '#f97316'),
  ('education', 'Education', '#8b5cf6'),
  ('subscriptions', 'Subscriptions', '#06b6d4'),
  ('income', 'Income', '#84cc16'),
  ('transfer', 'Transfer', '#64748b'),
  ('other', 'Other', '#94a3b8');
```

**Step 2: Add `categories` table to the Drizzle schema**

In `src/db/schema.ts`, append after the `scrapeLogs` table:

```typescript
export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  label: text('label').notNull(),
  color: text('color'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

**Step 3: Check how migrations are applied**

Run: `cat src/db/connection.ts` (or look for `migrate` calls)

The project uses `better-sqlite3-migrate` or similar. Check how existing migrations run. Look at `src/db/connection.ts` to see if migrations auto-apply on startup. If they do, the new migration file will be picked up automatically.

**Step 4: Start the server and verify the table exists**

Run: `npm run dev` (or the appropriate start command — check `package.json` scripts)

Then in another terminal: `sqlite3 data/money-monitor.db ".tables"` — verify `categories` appears.

Run: `sqlite3 data/money-monitor.db "SELECT * FROM categories;"` — verify 12 seeded rows.

**Step 5: Commit**

```bash
git add src/db/migrations/0002_categories.sql src/db/schema.ts
git commit -m "feat: add categories table with seed data"
```

---

### Task 2: Categories API routes (CRUD)

**Files:**
- Create: `src/api/categories.routes.ts`
- Modify: `src/api/validation.ts` (add schemas)
- Modify: `src/index.ts` (register route)

**Step 1: Add Zod schemas to `src/api/validation.ts`**

Append to `src/api/validation.ts`:

```typescript
// ─── Categories ───

export const createCategorySchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'Name must be lowercase alphanumeric, dashes, or underscores'),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const updateCategorySchema = z.object({
  label: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
```

**Step 2: Create `src/api/categories.routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { categories } from '../db/schema.js';
import { createCategorySchema, updateCategorySchema } from './validation.js';

export async function categoriesRoutes(app: FastifyInstance) {

  app.get('/api/categories', async (_request, reply) => {
    const rows = db.select().from(categories).all();
    return reply.send({ categories: rows });
  });

  app.post('/api/categories', async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    }

    const existing = db.select().from(categories).where(eq(categories.name, parsed.data.name)).get();
    if (existing) {
      return reply.status(409).send({ error: 'Category name already exists' });
    }

    const [created] = db.insert(categories).values(parsed.data).returning().all();
    return reply.status(201).send({ category: created });
  });

  app.patch('/api/categories/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid category id' });
    }

    const parsed = updateCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    }

    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    const [updated] = db.update(categories).set(parsed.data).where(eq(categories.id, id)).returning().all();
    return reply.send({ category: updated });
  });

  app.delete('/api/categories/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid category id' });
    }

    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    db.delete(categories).where(eq(categories.id, id)).run();
    return reply.send({ deleted: true });
  });
}
```

**Step 3: Register the route in `src/index.ts`**

Add the import near the other route imports:
```typescript
import { categoriesRoutes } from './api/categories.routes.js';
```

Add the registration after the other `app.register` calls:
```typescript
await app.register(categoriesRoutes);
```

**Step 4: Manually test endpoints**

```bash
curl http://localhost:3000/api/categories
# should return 12 categories

curl -X POST http://localhost:3000/api/categories \
  -H "Content-Type: application/json" \
  -d '{"name":"test","label":"Test","color":"#ff0000"}'
# should return 201 with new category

curl -X DELETE http://localhost:3000/api/categories/13
# should delete the test category
```

**Step 5: Commit**

```bash
git add src/api/categories.routes.ts src/api/validation.ts src/index.ts
git commit -m "feat: add categories CRUD API"
```

---

### Task 3: PATCH `/api/transactions/:id` — update category

**Files:**
- Modify: `src/api/transactions.routes.ts`
- Modify: `src/api/validation.ts`

**Step 1: Add schema to `src/api/validation.ts`**

Append:

```typescript
export const updateTransactionSchema = z.object({
  category: z.string().min(1).max(50).nullable(),
});
```

**Step 2: Add the PATCH endpoint in `src/api/transactions.routes.ts`**

Add this import at the top (after existing imports):
```typescript
import { updateTransactionSchema } from './validation.js';
```

Append this handler inside `transactionsRoutes` (after the existing `patch('/api/transactions/:id/ignore', ...)` handler):

```typescript
  app.patch('/api/transactions/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid transaction id' });
    }

    const parsed = updateTransactionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    }

    const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Transaction not found' });

    const [updated] = db
      .update(transactions)
      .set({ category: parsed.data.category })
      .where(eq(transactions.id, id))
      .returning()
      .all();

    return reply.send({ transaction: updated });
  });
```

**Step 3: Test**

```bash
# Replace 1 with a real transaction ID from your DB
curl -X PATCH http://localhost:3000/api/transactions/1 \
  -H "Content-Type: application/json" \
  -d '{"category":"food"}'
# should return the updated transaction with category: "food"

curl -X PATCH http://localhost:3000/api/transactions/1 \
  -H "Content-Type: application/json" \
  -d '{"category":null}'
# should clear the category
```

**Step 4: Commit**

```bash
git add src/api/transactions.routes.ts src/api/validation.ts
git commit -m "feat: add PATCH /api/transactions/:id for category update"
```

---

### Task 4: Dynamic AI — prompts, tools, batchCategorize

**Files:**
- Modify: `src/ai/prompts.ts`
- Modify: `src/ai/tools.ts`
- Modify: `src/ai/agent.ts`

**Step 1: Update `src/ai/prompts.ts` to export a builder function**

Replace the entire file content:

```typescript
export const CATEGORIES = [
  'food', 'transport', 'housing', 'utilities', 'entertainment', 'health',
  'shopping', 'education', 'subscriptions', 'income', 'transfer', 'other',
] as const;

export type Category = typeof CATEGORIES[number];

export function buildFinancialAdvisorPrompt(categoryNames: string[]): string {
  const list = categoryNames.join(', ');
  return `You are a personal financial advisor with direct access to the user's bank and credit card transaction data from Israeli financial institutions.

Your role:
- Answer questions about spending, income, and financial trends
- Categorize transactions into meaningful categories
- Identify patterns, anomalies, and unusual charges
- Provide actionable savings insights and recommendations
- Compare spending across months and accounts

Important rules:
- ALWAYS use your tools to query real data before making claims. Never guess amounts or dates.
- All monetary amounts are in ILS (Israeli New Shekel) unless otherwise stated.
- When showing amounts, format as ₪X,XXX.XX
- When the user asks about "this month", use the current calendar month.
- When the user asks about "last month", use the previous calendar month.
- Be concise but thorough. Use tables for comparative data when helpful.
- If asked to categorize, use these standard categories: ${list}.
- Dates in the database are ISO strings (e.g. "2026-02-24T00:00:00.000Z").

You have access to the following tools to query the user's financial data. Use them as needed.`;
}

// Keep the old constant for backwards compatibility in batchCategorize fallback
export const FINANCIAL_ADVISOR_PROMPT = buildFinancialAdvisorPrompt(CATEGORIES as unknown as string[]);
```

**Step 2: Update `src/ai/tools.ts` to export a `buildTools` function**

Replace the `tools` export and the `categorize_transaction` tool's enum line. Change:

```typescript
import { CATEGORIES } from './prompts.js';
```
to:
```typescript
// no longer importing CATEGORIES here
```

Change the `export const tools: Tool[] = [...]` to a function:

```typescript
export function buildTools(categoryNames: string[]): Tool[] {
  return [
    {
      name: 'query_transactions',
      // ... same as before (no changes needed)
    },
    {
      name: 'get_spending_summary',
      // ... same as before
    },
    {
      name: 'categorize_transaction',
      description: 'Assign a category to a specific transaction by its ID.',
      input_schema: {
        type: 'object' as const,
        properties: {
          transaction_id: { type: 'number', description: 'The transaction ID' },
          category: {
            type: 'string',
            enum: categoryNames,
            description: 'The category to assign',
          },
        },
        required: ['transaction_id', 'category'],
      },
    },
    {
      name: 'get_account_balances',
      // ... same as before
    },
  ];
}
```

Full replacement for `src/ai/tools.ts`:

```typescript
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { eq, and, gte, lte, like, sql, count, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';
import { escapeLike } from '../api/validation.js';

export function buildTools(categoryNames: string[]): Tool[] {
  return [
    {
      name: 'query_transactions',
      description: 'Search and filter transactions from the database. Use this to find specific transactions or answer questions about spending.',
      input_schema: {
        type: 'object' as const,
        properties: {
          account_id: { type: 'number', description: 'Filter by account ID' },
          start_date: { type: 'string', description: 'Start date (ISO string, e.g. "2026-01-01")' },
          end_date: { type: 'string', description: 'End date (ISO string, e.g. "2026-01-31")' },
          category: { type: 'string', description: 'Filter by category' },
          status: { type: 'string', enum: ['completed', 'pending'], description: 'Transaction status' },
          min_amount: { type: 'number', description: 'Minimum charged amount' },
          max_amount: { type: 'number', description: 'Maximum charged amount' },
          search: { type: 'string', description: 'Search term for description (partial match)' },
          limit: { type: 'number', description: 'Max results to return (default 50, max 200)' },
        },
        required: [],
      },
    },
    {
      name: 'get_spending_summary',
      description: 'Get aggregated spending totals. Group by category, month, or account to understand spending patterns.',
      input_schema: {
        type: 'object' as const,
        properties: {
          group_by: {
            type: 'string',
            enum: ['category', 'month', 'account'],
            description: 'How to group the results (default: category)',
          },
          account_id: { type: 'number', description: 'Filter by account ID' },
          start_date: { type: 'string', description: 'Start date (ISO string)' },
          end_date: { type: 'string', description: 'End date (ISO string)' },
        },
        required: [],
      },
    },
    {
      name: 'categorize_transaction',
      description: 'Assign a category to a specific transaction by its ID.',
      input_schema: {
        type: 'object' as const,
        properties: {
          transaction_id: { type: 'number', description: 'The transaction ID' },
          category: {
            type: 'string',
            enum: categoryNames,
            description: 'The category to assign',
          },
        },
        required: ['transaction_id', 'category'],
      },
    },
    {
      name: 'get_account_balances',
      description: 'Get a list of all configured accounts with their latest scrape info and transaction counts.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ];
}

interface QueryTransactionsInput {
  account_id?: number;
  start_date?: string;
  end_date?: string;
  category?: string;
  status?: string;
  min_amount?: number;
  max_amount?: number;
  search?: string;
  limit?: number;
}

interface GetSpendingSummaryInput {
  group_by?: 'category' | 'month' | 'account';
  account_id?: number;
  start_date?: string;
  end_date?: string;
}

interface CategorizeTransactionInput {
  transaction_id: number;
  category: string;
}

export async function handleToolCall(
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case 'query_transactions':
      return queryTransactions(input as QueryTransactionsInput);
    case 'get_spending_summary':
      return getSpendingSummary(input as GetSpendingSummaryInput);
    case 'categorize_transaction':
      return categorizeTransaction(input as unknown as CategorizeTransactionInput);
    case 'get_account_balances':
      return getAccountBalances();
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

function queryTransactions(input: QueryTransactionsInput): string {
  const conditions = [];
  if (input.account_id) conditions.push(eq(transactions.accountId, input.account_id));
  if (input.start_date) conditions.push(gte(transactions.date, input.start_date));
  if (input.end_date) conditions.push(lte(transactions.date, input.end_date));
  if (input.category) conditions.push(eq(transactions.category, input.category));
  if (input.status) conditions.push(eq(transactions.status, input.status));
  if (input.min_amount) conditions.push(gte(transactions.chargedAmount, input.min_amount));
  if (input.max_amount) conditions.push(lte(transactions.chargedAmount, input.max_amount));
  if (input.search) conditions.push(like(transactions.description, `%${escapeLike(input.search)}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(input.limit ?? 50, 200);

  const rows = db.select().from(transactions)
    .where(where)
    .orderBy(desc(transactions.date))
    .limit(limit)
    .all();

  const [{ total }] = db.select({ total: count() }).from(transactions).where(where).all();

  return JSON.stringify({ transactions: rows, total, returned: rows.length });
}

function getSpendingSummary(input: GetSpendingSummaryInput): string {
  const conditions = [];
  if (input.account_id) conditions.push(eq(transactions.accountId, input.account_id));
  if (input.start_date) conditions.push(gte(transactions.date, input.start_date));
  if (input.end_date) conditions.push(lte(transactions.date, input.end_date));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const groupBy = input.group_by ?? 'category';

  if (groupBy === 'month') {
    const rows = db.select({
      month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as('month'),
      totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
      count: sql<number>`COUNT(*)`.as('count'),
    }).from(transactions).where(where)
      .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
      .orderBy(sql`month desc`).all();
    return JSON.stringify({ groupBy, summary: rows });
  }

  if (groupBy === 'account') {
    const rows = db.select({
      accountId: transactions.accountId,
      displayName: accounts.displayName,
      totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
      count: sql<number>`COUNT(*)`.as('count'),
    }).from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(where)
      .groupBy(transactions.accountId).all();
    return JSON.stringify({ groupBy, summary: rows });
  }

  const rows = db.select({
    category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
    totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
    count: sql<number>`COUNT(*)`.as('count'),
  }).from(transactions).where(where)
    .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
    .orderBy(sql`total_amount desc`).all();
  return JSON.stringify({ groupBy, summary: rows });
}

function categorizeTransaction(input: CategorizeTransactionInput): string {
  const existing = db.select().from(transactions).where(eq(transactions.id, input.transaction_id)).get();
  if (!existing) return JSON.stringify({ error: 'Transaction not found' });

  db.update(transactions)
    .set({ category: input.category })
    .where(eq(transactions.id, input.transaction_id))
    .run();

  return JSON.stringify({ success: true, transactionId: input.transaction_id, category: input.category });
}

function getAccountBalances(): string {
  const rows = db.select({
    id: accounts.id,
    companyId: accounts.companyId,
    displayName: accounts.displayName,
    accountNumber: accounts.accountNumber,
    isActive: accounts.isActive,
    lastScrapedAt: accounts.lastScrapedAt,
    transactionCount: sql<number>`(SELECT COUNT(*) FROM transactions WHERE account_id = ${accounts.id})`.as('transaction_count'),
    totalSpending: sql<number>`(SELECT COALESCE(SUM(charged_amount), 0) FROM transactions WHERE account_id = ${accounts.id})`.as('total_spending'),
  }).from(accounts).all();

  return JSON.stringify({ accounts: rows });
}
```

**Step 3: Update `src/ai/agent.ts` to use dynamic categories**

Replace the full file:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { buildFinancialAdvisorPrompt } from './prompts.js';
import { buildTools, handleToolCall } from './tools.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function getCategoryNames(): Promise<string[]> {
  const { db } = await import('../db/connection.js');
  const { categories } = await import('../db/schema.js');
  const rows = db.select({ name: categories.name }).from(categories).all();
  return rows.map(r => r.name);
}

export async function chat(conversationHistory: ChatMessage[]): Promise<string> {
  const categoryNames = await getCategoryNames();
  const systemPrompt = buildFinancialAdvisorPrompt(categoryNames);
  const tools = buildTools(categoryNames);

  const messages: Anthropic.MessageParam[] = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
    const textBlocks = response.content.filter(block => block.type === 'text');

    if (toolUseBlocks.length === 0) {
      return textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n');
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (block.type === 'tool_use') {
        const result = await handleToolCall(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return 'I reached the maximum number of analysis steps. Please try a more specific question.';
}

export async function batchCategorize(
  batchSize: number = 50,
  ids?: number[],
): Promise<{ categorized: number }> {
  const { eq, isNull, inArray } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions, categories } = await import('../db/schema.js');

  // Fetch category names from DB
  const categoryRows = db.select({ name: categories.name }).from(categories).all();
  const categoryNames = categoryRows.map(r => r.name);
  if (categoryNames.length === 0) return { categorized: 0 };

  // Fetch uncategorized transactions — either specific IDs or next batch
  const uncategorized = ids && ids.length > 0
    ? db.select().from(transactions)
        .where(isNull(transactions.category))
        .all()
        .filter(t => ids.includes(t.id))
    : db.select().from(transactions)
        .where(isNull(transactions.category))
        .limit(batchSize)
        .all();

  if (uncategorized.length === 0) return { categorized: 0 };

  const validIds = new Set(uncategorized.map(t => t.id));
  const validCategories = new Set(categoryNames);

  const txnList = uncategorized.map(t =>
    `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}`
  ).join('\n');

  const categoryList = categoryNames.join(', ');

  const response = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: `You are a transaction categorizer. Assign each transaction one of these categories: ${categoryList}. Respond with ONLY a JSON array of objects with "id" and "category" fields. No markdown, no explanation.`,
    messages: [{
      role: 'user',
      content: `Categorize these transactions:\n${txnList}`,
    }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.type === 'text' ? b.text : '')
    .join('');

  let categorized = 0;
  try {
    const results: Array<{ id: number; category: string }> = JSON.parse(text);
    for (const { id, category } of results) {
      if (!validIds.has(id)) continue;
      if (!validCategories.has(category)) continue;

      db.update(transactions)
        .set({ category })
        .where(eq(transactions.id, id))
        .run();
      categorized++;
    }
  } catch {
    // If parsing fails, return 0 — the model response was malformed
  }

  return { categorized };
}
```

**Step 4: Verify the server still starts**

Run: `npm run dev`

Confirm no TypeScript/import errors in the console.

**Step 5: Commit**

```bash
git add src/ai/prompts.ts src/ai/tools.ts src/ai/agent.ts
git commit -m "feat: make AI categories dynamic from DB"
```

---

### Task 5: Auto-categorize on scrape

**Files:**
- Modify: `src/scraper/scraper.service.ts`

**Step 1: Collect new transaction IDs and call `batchCategorize` after scrape**

In `src/scraper/scraper.service.ts`:

1. Add import at the top:
```typescript
import { batchCategorize } from '../ai/agent.js';
```

2. Inside `scrapeAccount`, initialize a `newIds` array before the transaction loop:
```typescript
const newIds: number[] = [];
```

3. Inside the transaction insert loop, capture the inserted ID when `result.changes > 0`:
```typescript
if (result.changes > 0) {
  totalNew++;
  newIds.push(Number(result.lastInsertRowid));
}
```

4. After the scrape log insert (after `db.insert(scrapeLogs).values({...}).run();` on success), add:
```typescript
// Best-effort: categorize newly imported transactions in background
if (newIds.length > 0) {
  batchCategorize(newIds.length, newIds).catch(() => {
    // Categorization failure must not break the scrape response
  });
}
```

The `catch` is important — the scrape result should always succeed even if Claude is down.

**Step 2: Verify the scrape still works**

Trigger a scrape manually from the UI or with:
```bash
curl -X POST http://localhost:3000/api/scrape/all
```

Check the logs to confirm no errors. After it finishes, query:
```bash
sqlite3 data/money-monitor.db "SELECT category, COUNT(*) FROM transactions GROUP BY category;"
```

Newly imported transactions should start showing categories within a few seconds.

**Step 3: Commit**

```bash
git add src/scraper/scraper.service.ts
git commit -m "feat: auto-categorize newly scraped transactions"
```

---

### Task 6: Frontend — API client additions

**Files:**
- Modify: `dashboard/src/api/client.ts`

**Step 1: Add Category type and API functions**

Append to `dashboard/src/api/client.ts`:

```typescript
// ─── Categories ───

export interface Category {
  id: number;
  name: string;
  label: string;
  color: string | null;
  createdAt: string;
}

export function getCategories() {
  return request<{ categories: Category[] }>('/categories');
}

export function createCategory(data: { name: string; label: string; color?: string }) {
  return request<{ category: Category }>('/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCategory(id: number, data: { label?: string; color?: string }) {
  return request<{ category: Category }>(`/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteCategory(id: number) {
  return request<{ deleted: boolean }>(`/categories/${id}`, { method: 'DELETE' });
}

export function updateTransactionCategory(id: number, category: string | null) {
  return request<{ transaction: Transaction }>(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ category }),
  });
}
```

**Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add categories and transaction category API client functions"
```

---

### Task 7: Frontend — CategoryManager page

**Files:**
- Create: `dashboard/src/components/CategoryManager.vue`
- Modify: `dashboard/src/main.ts` (add route)
- Modify: `dashboard/src/components/AppLayout.vue` (add nav item)

**Step 1: Create `dashboard/src/components/CategoryManager.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getCategories, createCategory, updateCategory, deleteCategory, type Category } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-vue-next';

const categories = ref<Category[]>([]);
const loading = ref(false);
const error = ref('');

// Editing state
const editingId = ref<number | null>(null);
const editLabel = ref('');
const editColor = ref('');

// New category form
const newName = ref('');
const newLabel = ref('');
const newColor = ref('#94a3b8');
const showNewForm = ref(false);
const saving = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await getCategories();
    categories.value = res.categories;
  } catch (e) {
    error.value = 'Failed to load categories';
  } finally {
    loading.value = false;
  }
}

function startEdit(cat: Category) {
  editingId.value = cat.id;
  editLabel.value = cat.label;
  editColor.value = cat.color ?? '#94a3b8';
}

function cancelEdit() {
  editingId.value = null;
}

async function saveEdit(cat: Category) {
  try {
    const res = await updateCategory(cat.id, { label: editLabel.value, color: editColor.value });
    const idx = categories.value.findIndex(c => c.id === cat.id);
    if (idx !== -1) categories.value[idx] = res.category;
    editingId.value = null;
  } catch {
    error.value = 'Failed to save';
  }
}

async function remove(cat: Category) {
  if (!confirm(`Delete category "${cat.label}"? Transactions with this category will keep the label but it won't appear in dropdowns.`)) return;
  try {
    await deleteCategory(cat.id);
    categories.value = categories.value.filter(c => c.id !== cat.id);
  } catch {
    error.value = 'Failed to delete';
  }
}

async function addCategory() {
  if (!newName.value || !newLabel.value) return;
  saving.value = true;
  try {
    const res = await createCategory({ name: newName.value, label: newLabel.value, color: newColor.value });
    categories.value.push(res.category);
    newName.value = '';
    newLabel.value = '';
    newColor.value = '#94a3b8';
    showNewForm.value = false;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to create';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Categories</h1>
      <Button size="sm" @click="showNewForm = !showNewForm">
        <Plus class="h-4 w-4 mr-1" /> Add category
      </Button>
    </div>

    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

    <!-- New category form -->
    <Card v-if="showNewForm">
      <CardHeader class="pb-2">
        <CardTitle class="text-sm">New Category</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="flex gap-2 items-end flex-wrap">
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">Name (slug)</label>
            <Input v-model="newName" placeholder="e.g. groceries" class="w-36" />
          </div>
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">Label</label>
            <Input v-model="newLabel" placeholder="e.g. Groceries" class="w-36" />
          </div>
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">Color</label>
            <input type="color" v-model="newColor" class="h-9 w-14 rounded border cursor-pointer" />
          </div>
          <Button size="sm" :disabled="saving || !newName || !newLabel" @click="addCategory">
            {{ saving ? 'Saving...' : 'Save' }}
          </Button>
          <Button size="sm" variant="ghost" @click="showNewForm = false">Cancel</Button>
        </div>
        <p class="text-xs text-muted-foreground mt-1">Name must be lowercase letters, numbers, dashes, or underscores.</p>
      </CardContent>
    </Card>

    <!-- Table -->
    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-8">Color</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Label</TableHead>
              <TableHead class="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading">
              <TableCell colspan="4" class="text-center text-muted-foreground py-8">Loading...</TableCell>
            </TableRow>
            <TableRow v-for="cat in categories" :key="cat.id">
              <TableCell>
                <div
                  class="w-5 h-5 rounded-full border"
                  :style="{ backgroundColor: cat.color ?? '#94a3b8' }"
                />
              </TableCell>
              <TableCell class="font-mono text-sm">{{ cat.name }}</TableCell>
              <TableCell>
                <template v-if="editingId === cat.id">
                  <div class="flex gap-2 items-center">
                    <Input v-model="editLabel" class="w-32 h-7 text-sm" />
                    <input type="color" v-model="editColor" class="h-7 w-10 rounded border cursor-pointer" />
                    <button @click="saveEdit(cat)" class="text-green-600 hover:text-green-700">
                      <Check class="h-4 w-4" />
                    </button>
                    <button @click="cancelEdit" class="text-muted-foreground hover:text-foreground">
                      <X class="h-4 w-4" />
                    </button>
                  </div>
                </template>
                <template v-else>
                  <Badge variant="secondary" :style="{ backgroundColor: cat.color + '33', color: cat.color ?? undefined }">
                    {{ cat.label }}
                  </Badge>
                </template>
              </TableCell>
              <TableCell class="text-right">
                <div v-if="editingId !== cat.id" class="flex gap-1 justify-end">
                  <button @click="startEdit(cat)" class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <button @click="remove(cat)" class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive">
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
```

**Step 2: Add the `/categories` route in `dashboard/src/main.ts`**

Add this route in the `routes` array:
```typescript
{ path: '/categories', component: () => import('./components/CategoryManager.vue') },
```

**Step 3: Add nav item in `dashboard/src/components/AppLayout.vue`**

Add `Tag` to the lucide import:
```typescript
import { LayoutDashboard, Receipt, Building2, Bot, Tag } from 'lucide-vue-next';
```

Add to `navItems`:
```typescript
{ path: '/categories', label: 'Categories', icon: Tag },
```

**Step 4: Open the app and verify**

Navigate to the Categories page. Confirm 12 categories appear. Try adding one, editing one, deleting one.

**Step 5: Commit**

```bash
git add dashboard/src/components/CategoryManager.vue dashboard/src/main.ts dashboard/src/components/AppLayout.vue
git commit -m "feat: add CategoryManager page with CRUD"
```

---

### Task 8: Frontend — inline category dropdown in TransactionTable

**Files:**
- Modify: `dashboard/src/components/TransactionTable.vue`

**Step 1: Add imports**

In the `<script setup>` block, add to the existing import from `../api/client`:
```typescript
import { getTransactions, getAccounts, ignoreTransaction, updateTransactionCategory, getCategories, type Transaction, type TransactionFilters, type Category } from '../api/client';
```

Add `Popover` components if needed — but actually, a native `<select>` is the simplest approach here. Instead, use the existing `Select` component from shadcn.

**Step 2: Add reactive state for categories**

Add after existing `ref` declarations:
```typescript
const availableCategories = ref<Category[]>([]);
const updatingCategoryFor = ref<number | null>(null);
```

**Step 3: Load categories on mount**

In `onMounted`, add:
```typescript
const catData = await getCategories();
availableCategories.value = catData.categories;
```

**Step 4: Add `updateCategory` function**

```typescript
async function updateCategory(txn: Transaction, newCategory: string | null) {
  updatingCategoryFor.value = txn.id;
  try {
    const result = await updateTransactionCategory(txn.id, newCategory);
    const idx = transactions.value.findIndex(t => t.id === txn.id);
    if (idx !== -1) transactions.value[idx] = result.transaction;
  } catch (err) {
    console.error('Failed to update category:', err);
  } finally {
    updatingCategoryFor.value = null;
  }
}
```

**Step 5: Replace the category cell in the table template**

Find and replace this block:
```html
<TableCell>
  <Badge v-if="txn.category" variant="secondary" class="text-xs">
    {{ txn.category }}
  </Badge>
  <span v-else class="text-muted-foreground text-sm">—</span>
</TableCell>
```

Replace with:
```html
<TableCell @click.stop>
  <Select
    :model-value="txn.category ?? ''"
    :disabled="updatingCategoryFor === txn.id"
    @update:model-value="(val: string) => updateCategory(txn, val === '__none__' ? null : val)"
  >
    <SelectTrigger class="h-7 text-xs w-32 border-0 bg-transparent hover:bg-accent px-1" :class="updatingCategoryFor === txn.id ? 'opacity-50' : ''">
      <SelectValue>
        <Badge
          v-if="txn.category"
          variant="secondary"
          class="text-xs"
          :style="{ backgroundColor: (availableCategories.find(c => c.name === txn.category)?.color ?? '#94a3b8') + '33', color: availableCategories.find(c => c.name === txn.category)?.color ?? undefined }"
        >
          {{ availableCategories.find(c => c.name === txn.category)?.label ?? txn.category }}
        </Badge>
        <span v-else class="text-muted-foreground">—</span>
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__none__">
        <span class="text-muted-foreground">None</span>
      </SelectItem>
      <SelectItem
        v-for="cat in availableCategories"
        :key="cat.name"
        :value="cat.name"
      >
        <div class="flex items-center gap-2">
          <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" :style="{ backgroundColor: cat.color ?? '#94a3b8' }" />
          {{ cat.label }}
        </div>
      </SelectItem>
    </SelectContent>
  </Select>
</TableCell>
```

**Step 6: Also update the category filter** (optional improvement — change text input to a Select)

Find the category text `<Input>`:
```html
<Input
  v-model="selectedCategory"
  placeholder="Category"
  class="w-36"
  @keyup.enter="applyFilters"
/>
```

Replace with:
```html
<Select v-model="selectedCategory" @update:model-value="applyFilters">
  <SelectTrigger class="w-36">
    <SelectValue placeholder="All categories" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="">All categories</SelectItem>
    <SelectItem v-for="cat in availableCategories" :key="cat.name" :value="cat.name">
      {{ cat.label }}
    </SelectItem>
  </SelectContent>
</Select>
```

**Step 7: Verify in the browser**

- Click on any transaction's category cell — dropdown should open
- Select a category — cell should update immediately
- Select "None" — cell should show "—"
- Category filter dropdown should list all categories

**Step 8: Commit**

```bash
git add dashboard/src/components/TransactionTable.vue
git commit -m "feat: add inline category dropdown in transaction table"
```

---

## Summary of all changed files

| File | Change |
|------|--------|
| `src/db/migrations/0002_categories.sql` | New — creates and seeds categories table |
| `src/db/schema.ts` | Add `categories` table definition |
| `src/api/categories.routes.ts` | New — CRUD endpoints |
| `src/api/validation.ts` | Add category + transaction update schemas |
| `src/api/transactions.routes.ts` | Add `PATCH /api/transactions/:id` |
| `src/index.ts` | Register `categoriesRoutes` |
| `src/ai/prompts.ts` | Export `buildFinancialAdvisorPrompt(categories)` |
| `src/ai/tools.ts` | Export `buildTools(categories)` function |
| `src/ai/agent.ts` | Fetch categories from DB in `chat()` and `batchCategorize()` |
| `src/scraper/scraper.service.ts` | Track new IDs, call `batchCategorize` after scrape |
| `dashboard/src/api/client.ts` | Add category functions + `updateTransactionCategory` |
| `dashboard/src/components/CategoryManager.vue` | New — categories CRUD page |
| `dashboard/src/main.ts` | Add `/categories` route |
| `dashboard/src/components/AppLayout.vue` | Add Categories nav item |
| `dashboard/src/components/TransactionTable.vue` | Inline category dropdown + filter dropdown |
