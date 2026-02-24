# Phase 4: AI Analysis

**Goal:** Integrate the Anthropic SDK to build an AI financial analysis agent with tool use. The agent can query transactions, get spending summaries, categorize transactions, and answer natural language questions about the user's finances.

**Prerequisites:** Phase 1–3 complete — DB, accounts, transactions, and summary routes are all working.

---

## Task 4.1 — System Prompts

### File: `src/ai/prompts.ts`

```typescript
export const FINANCIAL_ADVISOR_PROMPT = `You are a personal financial advisor with direct access to the user's bank and credit card transaction data from Israeli financial institutions.

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
- If asked to categorize, use these standard categories: food, transport, housing, utilities, entertainment, health, shopping, education, subscriptions, income, transfer, other.
- Dates in the database are ISO strings (e.g. "2026-02-24T00:00:00.000Z").

You have access to the following tools to query the user's financial data. Use them as needed.`;

export const CATEGORIES = [
  'food',
  'transport',
  'housing',
  'utilities',
  'entertainment',
  'health',
  'shopping',
  'education',
  'subscriptions',
  'income',
  'transfer',
  'other',
] as const;

export type Category = typeof CATEGORIES[number];
```

### Acceptance Criteria
- System prompt covers all behavioral rules
- Categories list is exported for use in tool definitions

---

## Task 4.2 — Tool Definitions

### File: `src/ai/tools.ts`

Define the tools the AI agent can call, and implement the handler functions that execute against the DB.

```typescript
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { eq, and, gte, lte, like, sql, count, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';
import { CATEGORIES } from './prompts.js';

// ─── Tool Definitions (sent to Anthropic API) ───

export const tools: Tool[] = [
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
          enum: CATEGORIES as unknown as string[],
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

// ─── Tool Handlers ───

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
      return categorizeTransaction(input as CategorizeTransactionInput);
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
  if (input.search) conditions.push(like(transactions.description, `%${input.search}%`));

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

  // category
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

### Acceptance Criteria
- All 4 tools are defined with proper JSON schemas
- `handleToolCall()` dispatches to the correct handler
- Each handler queries the DB and returns JSON strings
- `categorize_transaction` validates the transaction exists before updating
- `get_account_balances` includes transaction count and total spending per account

---

## Task 4.3 — Agent Module

### File: `src/ai/agent.ts`

Implements the conversational agent using the Anthropic SDK with a tool-use loop.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { FINANCIAL_ADVISOR_PROMPT } from './prompts.js';
import { tools, handleToolCall } from './tools.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Run a conversation turn with the AI agent.
 * Accepts the full conversation history and returns the assistant's reply.
 * Internally loops to handle tool calls until the model produces a final text response.
 */
export async function chat(conversationHistory: ChatMessage[]): Promise<string> {
  // Build messages array for the API
  const messages: Anthropic.MessageParam[] = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: FINANCIAL_ADVISOR_PROMPT,
      tools,
      messages,
    });

    // Check if the response contains tool use
    const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
    const textBlocks = response.content.filter(block => block.type === 'text');

    if (toolUseBlocks.length === 0) {
      // No tool calls — return the text response
      return textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n');
    }

    // There are tool calls — execute them and continue the loop
    // First, add the assistant's response (with tool_use blocks) to messages
    messages.push({ role: 'assistant', content: response.content });

    // Execute each tool call and build tool_result blocks
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

    // Add tool results as a user message
    messages.push({ role: 'user', content: toolResults });
  }

  return 'I reached the maximum number of analysis steps. Please try a more specific question.';
}

/**
 * Batch-categorize uncategorized transactions using the AI.
 * Fetches uncategorized transactions, sends them to the model in batches,
 * and updates the DB with the assigned categories.
 */
export async function batchCategorize(batchSize: number = 50): Promise<{ categorized: number }> {
  const { eq, isNull } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions } = await import('../db/schema.js');

  const uncategorized = db.select()
    .from(transactions)
    .where(isNull(transactions.category))
    .limit(batchSize)
    .all();

  if (uncategorized.length === 0) {
    return { categorized: 0 };
  }

  // Build a prompt with transaction descriptions
  const txnList = uncategorized.map(t =>
    `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}`
  ).join('\n');

  const response = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: 'You are a transaction categorizer. Assign each transaction one of these categories: food, transport, housing, utilities, entertainment, health, shopping, education, subscriptions, income, transfer, other. Respond with ONLY a JSON array of objects with "id" and "category" fields. No markdown, no explanation.',
    messages: [{
      role: 'user',
      content: `Categorize these transactions:\n${txnList}`,
    }],
  });

  // Parse the response
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.type === 'text' ? b.text : '')
    .join('');

  let categorized = 0;
  try {
    const results: Array<{ id: number; category: string }> = JSON.parse(text);
    for (const { id, category } of results) {
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

### Key Design Decisions
- **Tool-use loop**: Up to 10 rounds of tool calls before giving up
- **Conversation history**: Full history is passed to maintain context across turns
- **Batch categorize**: Sends uncategorized transactions in a single prompt, expects JSON array back
- **Stateless**: No in-memory conversation storage — the client sends the full history each time

### Acceptance Criteria
- `chat()` handles multi-turn tool use (model calls tool → we execute → send result → model responds)
- `chat()` returns a text string (the final assistant response)
- `batchCategorize()` updates transaction categories in the DB
- Max 10 tool rounds prevents infinite loops
- Gracefully handles missing `ANTHROPIC_API_KEY` (will fail on first API call, not on import)

---

## Task 4.4 — AI Routes

### File: `src/api/ai.routes.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import { chat, batchCategorize } from '../ai/agent.js';
import type { ChatMessage } from '../ai/agent.js';

export async function aiRoutes(app: FastifyInstance) {

  // POST /api/ai/chat — conversational AI agent
  app.post<{
    Body: {
      messages: ChatMessage[];
    }
  }>('/api/ai/chat', async (request, reply) => {
    const { messages } = request.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'messages array is required' });
    }

    // Validate message format
    for (const msg of messages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        return reply.status(400).send({
          error: 'Each message must have a "role" (user|assistant) and "content" string',
        });
      }
    }

    try {
      const response = await chat(messages);
      return reply.send({ response });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI chat failed';
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/ai/categorize — batch categorize uncategorized transactions
  app.post<{
    Body: { batchSize?: number }
  }>('/api/ai/categorize', async (request, reply) => {
    const batchSize = request.body?.batchSize ?? 50;

    try {
      const result = await batchCategorize(batchSize);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Categorization failed';
      return reply.status(500).send({ error: message });
    }
  });
}
```

### Register in `src/index.ts`

```typescript
import { aiRoutes } from './api/ai.routes.js';

await app.register(aiRoutes);
```

### Request/Response Examples

**POST /api/ai/chat**
```json
// Request
{
  "messages": [
    { "role": "user", "content": "How much did I spend on food this month?" }
  ]
}
// Response
{
  "response": "Based on your transactions this month, you've spent ₪2,340.50 on food across 28 transactions. Your top food expenses were..."
}
```

**POST /api/ai/chat (multi-turn)**
```json
// Request
{
  "messages": [
    { "role": "user", "content": "How much did I spend on food this month?" },
    { "role": "assistant", "content": "You spent ₪2,340.50 on food..." },
    { "role": "user", "content": "How does that compare to last month?" }
  ]
}
```

**POST /api/ai/categorize**
```json
// Request
{ "batchSize": 100 }
// Response
{ "categorized": 87 }
```

### Acceptance Criteria
- `POST /api/ai/chat` accepts full conversation history and returns a response string
- Multi-turn conversations work (context maintained via history)
- `POST /api/ai/categorize` categorizes uncategorized transactions in batches
- Returns 400 for invalid input, 500 for AI errors
- Does not crash if `ANTHROPIC_API_KEY` is empty (returns error message)

---

## Final Verification

```bash
npm run dev

# Chat (requires valid ANTHROPIC_API_KEY in .env)
curl -X POST http://localhost:3000/api/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"What are my top spending categories?"}]}'

# Batch categorize
curl -X POST http://localhost:3000/api/ai/categorize \
  -H 'Content-Type: application/json' \
  -d '{"batchSize": 50}'
```

---

## Files Created in This Phase

```
src/
├── ai/
│   ├── prompts.ts   (NEW)
│   ├── tools.ts     (NEW)
│   └── agent.ts     (NEW)
├── api/
│   └── ai.routes.ts (NEW)
└── index.ts          (MODIFIED — register AI routes)
```
