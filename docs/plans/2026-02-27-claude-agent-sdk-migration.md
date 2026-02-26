# Claude Agent SDK Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `@anthropic-ai/sdk` manual tool loop with `@anthropic-ai/claude-agent-sdk` in-process MCP server for better tool handling and multi-step reasoning.

**Architecture:** Define 4 financial tools via `createSdkMcpServer` + `tool()` (same Drizzle ORM logic, new MCP wrapper). `chat()` uses `query()` with the MCP server. `batchCategorize()` uses `query()` with no tools. All API contracts unchanged.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk`, `zod` (already installed), `drizzle-orm` (unchanged)

**Design doc:** `docs/plans/2026-02-27-claude-agent-sdk-migration-design.md`

---

### Task 1: Swap the package

**Files:**
- Modify: `package.json`

**Step 1: Uninstall old SDK, install new one**

```bash
npm uninstall @anthropic-ai/sdk
npm install @anthropic-ai/claude-agent-sdk
```

Expected: `node_modules/@anthropic-ai/claude-agent-sdk` exists, `@anthropic-ai/sdk` is gone from `package.json`.

**Step 2: Verify the new package exports the expected symbols**

```bash
node -e "const s = require('@anthropic-ai/claude-agent-sdk'); console.log(Object.keys(s))"
```

Expected output includes: `query`, `tool`, `createSdkMcpServer`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap @anthropic-ai/sdk for @anthropic-ai/claude-agent-sdk"
```

---

### Task 2: Add OAuth token to config

**Files:**
- Modify: `src/config.ts`

**Step 1: Add `CLAUDE_CODE_OAUTH_TOKEN` as an optional field**

In `src/config.ts`, add one line inside the `envSchema` object after `ANTHROPIC_MODEL`:

```typescript
CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
```

The full schema block should look like:
```typescript
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('127.0.0.1'),
  CREDENTIALS_MASTER_KEY: z.string().min(1, 'CREDENTIALS_MASTER_KEY is required'),
  SCRAPE_CRON: z.string().default('0 6 * * *'),
  SCRAPE_TIMEZONE: z.string().default('Asia/Jerusalem'),
  SCRAPE_START_DATE_MONTHS_BACK: z.coerce.number().default(3),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  API_TOKEN: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  SCRAPE_TIMEOUT: z.coerce.number().default(120000),
  SCRAPE_SHOW_BROWSER: z.coerce.boolean().default(false),
});
```

Note: The agent SDK reads `CLAUDE_CODE_OAUTH_TOKEN` directly from `process.env` — no need to pass it anywhere in code. Adding it here documents the supported env var and validates it if present.

**Step 2: Verify the server still starts**

```bash
npm run dev
```

Expected: Server starts on port 3000, no TypeScript errors.

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add CLAUDE_CODE_OAUTH_TOKEN config field"
```

---

### Task 3: Rewrite `tools.ts` with in-process MCP server

**Files:**
- Modify: `src/ai/tools.ts`

This is the core of the migration. Replace the `buildTools()` export (which returned raw Anthropic tool definitions) with `buildFinancialMcpServer()` (which returns an in-process MCP server). The Drizzle ORM query logic inside each tool is **identical** to today — only the wrapper changes.

**Step 1: Replace the file contents**

Replace `src/ai/tools.ts` entirely with:

```typescript
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { eq, and, gte, lte, like, sql, count, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';
import { escapeLike } from '../api/validation.js';

export function buildFinancialMcpServer(categoryNames: string[]) {
  const categoryEnum = categoryNames.length > 0
    ? z.enum(categoryNames as [string, ...string[]])
    : z.string();

  return createSdkMcpServer({
    name: 'financial-tools',
    version: '1.0.0',
    tools: [
      tool(
        'query_transactions',
        'Search and filter transactions from the database. Use this to find specific transactions or answer questions about spending.',
        {
          account_id: z.number().optional().describe('Filter by account ID'),
          start_date: z.string().optional().describe('Start date (ISO string, e.g. "2026-01-01")'),
          end_date: z.string().optional().describe('End date (ISO string, e.g. "2026-01-31")'),
          category: z.string().optional().describe('Filter by category'),
          status: z.enum(['completed', 'pending']).optional().describe('Transaction status'),
          min_amount: z.number().optional().describe('Minimum charged amount'),
          max_amount: z.number().optional().describe('Maximum charged amount'),
          search: z.string().optional().describe('Search term for description (partial match)'),
          limit: z.number().optional().describe('Max results to return (default 50, max 200)'),
        },
        async (args) => {
          const result = queryTransactions(args);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'get_spending_summary',
        'Get aggregated spending totals. Group by category, month, or account to understand spending patterns.',
        {
          group_by: z.enum(['category', 'month', 'account']).optional().describe(
            'How to group the results (default: category)',
          ),
          account_id: z.number().optional().describe('Filter by account ID'),
          start_date: z.string().optional().describe('Start date (ISO string)'),
          end_date: z.string().optional().describe('End date (ISO string)'),
        },
        async (args) => {
          const result = getSpendingSummary(args);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'categorize_transaction',
        'Assign a category to a specific transaction by its ID.',
        {
          transaction_id: z.number().describe('The transaction ID'),
          category: categoryEnum.describe('The category to assign'),
        },
        async (args) => {
          const result = categorizeTransaction(args as { transaction_id: number; category: string });
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'get_account_balances',
        'Get a list of all configured accounts with their latest scrape info and transaction counts.',
        {},
        async () => {
          const result = getAccountBalances();
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
    ],
  });
}

// ── Private query functions (unchanged Drizzle ORM logic) ──────────────────────

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

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors. If you see `Cannot find module '@anthropic-ai/claude-agent-sdk'`, check Task 1 completed correctly.

**Step 3: Commit**

```bash
git add src/ai/tools.ts
git commit -m "feat: rewrite tools.ts as in-process MCP server using createSdkMcpServer"
```

---

### Task 4: Rewrite `agent.ts` to use `query()`

**Files:**
- Modify: `src/ai/agent.ts`

Replace the file entirely. `chat()` uses `query()` with the MCP server. `batchCategorize()` uses `query()` with no tools and `maxTurns: 1`.

**Step 1: Replace the file contents**

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { buildFinancialAdvisorPrompt } from './prompts.js';
import { buildFinancialMcpServer } from './tools.js';

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
  const server = buildFinancialMcpServer(categoryNames);

  const historyLines = conversationHistory.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
  );
  const lastMsg = conversationHistory[conversationHistory.length - 1];
  const prompt = historyLines.length > 0
    ? `Previous conversation:\n${historyLines.join('\n\n')}\n\nCurrent question: ${lastMsg.content}`
    : lastMsg.content;

  for await (const msg of query({
    prompt,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      mcpServers: { 'financial-tools': server },
      allowedTools: ['mcp__financial-tools__*'],
      maxTurns: 10,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') return msg.result;
      if (msg.subtype === 'error_max_turns') {
        return 'I reached the maximum number of analysis steps. Please try a more specific question.';
      }
      throw new Error(`Agent error (${msg.subtype})`);
    }
  }

  return 'No response generated.';
}

export async function batchCategorize(
  batchSize: number = 50,
  ids?: number[],
): Promise<{ categorized: number }> {
  const { eq, isNull } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions, categories } = await import('../db/schema.js');

  const categoryRows = db.select({ name: categories.name }).from(categories).all();
  const categoryNames = categoryRows.map(r => r.name);
  if (categoryNames.length === 0) return { categorized: 0 };

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

  let text = '';
  for await (const msg of query({
    prompt: `Categorize these transactions:\n${txnList}`,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt: `You are a transaction categorizer. Assign each transaction one of these categories: ${categoryList}. Respond with ONLY a JSON array of objects with "id" and "category" fields. No markdown, no explanation.`,
      allowedTools: [],
      maxTurns: 1,
    },
  })) {
    if (msg.type === 'result' && msg.subtype === 'success') {
      text = msg.result;
    }
  }

  let categorized = 0;
  try {
    const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const results: Array<{ id: number; category: string }> = JSON.parse(clean);
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

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/ai/agent.ts
git commit -m "feat: migrate agent.ts to claude-agent-sdk query() with MCP server"
```

---

### Task 5: Smoke test the full stack

No automated tests exist. Verify manually that both AI features work end-to-end.

**Step 1: Start the dev server**

```bash
npm run dev
```

Expected: Server starts without errors. Watch for any import errors on startup.

**Step 2: Test `chat()` via the API**

In a new terminal:

```bash
curl -s -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What accounts do I have?"}]}' | jq .
```

Expected: JSON response with a `reply` field containing a natural-language answer from the agent. The agent should call `get_account_balances` internally before responding.

**Step 3: Test `batchCategorize()` via the API**

```bash
curl -s -X POST http://localhost:3000/api/ai/categorize \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

Expected: JSON response like `{"categorized": N}`. Even `{"categorized": 0}` is valid (means no uncategorized transactions).

**Step 4: Commit if everything works**

```bash
git add -A
git commit -m "feat: complete migration to @anthropic-ai/claude-agent-sdk with in-process MCP"
```

---

## Troubleshooting

**`Cannot find module '@anthropic-ai/claude-agent-sdk'`**
Run `npm install` again. Check `package.json` has the dependency.

**`z.enum requires at least one value`**
The DB has no categories. Seed some via the Categories UI before testing.

**`error_during_execution` from the agent**
Check the server logs for the underlying error. Usually means a tool threw an exception — look at the Drizzle query in that tool's handler.

**OAuth not working**
Set `CLAUDE_CODE_OAUTH_TOKEN` in `.env` and remove `ANTHROPIC_API_KEY`. The SDK prioritises OAuth when `CLAUDE_CODE_OAUTH_TOKEN` is present in the environment.
