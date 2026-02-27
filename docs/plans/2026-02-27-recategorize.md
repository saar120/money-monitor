# Re-categorize Transactions by Date Range — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `POST /api/ai/recategorize` endpoint and a UI section on the Categories page that lets the user re-run AI categorization over all transactions (overwriting existing categories) within an optional date range.

**Architecture:** Add a `recategorize()` function in `agent.ts` (same AI call as `batchCategorize` but without the `isNull` filter and with optional date filters). Wire it to a new endpoint with a Zod schema. Add a UI card to `CategoryManager.vue` with date inputs and a button.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM (better-sqlite3), Zod, Vue 3 (Composition API), shadcn/ui components.

---

### Task 1: Add `recategorize()` to `src/ai/agent.ts`

**Files:**
- Modify: `src/ai/agent.ts`

**Step 1: Add the `recategorize` export function after `batchCategorize` (line 120)**

```typescript
export async function recategorize(
  startDate?: string,
  endDate?: string,
): Promise<{ categorized: number }> {
  const { eq, gte, lte, and } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions, categories } = await import('../db/schema.js');

  const categoryRows = db.select({ name: categories.name }).from(categories).all();
  const categoryNames = categoryRows.map(r => r.name);
  if (categoryNames.length === 0) return { categorized: 0 };

  const conditions = [];
  if (startDate) conditions.push(gte(transactions.date, startDate));
  if (endDate) conditions.push(lte(transactions.date, endDate));

  const toProcess = conditions.length > 0
    ? db.select().from(transactions).where(and(...conditions)).all()
    : db.select().from(transactions).all();

  if (toProcess.length === 0) return { categorized: 0 };

  const validIds = new Set(toProcess.map(t => t.id));
  const validCategories = new Set(categoryNames);

  const txnList = toProcess.map(t =>
    `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}`
  ).join('\n');

  const categoryList = categoryNames.join(', ');

  let text = '';
  for await (const msg of query({
    prompt: `Categorize these transactions:\n${txnList}`,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt: `You are a transaction categorizer. Assign each transaction one of these categories: ${categoryList}. Respond with ONLY a JSON array of objects with "id" and "category" fields. No markdown, no explanation.`,
      tools: [],
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
    // malformed model response — return 0
  }

  return { categorized };
}
```

**Step 2: Verify the file compiles**

```bash
cd /Users/saaramrani/projects/money-monitor && npx tsc --noEmit
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/ai/agent.ts
git commit -m "feat: add recategorize() function to agent.ts"
```

---

### Task 2: Add Zod schema and endpoint

**Files:**
- Modify: `src/api/validation.ts`
- Modify: `src/api/ai.routes.ts`

**Step 1: Add `recategorizeSchema` to `src/api/validation.ts` after `categorizeSchema` (line 62)**

```typescript
export const recategorizeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
```

**Step 2: Update `src/api/ai.routes.ts`**

Change the import on line 2 from:
```typescript
import { chat, batchCategorize } from '../ai/agent.js';
```
to:
```typescript
import { chat, batchCategorize, recategorize } from '../ai/agent.js';
```

Change the import on line 3 from:
```typescript
import { chatSchema, categorizeSchema } from './validation.js';
```
to:
```typescript
import { chatSchema, categorizeSchema, recategorizeSchema } from './validation.js';
```

Add the new endpoint after the existing `/api/ai/categorize` route (after line 41, before the closing `}`):

```typescript
  app.post('/api/ai/recategorize', async (request, reply) => {
    const parsed = recategorizeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await recategorize(parsed.data.startDate, parsed.data.endDate);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recategorization failed';
      return reply.status(500).send({ error: message });
    }
  });
```

**Step 3: Verify the file compiles**

```bash
cd /Users/saaramrani/projects/money-monitor && npx tsc --noEmit
```

Expected: no errors

**Step 4: Commit**

```bash
git add src/api/validation.ts src/api/ai.routes.ts
git commit -m "feat: add POST /api/ai/recategorize endpoint"
```

---

### Task 3: Add `aiRecategorize` to frontend API client

**Files:**
- Modify: `dashboard/src/api/client.ts`

**Step 1: Add `aiRecategorize` function after `aiCategorize` (after line 231)**

```typescript
export function aiRecategorize(startDate?: string, endDate?: string) {
  return request<{ categorized: number }>('/ai/recategorize', {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate }),
  });
}
```

**Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add aiRecategorize API client function"
```

---

### Task 4: Add Re-categorize UI to `CategoryManager.vue`

**Files:**
- Modify: `dashboard/src/components/CategoryManager.vue`

**Step 1: Add import for `aiRecategorize` in the script block**

Change line 3 from:
```typescript
import { getCategories, createCategory, updateCategory, deleteCategory, type Category } from '../api/client';
```
to:
```typescript
import { getCategories, createCategory, updateCategory, deleteCategory, aiRecategorize, type Category } from '../api/client';
```

**Step 2: Add reactive state for re-categorize (after `saving` ref on line 27)**

```typescript
// Re-categorize state
const recatStartDate = ref('');
const recatEndDate = ref('');
const recatLoading = ref(false);
const recatResult = ref('');
const recatError = ref('');

async function runRecategorize() {
  recatLoading.value = true;
  recatResult.value = '';
  recatError.value = '';
  try {
    const res = await aiRecategorize(recatStartDate.value || undefined, recatEndDate.value || undefined);
    recatResult.value = `${res.categorized} transactions categorized`;
  } catch (e: unknown) {
    recatError.value = e instanceof Error ? e.message : 'Recategorization failed';
  } finally {
    recatLoading.value = false;
  }
}
```

**Step 3: Add the UI card to the template after the closing `</Card>` tag (after line 188, before `</div>`)**

```html
    <!-- Re-categorize section -->
    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-sm">Re-categorize Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-xs text-muted-foreground mb-3">
          Re-run AI categorization over all transactions in a date range, overwriting existing categories. Leave dates empty to process all transactions.
        </p>
        <div class="flex gap-2 items-end flex-wrap">
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">Start Date</label>
            <Input v-model="recatStartDate" type="date" class="w-36" />
          </div>
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">End Date</label>
            <Input v-model="recatEndDate" type="date" class="w-36" />
          </div>
          <Button size="sm" :disabled="recatLoading" @click="runRecategorize">
            {{ recatLoading ? 'Running...' : 'Re-categorize All' }}
          </Button>
        </div>
        <p v-if="recatResult" class="text-sm text-green-600 mt-2">{{ recatResult }}</p>
        <p v-if="recatError" class="text-sm text-destructive mt-2">{{ recatError }}</p>
      </CardContent>
    </Card>
```

**Step 4: Verify the app builds**

```bash
cd /Users/saaramrani/projects/money-monitor/dashboard && npm run build
```

Expected: no errors

**Step 5: Commit**

```bash
git add dashboard/src/components/CategoryManager.vue
git commit -m "feat: add re-categorize by date range UI to CategoryManager"
```

---

### Task 5: Manual smoke test

**Start the dev server:**
```bash
cd /Users/saaramrani/projects/money-monitor && npm run dev
```

**Check:**
1. Navigate to `/categories`
2. Scroll to bottom — "Re-categorize Transactions" card should be visible
3. Leave dates empty, click "Re-categorize All" — button should show "Running..." while in progress
4. On completion, a green message shows "N transactions categorized"
5. Navigate to `/transactions` and verify categories have been updated
6. Repeat with a date range (e.g. start=2026-01-01, end=2026-01-31) — only transactions in that range should be re-categorized
