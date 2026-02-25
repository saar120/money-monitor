# Ignore Transactions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to right-click any transaction to mark it as ignored; ignored transactions stay visible but dimmed and are excluded from all statistics.

**Architecture:** Add an `ignored` boolean column to the SQLite `transactions` table via a Drizzle migration. Expose a `PATCH /api/transactions/:id/ignore` endpoint to toggle the flag. Filter `ignored = false` in the summary aggregation queries. In the frontend, dim ignored rows and show a right-click context menu to toggle the flag.

**Tech Stack:** Drizzle ORM (SQLite), Fastify, Zod, Vue 3, TypeScript, Shadcn Vue (Tailwind CSS)

---

### Task 1: Database Migration

**Files:**
- Create: `src/db/migrations/0001_add_ignored_to_transactions.sql`

**Step 1: Create the migration file**

```sql
ALTER TABLE `transactions` ADD COLUMN `ignored` integer NOT NULL DEFAULT 0;
```

**Step 2: Run the migration**

```bash
npm run db:migrate
```

Expected: Migration applied with no errors. Confirm by running:

```bash
sqlite3 data/money-monitor.db ".schema transactions"
```

Expected output includes: `ignored integer NOT NULL DEFAULT 0`

**Step 3: Commit**

```bash
git add src/db/migrations/0001_add_ignored_to_transactions.sql
git commit -m "feat: add ignored column migration to transactions"
```

---

### Task 2: Update Drizzle Schema

**Files:**
- Modify: `src/db/schema.ts:30` (after the `category` field, before `hash`)

**Step 1: Add the `ignored` field to the schema**

In `src/db/schema.ts`, add after the `category` line:

```typescript
  ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
```

The `transactions` table definition should now look like:

```typescript
export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  identifier: integer('identifier'),
  date: text('date').notNull(),
  processedDate: text('processed_date').notNull(),
  originalAmount: real('original_amount').notNull(),
  originalCurrency: text('original_currency').notNull().default('ILS'),
  chargedAmount: real('charged_amount').notNull(),
  description: text('description').notNull(),
  memo: text('memo'),
  type: text('type').notNull().default('normal'),
  status: text('status').notNull().default('completed'),
  installmentNumber: integer('installment_number'),
  installmentTotal: integer('installment_total'),
  category: text('category'),
  ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
  hash: text('hash').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add ignored field to transactions schema"
```

---

### Task 3: Backend — Validation Schema + PATCH Endpoint

**Files:**
- Modify: `src/api/validation.ts`
- Modify: `src/api/transactions.routes.ts`

**Step 1: Add the ignore body schema to `validation.ts`**

Add after the `transactionQuerySchema` block (after line 36):

```typescript
export const ignoreTransactionSchema = z.object({
  ignored: z.boolean(),
});
```

**Step 2: Add the PATCH endpoint to `transactions.routes.ts`**

Update the import at the top to include `ne` and `ne` (already has `eq`). Also import the new schema. The full updated file:

```typescript
import type { FastifyInstance } from 'fastify';
import { and, gte, lte, like, desc, eq, sql, count } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions } from '../db/schema.js';
import { transactionQuerySchema, ignoreTransactionSchema, escapeLike } from './validation.js';

export async function transactionsRoutes(app: FastifyInstance) {

  app.get('/api/transactions', async (request, reply) => {
    const parsed = transactionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const {
      accountId, startDate, endDate, category, status,
      minAmount, maxAmount, search,
      offset, limit, sortBy, sortOrder,
    } = parsed.data;

    const conditions = [];

    if (accountId !== undefined) conditions.push(eq(transactions.accountId, accountId));
    if (startDate) conditions.push(gte(transactions.date, startDate));
    if (endDate) conditions.push(lte(transactions.date, endDate));
    if (category) conditions.push(eq(transactions.category, category));
    if (status) conditions.push(eq(transactions.status, status));
    if (minAmount !== undefined) conditions.push(gte(transactions.chargedAmount, minAmount));
    if (maxAmount !== undefined) conditions.push(lte(transactions.chargedAmount, maxAmount));
    if (search) conditions.push(like(transactions.description, `%${escapeLike(search)}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = db
      .select({ total: count() })
      .from(transactions)
      .where(where)
      .all();

    const sortColumn = sortBy === 'chargedAmount' ? transactions.chargedAmount
      : sortBy === 'description' ? transactions.description
      : sortBy === 'processedDate' ? transactions.processedDate
      : transactions.date;

    const orderFn = sortOrder === 'asc' ? sql`${sortColumn} asc` : desc(sortColumn);

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

  app.patch('/api/transactions/:id/ignore', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid transaction id' });
    }

    const parsed = ignoreTransactionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!existing) {
      return reply.status(404).send({ error: 'Transaction not found' });
    }

    const [updated] = db
      .update(transactions)
      .set({ ignored: parsed.data.ignored })
      .where(eq(transactions.id, id))
      .returning()
      .all();

    return reply.send({ transaction: updated });
  });
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 4: Smoke-test the endpoint manually**

Start the server: `npm run dev`

```bash
# Get a transaction ID first
curl -s http://localhost:3000/api/transactions?limit=1 | jq '.transactions[0].id'

# Mark it as ignored (replace 1 with the actual ID)
curl -s -X PATCH http://localhost:3000/api/transactions/1/ignore \
  -H "Content-Type: application/json" \
  -d '{"ignored": true}' | jq '.transaction.ignored'
# Expected: true

# Unignore it
curl -s -X PATCH http://localhost:3000/api/transactions/1/ignore \
  -H "Content-Type: application/json" \
  -d '{"ignored": false}' | jq '.transaction.ignored'
# Expected: false (or 0)
```

**Step 5: Commit**

```bash
git add src/api/validation.ts src/api/transactions.routes.ts
git commit -m "feat: add PATCH /api/transactions/:id/ignore endpoint"
```

---

### Task 4: Backend — Exclude Ignored from Summary

**Files:**
- Modify: `src/api/summary.routes.ts`

**Step 1: Add `ignored` filter to all three summary queries**

The `eq` import is already present. Add `eq(transactions.ignored, false)` to the `conditions` array so it applies to all three groupBy modes.

Replace the `conditions` setup block (lines 19–24) with:

```typescript
    const conditions = [];
    if (accountId !== undefined) conditions.push(eq(transactions.accountId, accountId));
    if (startDate) conditions.push(gte(transactions.date, startDate));
    if (endDate) conditions.push(lte(transactions.date, endDate));
    conditions.push(eq(transactions.ignored, false));

    const where = and(...conditions);
```

Note: `where` no longer needs the ternary because `conditions` always has at least one entry (the `ignored` filter).

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Smoke-test that ignored transactions are excluded from summary**

```bash
# Mark transaction 1 as ignored
curl -s -X PATCH http://localhost:3000/api/transactions/1/ignore \
  -H "Content-Type: application/json" \
  -d '{"ignored": true}'

# Fetch summary - transaction 1's amount should not appear
curl -s http://localhost:3000/api/transactions/summary | jq '.summary'

# Unignore and check again - amount should be back
curl -s -X PATCH http://localhost:3000/api/transactions/1/ignore \
  -H "Content-Type: application/json" \
  -d '{"ignored": false}'
curl -s http://localhost:3000/api/transactions/summary | jq '.summary'
```

**Step 4: Commit**

```bash
git add src/api/summary.routes.ts
git commit -m "feat: exclude ignored transactions from summary statistics"
```

---

### Task 5: Frontend — API Client

**Files:**
- Modify: `dashboard/src/api/client.ts`

**Step 1: Add `ignored` to the `Transaction` interface**

In `dashboard/src/api/client.ts`, add `ignored: boolean` to the `Transaction` interface after `category`:

```typescript
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
  hash: string;
  createdAt: string;
}
```

**Step 2: Add the `ignoreTransaction` function**

Add after the `getTransactions` function:

```typescript
export function ignoreTransaction(id: number, ignored: boolean) {
  return request<{ transaction: Transaction }>(`/transactions/${id}/ignore`, {
    method: 'PATCH',
    body: JSON.stringify({ ignored }),
  });
}
```

**Step 3: Verify TypeScript compiles**

```bash
cd dashboard && npx tsc --noEmit && cd ..
```

Expected: No errors.

**Step 4: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add ignoreTransaction API client function"
```

---

### Task 6: Frontend — Context Menu + Dimmed Row Styling

**Files:**
- Modify: `dashboard/src/components/TransactionTable.vue`

**Step 1: Update the `<script setup>` section**

Replace the entire `<script setup>` block with:

```typescript
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getTransactions, getAccounts, ignoreTransaction, type Transaction, type TransactionFilters } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-vue-next';

const transactions = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const accounts = ref<Array<{ id: number; displayName: string }>>([]);

const filters = ref<TransactionFilters>({
  offset: 0,
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
});
const search = ref('');
const selectedAccount = ref<string>('all');
const startDate = ref('');
const endDate = ref('');
const selectedCategory = ref('');

// Context menu state
const contextMenu = ref<{ x: number; y: number; txn: Transaction } | null>(null);

async function fetchTransactions() {
  loading.value = true;
  try {
    const params: TransactionFilters = {
      ...filters.value,
      search: search.value || undefined,
      accountId: selectedAccount.value !== 'all' ? Number(selectedAccount.value) : undefined,
      startDate: startDate.value || undefined,
      endDate: endDate.value || undefined,
      category: selectedCategory.value || undefined,
    };
    const result = await getTransactions(params);
    transactions.value = result.transactions;
    total.value = result.pagination.total;
  } catch (err) {
    console.error('Failed to fetch transactions:', err);
  } finally {
    loading.value = false;
  }
}

function sort(column: string) {
  if (filters.value.sortBy === column) {
    filters.value.sortOrder = filters.value.sortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    filters.value.sortBy = column;
    filters.value.sortOrder = 'desc';
  }
  filters.value.offset = 0;
  fetchTransactions();
}

function nextPage() {
  const offset = (filters.value.offset ?? 0) + (filters.value.limit ?? 50);
  if (offset < total.value) {
    filters.value.offset = offset;
    fetchTransactions();
  }
}

function prevPage() {
  const offset = Math.max(0, (filters.value.offset ?? 0) - (filters.value.limit ?? 50));
  filters.value.offset = offset;
  fetchTransactions();
}

function applyFilters() {
  filters.value.offset = 0;
  fetchTransactions();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

function formatCurrency(amount: number): string {
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
}

const currentPage = () => Math.floor((filters.value.offset ?? 0) / (filters.value.limit ?? 50)) + 1;
const totalPages = () => Math.ceil(total.value / (filters.value.limit ?? 50));

function openContextMenu(event: MouseEvent, txn: Transaction) {
  event.preventDefault();
  contextMenu.value = { x: event.clientX, y: event.clientY, txn };
}

function closeContextMenu() {
  contextMenu.value = null;
}

async function toggleIgnore() {
  if (!contextMenu.value) return;
  const { txn } = contextMenu.value;
  closeContextMenu();
  try {
    const result = await ignoreTransaction(txn.id, !txn.ignored);
    // Update in-place so the row reacts immediately without a full refetch
    const idx = transactions.value.findIndex(t => t.id === txn.id);
    if (idx !== -1) transactions.value[idx] = result.transaction;
  } catch (err) {
    console.error('Failed to update transaction:', err);
  }
}

onMounted(async () => {
  const accountData = await getAccounts();
  accounts.value = accountData.accounts;
  fetchTransactions();
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });
});

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
});
</script>
```

**Step 2: Update the `<template>` section**

Replace the entire `<template>` block with:

```html
<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold tracking-tight">Transactions</h1>

    <!-- Filters -->
    <Card>
      <CardContent class="pt-4">
        <div class="flex flex-wrap gap-2">
          <Input
            v-model="search"
            placeholder="Search description..."
            class="w-48"
            @keyup.enter="applyFilters"
          />

          <Select v-model="selectedAccount" @update:model-value="applyFilters">
            <SelectTrigger class="w-44">
              <SelectValue placeholder="All Accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              <SelectItem
                v-for="acc in accounts"
                :key="acc.id"
                :value="String(acc.id)"
              >
                {{ acc.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Input
            v-model="startDate"
            type="date"
            class="w-36"
            @change="applyFilters"
          />
          <Input
            v-model="endDate"
            type="date"
            class="w-36"
            @change="applyFilters"
          />

          <Input
            v-model="selectedCategory"
            placeholder="Category"
            class="w-36"
            @keyup.enter="applyFilters"
          />

          <Button @click="applyFilters" variant="default" size="sm">Filter</Button>
        </div>
      </CardContent>
    </Card>

    <!-- Table -->
    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-base">
          {{ total }} transaction{{ total !== 1 ? 's' : '' }}
        </CardTitle>
      </CardHeader>
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  class="cursor-pointer select-none"
                  @click="sort('date')"
                >
                  <span class="flex items-center gap-1">
                    Date
                    <ChevronUp v-if="filters.sortBy === 'date' && filters.sortOrder === 'asc'" class="h-3 w-3" />
                    <ChevronDown v-else-if="filters.sortBy === 'date' && filters.sortOrder === 'desc'" class="h-3 w-3" />
                    <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
                  </span>
                </TableHead>
                <TableHead>Description</TableHead>
                <TableHead
                  class="cursor-pointer select-none text-right"
                  @click="sort('chargedAmount')"
                >
                  <span class="flex items-center justify-end gap-1">
                    Amount
                    <ChevronUp v-if="filters.sortBy === 'chargedAmount' && filters.sortOrder === 'asc'" class="h-3 w-3" />
                    <ChevronDown v-else-if="filters.sortBy === 'chargedAmount' && filters.sortOrder === 'desc'" class="h-3 w-3" />
                    <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
                  </span>
                </TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading">
                <TableCell colspan="6" class="py-8">
                  <div class="space-y-2">
                    <Skeleton v-for="i in 5" :key="i" class="h-8 w-full" />
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-else-if="transactions.length === 0">
                <TableCell colspan="6" class="text-center text-muted-foreground py-12">
                  No transactions found
                </TableCell>
              </TableRow>
              <TableRow
                v-else
                v-for="txn in transactions"
                :key="txn.id"
                :class="txn.ignored ? 'opacity-40' : ''"
                class="cursor-context-menu"
                @contextmenu="openContextMenu($event, txn)"
              >
                <TableCell class="text-sm text-muted-foreground whitespace-nowrap">
                  {{ formatDate(txn.date) }}
                </TableCell>
                <TableCell class="max-w-xs truncate">{{ txn.description }}</TableCell>
                <TableCell
                  class="text-right font-medium tabular-nums"
                  :class="txn.chargedAmount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'"
                >
                  {{ formatCurrency(txn.chargedAmount) }}
                </TableCell>
                <TableCell>
                  <Badge v-if="txn.category" variant="secondary" class="text-xs">
                    {{ txn.category }}
                  </Badge>
                  <span v-else class="text-muted-foreground text-sm">—</span>
                </TableCell>
                <TableCell>
                  <Badge
                    :variant="txn.status === 'completed' ? 'default' : 'secondary'"
                    class="text-xs"
                    :class="txn.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''"
                  >
                    {{ txn.status }}
                  </Badge>
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">{{ txn.accountId }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- Pagination -->
    <div class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
        Page {{ currentPage() }} of {{ totalPages() || 1 }}
        &nbsp;·&nbsp;
        {{ (filters.offset ?? 0) + 1 }}–{{ Math.min((filters.offset ?? 0) + (filters.limit ?? 50), total) }}
        of {{ total }}
      </p>
      <div class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="(filters.offset ?? 0) === 0"
          @click="prevPage"
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="(filters.offset ?? 0) + (filters.limit ?? 50) >= total"
          @click="nextPage"
        >
          Next
        </Button>
      </div>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="fixed z-50 min-w-[140px] rounded-md border bg-popover text-popover-foreground shadow-md py-1"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        @click.stop
      >
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors"
          @click="toggleIgnore"
        >
          {{ contextMenu.txn.ignored ? 'Unignore transaction' : 'Ignore transaction' }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
```

**Step 3: Verify TypeScript compiles**

```bash
cd dashboard && npx tsc --noEmit && cd ..
```

Expected: No errors.

**Step 4: Manual end-to-end test**

1. Start backend: `npm run dev`
2. Start frontend: `npm run dashboard:dev`
3. Open http://localhost:5173 in browser
4. Go to the Transactions page
5. Right-click any transaction row — a context menu should appear with "Ignore transaction"
6. Click it — the row should immediately dim to 40% opacity
7. Right-click the dimmed row — context menu should say "Unignore transaction"
8. Click it — the row should return to full opacity
9. Go to the Overview/Dashboard page — verify the ignored transaction's amount is not included in totals

**Step 5: Commit**

```bash
git add dashboard/src/components/TransactionTable.vue
git commit -m "feat: add right-click context menu to ignore/unignore transactions"
```
