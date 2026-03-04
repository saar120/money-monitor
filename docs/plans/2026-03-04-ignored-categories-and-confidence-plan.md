# Ignored Categories & Confidence Score — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two category features: (1) ignore entire categories from statistics with cascade to transactions, and (2) replace boolean needsReview with numeric confidence score.

**Architecture:** Both features require a Drizzle migration, backend API changes, AI prompt updates, and dashboard UI updates. Feature 1 adds `ignoredFromStats` to categories table with cascade logic. Feature 2 adds `confidence` to transactions table and derives `needsReview` from a 0.8 threshold.

**Tech Stack:** Drizzle ORM (SQLite), Fastify, Anthropic Claude Agent SDK, Vue 3 + shadcn-vue

---

### Task 1: Database Schema — Add `ignoredFromStats` to categories and `confidence` to transactions

**Files:**
- Modify: `src/db/schema.ts:66-73` (categories table) and `src/db/schema.ts:19-41` (transactions table)

**Step 1: Add columns to schema.ts**

In the `categories` table definition (line 66-73), add after `rules`:

```ts
ignoredFromStats: integer('ignored_from_stats', { mode: 'boolean' }).notNull().default(false),
```

In the `transactions` table definition (line 19-41), add after `reviewReason`:

```ts
confidence: real('confidence'),
```

**Step 2: Generate migration**

Run: `npm run db:generate`

This should produce a new migration file adding both columns.

**Step 3: Verify migration was generated**

Run: `ls src/db/migrations/`

Expected: New migration file like `XXXX_*.sql` with both `ALTER TABLE` statements.

**Step 4: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add ignoredFromStats to categories and confidence to transactions schema"
```

---

### Task 2: Backend — Update category API for ignored toggle with cascade

**Files:**
- Modify: `src/api/validation.ts:123-127` (updateCategorySchema)
- Modify: `src/api/categories.routes.ts:28-40` (PATCH handler)

**Step 1: Add `ignoredFromStats` to validation schema**

In `src/api/validation.ts`, update `updateCategorySchema` (line 123-127):

```ts
export const updateCategorySchema = z.object({
  label: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  rules: z.string().max(500).nullable().optional(),
  ignoredFromStats: z.boolean().optional(),
});
```

**Step 2: Add cascade logic to PATCH handler**

In `src/api/categories.routes.ts`, update the PATCH handler (line 28-40). Add import for `transactions` schema at the top, and after the `db.update(categories)` call, add cascade logic:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { categories, transactions } from '../db/schema.js';
import { createCategorySchema, updateCategorySchema } from './validation.js';
import { parseIntParam, validateBody } from './helpers.js';
```

Replace the entire PATCH handler body with:

```ts
  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'category id', reply);
    if (id === null) return;

    const data = validateBody(updateCategorySchema, request.body, reply);
    if (!data) return;

    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    const [updated] = db.update(categories).set(data).where(eq(categories.id, id)).returning().all();

    // Cascade ignoredFromStats to transactions
    if (data.ignoredFromStats !== undefined) {
      db.update(transactions)
        .set({ ignored: data.ignoredFromStats })
        .where(eq(transactions.category, existing.name))
        .run();
    }

    return reply.send({ category: updated });
  });
```

**Step 3: Commit**

```bash
git add src/api/validation.ts src/api/categories.routes.ts
git commit -m "feat: add ignoredFromStats toggle to category API with cascade to transactions"
```

---

### Task 3: Backend — Cascade on new categorization (batch + interactive)

**Files:**
- Modify: `src/ai/agent.ts:22-30` (processCategoryResults) and `src/ai/agent.ts:60-109` (categorizeBatch)
- Modify: `src/ai/tools.ts:260-270` (categorizeTransaction)

**Step 1: Update `getCategoriesWithRules` to also return `ignoredFromStats`**

In `src/ai/agent.ts`, update the `getCategoriesWithRules` function (line 37-41) and its return type in `prompts.ts`:

First, update the `CategoryWithRules` interface in `src/ai/prompts.ts` (line 1-4):

```ts
export interface CategoryWithRules {
  name: string;
  rules: string | null;
  ignoredFromStats: boolean;
}
```

Then update `getCategoriesWithRules` in `src/ai/agent.ts` (line 37-41):

```ts
async function getCategoriesWithRules(): Promise<CategoryWithRules[]> {
  const { db } = await import('../db/connection.js');
  const { categories } = await import('../db/schema.js');
  return db.select({
    name: categories.name,
    rules: categories.rules,
    ignoredFromStats: categories.ignoredFromStats,
  }).from(categories).all();
}
```

**Step 2: Add ignored-category lookup to `categorizeBatch`**

In `src/ai/agent.ts`, in the `categorizeBatch` function (around line 68-70), after loading categories, build a set of ignored category names:

```ts
  const ignoredCategories = new Set(catRows.filter(r => r.ignoredFromStats).map(r => r.name));
```

Then in the for loop (line 93-103), after setting the category, also set `ignored` if the category is in the ignored set:

```ts
    for (const { id, category, confidence, reviewReason } of processCategoryResults(text, validCategories, validIds)) {
      const needsReview = confidence !== undefined && confidence < 0.8;
      db.update(transactions)
        .set({
          category,
          confidence: confidence ?? null,
          needsReview,
          reviewReason: needsReview ? (reviewReason ?? 'Low confidence categorization') : null,
          ignored: ignoredCategories.has(category) ? true : undefined,
        })
        .where(eq(transactions.id, id))
        .run();
      categorized++;
    }
```

Note: We use `undefined` (not `false`) for the ignored field when the category is NOT ignored, so we don't overwrite a previously user-set `ignored=true` on an individual transaction. Drizzle will skip `undefined` fields in `.set()`.

**Step 3: Update `categorizeTransaction` tool in `tools.ts`**

In `src/ai/tools.ts`, update the `categorizeTransaction` function (line 260-270) to also check if the assigned category is ignored. This requires loading category data. Add at the top of the function:

```ts
function categorizeTransaction(input: CategorizeTransactionInput): string {
  const existing = db.select().from(transactions).where(eq(transactions.id, input.transaction_id)).get();
  if (!existing) return JSON.stringify({ error: 'Transaction not found' });

  // Check if category is ignored
  const { categories } = require('../db/schema.js');
  const cat = db.select({ ignoredFromStats: categories.ignoredFromStats })
    .from(categories)
    .where(eq(categories.name, input.category))
    .get();

  const needsReview = input.confidence !== undefined && input.confidence < 0.8;

  db.update(transactions)
    .set({
      category: input.category,
      confidence: input.confidence ?? null,
      needsReview,
      reviewReason: needsReview ? (input.review_reason ?? 'Low confidence categorization') : null,
      ...(cat?.ignoredFromStats ? { ignored: true } : {}),
    })
    .where(eq(transactions.id, input.transaction_id))
    .run();

  return JSON.stringify({ success: true, transactionId: input.transaction_id, category: input.category });
}
```

Also update the `CategorizeTransactionInput` interface and the `buildCategorizeTransactionTool` tool schema to include `confidence` and `review_reason`:

```ts
interface CategorizeTransactionInput {
  transaction_id: number;
  category: string;
  confidence?: number;
  review_reason?: string;
}
```

Update `buildCategorizeTransactionTool` (line 51-68):

```ts
export function buildCategorizeTransactionTool(categoryNames: string[]) {
  const categoryEnum = categoryNames.length > 0
    ? z.enum(categoryNames as [string, ...string[]])
    : z.string();

  return tool(
    'categorize_transaction',
    'Assign a category to a specific transaction by its ID. You must provide a confidence score (0-1).',
    {
      transaction_id: z.number().describe('The transaction ID'),
      category: categoryEnum.describe('The category to assign'),
      confidence: z.number().min(0).max(1).describe('Confidence level 0.0-1.0 for this categorization'),
      review_reason: z.string().optional().describe('Reason if confidence is low (<0.8)'),
    },
    async (args) => {
      const result = categorizeTransaction({
        transaction_id: args.transaction_id,
        category: String(args.category),
        confidence: args.confidence,
        review_reason: args.review_reason,
      });
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );
}
```

Note: We need to use a proper import for `categories` in `tools.ts`. Since the file already imports from `../db/schema.js`, add `categories` to that import:

```ts
import { transactions, accounts, categories } from '../db/schema.js';
```

**Step 4: Commit**

```bash
git add src/ai/agent.ts src/ai/prompts.ts src/ai/tools.ts
git commit -m "feat: cascade ignoredFromStats on categorization, add confidence to categorize flow"
```

---

### Task 4: AI Prompts — Update all agent prompts for ignored categories + confidence

**Files:**
- Modify: `src/ai/prompts.ts` (all prompt builder functions)

**Step 1: Update `formatCategoryList` and prompt builders to partition ignored categories**

Update `formatCategoryList` (line 7-11) to accept the full `CategoryWithRules` type (it already does). No change needed.

Add a new helper function after `formatCategoryList`:

```ts
/** Split categories into active and ignored lists for prompt building. */
export function partitionCategories(cats: CategoryWithRules[]): { active: CategoryWithRules[]; ignored: CategoryWithRules[] } {
  const active = cats.filter(c => !c.ignoredFromStats);
  const ignored = cats.filter(c => c.ignoredFromStats);
  return { active, ignored };
}
```

**Step 2: Update `buildBatchCategorizerPrompt`**

Replace the function (line 130-139):

```ts
export function buildBatchCategorizerPrompt(cats: CategoryWithRules[]): string {
  const { active, ignored } = partitionCategories(cats);
  const ignoredNote = ignored.length > 0
    ? `\n\nIgnored categories (still valid for assignment, but excluded from user statistics):\n${ignored.map(c => `- ${c.name}`).join('\n')}`
    : '';

  return `You are a transaction categorizer for an Israeli user's bank transactions. Assign each transaction one of these categories:

${formatCategoryList(active)}${ignoredNote}

Rate your confidence from 0.0 to 1.0 for each categorization:
- 0.9-1.0: Very clear match (e.g., "SHUFERSAL" → groceries)
- 0.7-0.8: Likely correct but ambiguous
- 0.5-0.7: Best guess, uncertain — provide a reviewReason
- Below 0.5: Very uncertain — must provide a reviewReason

Respond with ONLY a JSON array. Each object must have: "id" (number), "category" (string), "confidence" (number 0-1). Include "reviewReason" (string) when confidence is below 0.8. No markdown, no explanation.`;
}
```

**Step 3: Update `buildSpendingAnalystPrompt` and `buildBudgetAdvisorPrompt`**

These two functions receive `categoryNames: string[]`. We need to change them to receive partitioned info. Update their signatures to accept both active and ignored category names:

```ts
export function buildSpendingAnalystPrompt(categoryNames: string[], ignoredCategoryNames: string[]): string {
  const list = categoryNames.join(', ');
  const ignoredNote = ignoredCategoryNames.length > 0
    ? `\n- Ignored categories (excluded from statistics): ${ignoredCategoryNames.join(', ')}. Do NOT include these in your analysis or summaries unless the user explicitly asks about them.`
    : '';
  return `You are a spending analyst with direct access to the user's bank and credit card transaction data from Israeli financial institutions.

Your specialization:
- Break down spending by category, time period, account, or merchant
- Compare spending between any two time periods (month vs month, week vs week, etc.)
- Identify top merchants by total spending, frequency, or average amount
- Analyze spending trends over multiple months to spot increases or decreases
- Find specific transactions matching search criteria
- Provide clear summaries with tables for comparative data

${SHARED_RULES}
- Be concise but thorough. Use tables for comparative data when helpful.
- Available categories: ${list}.${ignoredNote}
- You have access to tools for querying transactions, getting spending summaries, comparing periods, analyzing trends, and finding top merchants.`;
}
```

Apply the same pattern to `buildBudgetAdvisorPrompt`:

```ts
export function buildBudgetAdvisorPrompt(categoryNames: string[], ignoredCategoryNames: string[]): string {
  const list = categoryNames.join(', ');
  const ignoredNote = ignoredCategoryNames.length > 0
    ? `\n- Ignored categories (excluded from statistics): ${ignoredCategoryNames.join(', ')}. Do NOT include these in your advice or analysis unless the user explicitly asks about them.`
    : '';
  return `You are a personal budget advisor with direct access to the user's bank and credit card transaction data from Israeli financial institutions.

Your specialization:
- Provide actionable savings insights and recommendations based on real spending data
- Identify areas where the user can reduce spending
- Spot unusually large or suspicious charges
- Suggest budget allocations based on spending patterns
- Analyze spending trends to warn about increasing costs
- Identify recurring charges that could be reduced or eliminated
- Provide practical, specific financial advice (not generic tips)

${SHARED_RULES}
- Always base your advice on the user's actual data — never give generic advice without checking their spending first.
- When recommending cuts, be specific about which merchants or categories to target.
- Available categories: ${list}.${ignoredNote}
- You have access to tools for querying transactions, getting spending summaries, analyzing trends, detecting recurring payments, and finding top merchants.`;
}
```

**Step 4: Update `buildCategorizerPrompt`**

The categorizer should be able to assign ignored categories but aware of the concept:

```ts
export function buildCategorizerPrompt(categoryNames: string[], ignoredCategoryNames: string[]): string {
  const list = categoryNames.join(', ');
  const ignoredNote = ignoredCategoryNames.length > 0
    ? `\n- Note: These categories are excluded from statistics but are still valid to assign: ${ignoredCategoryNames.join(', ')}.`
    : '';
  return `You are a transaction categorization expert with direct access to the user's bank and credit card transaction data from Israeli financial institutions.

Your specialization:
- Categorize individual transactions into the correct category
- Review and fix incorrectly categorized transactions
- Handle ambiguous transactions that could fit multiple categories
- Explain your categorization reasoning when asked
- Find and display uncategorized transactions

${SHARED_RULES}
- Use ONLY these categories: ${list}.${ignoredNote}
- When categorizing, consider the merchant name, amount, and any memo information.
- If a transaction is genuinely ambiguous, pick the most likely category and explain your reasoning.
- You must provide a confidence score (0.0-1.0) for each categorization.
- You have access to tools for querying transactions and assigning categories.`;
}
```

**Step 5: Update callers to pass partitioned category info**

In `src/ai/agent.ts`, update the `chat` function (line 43-56) to partition categories:

```ts
export async function chat(conversationHistory: ChatMessage[]): Promise<AgentResult> {
  const cats = await getCategoriesWithRules();
  const { active, ignored } = partitionCategories(cats);
  const categoryNames = cats.map(c => c.name);
  const ignoredCategoryNames = ignored.map(c => c.name);

  // ... rest of function
  return runOrchestrator(prompt, categoryNames, ignoredCategoryNames);
}
```

Import `partitionCategories` from prompts.ts:

```ts
import { buildBatchCategorizerPrompt, partitionCategories } from './prompts.js';
```

Update `runOrchestrator` signature and pass through to sub-agents. In `src/ai/agents/orchestrator.ts`:

```ts
export async function runOrchestrator(
  prompt: string,
  categoryNames: string[],
  ignoredCategoryNames: string[] = [],
): Promise<AgentResult> {
```

And update `buildOrchestratorMcpServer` to accept and pass `ignoredCategoryNames`:

```ts
function buildOrchestratorMcpServer(categoryNames: string[], ignoredCategoryNames: string[], consultedAgents: AgentType[]) {
```

Pass `ignoredCategoryNames` to each sub-agent call:
- `runSpendingAnalyst(args.question, categoryNames, ignoredCategoryNames)`
- `runBudgetAdvisor(args.question, categoryNames, ignoredCategoryNames)`
- `runCategorizer(args.question, categoryNames, ignoredCategoryNames)`

Update each sub-agent file:

In `src/ai/agents/spending-analyst.ts`:
```ts
export async function runSpendingAnalyst(question: string, categoryNames: string[], ignoredCategoryNames: string[] = []): Promise<string> {
  return runAgent(question, {
    serverName: 'analyst-tools',
    systemPrompt: buildSpendingAnalystPrompt(categoryNames, ignoredCategoryNames),
    // ...
  });
}
```

In `src/ai/agents/budget-advisor.ts`:
```ts
export async function runBudgetAdvisor(question: string, categoryNames: string[], ignoredCategoryNames: string[] = []): Promise<string> {
  return runAgent(question, {
    serverName: 'advisor-tools',
    systemPrompt: buildBudgetAdvisorPrompt(categoryNames, ignoredCategoryNames),
    // ...
  });
}
```

In `src/ai/agents/categorizer.ts`:
```ts
export async function runCategorizer(question: string, categoryNames: string[], ignoredCategoryNames: string[] = []): Promise<string> {
  return runAgent(question, {
    serverName: 'categorizer-tools',
    systemPrompt: buildCategorizerPrompt(categoryNames, ignoredCategoryNames),
    // ...
  });
}
```

**Step 6: Commit**

```bash
git add src/ai/prompts.ts src/ai/agent.ts src/ai/agents/
git commit -m "feat: update all AI prompts for ignored categories awareness and confidence scoring"
```

---

### Task 5: Backend — Update `processCategoryResults` for confidence

**Files:**
- Modify: `src/ai/agent.ts:22-30` (processCategoryResults)

**Step 1: Update the return type and parsing**

Replace `processCategoryResults` (line 22-30):

```ts
/** Parse the model's JSON response, validate categories, and return valid results. */
function processCategoryResults(
  text: string,
  validCategories: Set<string>,
  validIds: Set<number>,
): Array<{ id: number; category: string; confidence?: number; reviewReason?: string }> {
  const clean = cleanJsonResponse(text);
  const results: Array<{ id: number; category: string; confidence?: number; reviewReason?: string }> = JSON.parse(clean);
  return results.filter(({ id, category }) => validIds.has(id) && validCategories.has(category));
}
```

This is already covered in Task 3's Step 2 where we use `confidence` in the loop. Ensure consistency.

**Step 2: Commit** (combine with Task 3 if done together, or standalone)

```bash
git add src/ai/agent.ts
git commit -m "feat: processCategoryResults now handles confidence instead of needsReview"
```

---

### Task 6: Dashboard — Category type + API client update

**Files:**
- Modify: `dashboard/src/api/client.ts:244-251` (Category interface)
- Modify: `dashboard/src/api/client.ts:264-269` (updateCategory function)
- Modify: `dashboard/src/api/client.ts:73-94` (Transaction interface)

**Step 1: Update the Category interface**

In `dashboard/src/api/client.ts`, update the `Category` interface (line 244-251):

```ts
export interface Category {
  id: number;
  name: string;
  label: string;
  color: string | null;
  rules: string | null;
  ignoredFromStats: boolean;
  createdAt: string;
}
```

**Step 2: Update `updateCategory` to accept `ignoredFromStats`**

Update the `updateCategory` function (line 264-269):

```ts
export function updateCategory(id: number, data: { label?: string; color?: string; rules?: string | null; ignoredFromStats?: boolean }) {
  return request<{ category: Category }>(`/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
```

**Step 3: Update Transaction interface for confidence**

In the `Transaction` interface (line 73-94), add `confidence`:

```ts
export interface Transaction {
  id: number;
  accountId: number;
  identifier: number | null;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  description: string;
  memo: string | null;
  type: string;
  status: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  category: string | null;
  ignored: boolean;
  needsReview: boolean;
  reviewReason: string | null;
  confidence: number | null;
  hash: string;
  createdAt: string;
}
```

**Step 4: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: update frontend types for ignoredFromStats and confidence"
```

---

### Task 7: Dashboard — CategoryManager ignored toggle UI

**Files:**
- Modify: `dashboard/src/components/CategoryManager.vue`

**Step 1: Add the toggle import and handler**

In the `<script setup>` section, add the `Switch` import:

```ts
import { Switch } from '@/components/ui/switch';
```

Add a toggle handler function after `addCategory`:

```ts
async function toggleIgnored(cat: Category) {
  try {
    const res = await updateCategory(cat.id, { ignoredFromStats: !cat.ignoredFromStats });
    const idx = categories.value.findIndex(c => c.id === cat.id);
    if (idx !== -1) categories.value[idx] = res.category;
  } catch {
    error.value = 'Failed to update';
  }
}
```

**Step 2: Add the Ignored column to the table**

In the `<template>` section, add a new table header after "Rules":

```html
<TableHead>Ignored</TableHead>
```

And add a new cell in the `<TableRow v-for>` after the rules cell and before the actions cell:

```html
<TableCell>
  <Switch
    :checked="cat.ignoredFromStats"
    @update:checked="toggleIgnored(cat)"
    class="scale-75"
  />
</TableCell>
```

**Step 3: Add muted styling for ignored categories**

Add `:class` to the TableRow to mute ignored categories:

```html
<TableRow v-for="cat in categories" :key="cat.id" :class="{ 'opacity-50': cat.ignoredFromStats }">
```

**Step 4: Commit**

```bash
git add dashboard/src/components/CategoryManager.vue
git commit -m "feat: add ignored toggle to CategoryManager with muted styling"
```

---

### Task 8: Dashboard — InsightsPage confidence display

**Files:**
- Modify: `dashboard/src/components/InsightsPage.vue`

**Step 1: Add confidence column header**

In the `<TableHeader>` section, add after the "Reason" header:

```html
<TableHead>Confidence</TableHead>
```

**Step 2: Add confidence cell with colored indicator**

After the reviewReason cell (line 149-151), add:

```html
<TableCell class="text-center">
  <Badge
    v-if="txn.confidence != null"
    :variant="txn.confidence >= 0.8 ? 'default' : 'secondary'"
    :class="[
      'text-xs tabular-nums',
      txn.confidence < 0.5 ? 'bg-destructive/15 text-destructive' :
      txn.confidence < 0.8 ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' :
      'bg-success/15 text-success'
    ]"
  >
    {{ Math.round(txn.confidence * 100) }}%
  </Badge>
  <span v-else class="text-muted-foreground">—</span>
</TableCell>
```

**Step 3: Update empty-state colspan**

Update the "All clear" empty row colspan from 6 to 7:

```html
<TableCell colspan="7" class="text-center text-muted-foreground py-12">
```

**Step 4: Commit**

```bash
git add dashboard/src/components/InsightsPage.vue
git commit -m "feat: show confidence score with color indicator in Insights page"
```

---

### Task 9: Verify everything works end-to-end

**Step 1: Run TypeScript type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

**Step 2: Run the dev server**

Run: `npm run dev`

Expected: Server starts without errors.

**Step 3: Run migration**

Run: `npm run db:migrate` (or whatever the project uses to apply migrations)

**Step 4: Manual verification checklist**

- [ ] Open CategoryManager, see "Ignored" toggle column
- [ ] Toggle a category to ignored → verify transactions with that category got `ignored=true`
- [ ] Toggle back → verify transactions got `ignored=false`
- [ ] Open Insights page → verify "Confidence" column shows
- [ ] Trigger a batch categorize → verify confidence scores are saved and needsReview is derived from 0.8 threshold

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: fix any remaining issues from end-to-end testing"
```
