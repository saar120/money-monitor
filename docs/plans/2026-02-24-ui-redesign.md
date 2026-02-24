# UI Redesign with shadcn-vue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace vanilla CSS in all 5 dashboard components with shadcn-vue + Tailwind CSS for a polished, system-themed UI.

**Architecture:** Install Tailwind CSS v4 and shadcn-vue into `dashboard/`. Rewrite all 5 Vue components using shadcn primitives and Tailwind utility classes. All script logic, composables, API calls, and router config remain unchanged — only templates and styles change.

**Tech Stack:** Vue 3, Vite 7, Tailwind CSS v4, shadcn-vue, Radix Vue, lucide-vue-next

---

## Task 1: Install Tailwind CSS v4 + configure Vite alias

**Files:**
- Modify: `dashboard/package.json` (via npm install)
- Modify: `dashboard/vite.config.ts`
- Modify: `dashboard/tsconfig.app.json`

**Step 1: Install Tailwind v4 Vite plugin**

```bash
cd /Users/saaramrani/projects/money-monitor/dashboard
npm install -D tailwindcss @tailwindcss/vite
```

Expected: installs `tailwindcss` and `@tailwindcss/vite` into devDependencies.

**Step 2: Rewrite `dashboard/vite.config.ts`**

Replace the entire file:

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/scrape/events': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, _req, res) => {
            res.setHeader('X-Accel-Buffering', 'no');
          });
        },
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

**Step 3: Add path alias to `dashboard/tsconfig.app.json`**

Add the `paths` key inside `compilerOptions`. Open the file and add inside `"compilerOptions"`:

```json
"baseUrl": ".",
"paths": {
  "@/*": ["./src/*"]
}
```

**Step 4: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add dashboard/vite.config.ts dashboard/tsconfig.app.json dashboard/package.json dashboard/package-lock.json
git commit -m "chore: add Tailwind CSS v4 and @ path alias to dashboard"
```

---

## Task 2: Set up shadcn-vue manually

**Files:**
- Create: `dashboard/components.json`
- Create: `dashboard/src/lib/utils.ts`

**Step 1: Install shadcn-vue dependencies**

```bash
cd /Users/saaramrani/projects/money-monitor/dashboard
npm install lucide-vue-next clsx tailwind-merge class-variance-authority radix-vue @vueuse/core
```

Expected: adds these packages to `dependencies`.

**Step 2: Create `dashboard/components.json`**

```json
{
  "$schema": "https://shadcn-vue.com/schema.json",
  "style": "default",
  "typescript": true,
  "tailwind": {
    "config": "",
    "css": "src/style.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "framework": "vite",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/composables"
  }
}
```

**Step 3: Create `dashboard/src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

**Step 4: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add dashboard/components.json dashboard/src/lib/utils.ts dashboard/package.json dashboard/package-lock.json
git commit -m "chore: add shadcn-vue dependencies and config"
```

---

## Task 3: Install shadcn-vue components + replace style.css

**Files:**
- Create: `dashboard/src/components/ui/` (many files, auto-generated)
- Modify: `dashboard/src/style.css`

**Step 1: Add shadcn-vue components via CLI**

```bash
cd /Users/saaramrani/projects/money-monitor/dashboard
npx shadcn-vue@latest add button card input select badge table dialog alert-dialog skeleton separator textarea --yes
```

Expected: creates files under `src/components/ui/` — button.vue, card.vue, input.vue, select.vue, badge.vue, table.vue, dialog.vue, alert-dialog.vue, skeleton.vue, separator.vue, textarea.vue. This command is non-interactive when `components.json` exists.

If the `--yes` flag is not accepted, omit it and confirm any prompts with Y.

**Step 2: Replace `dashboard/src/style.css` entirely**

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.625rem;
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #app {
    max-width: none;
    margin: 0;
    padding: 0;
    text-align: left;
  }
}
```

**Step 3: Apply system theme in `dashboard/index.html`**

Add a script to `<head>` that sets dark class based on OS preference. Open `dashboard/index.html` and add inside `<head>` before `</head>`:

```html
<script>
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark')
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    document.documentElement.classList.toggle('dark', e.matches)
  })
</script>
```

**Step 4: Verify dev server starts without errors**

```bash
cd /Users/saaramrani/projects/money-monitor/dashboard
npm run dev
```

Expected: Vite server starts on port 5173 with no compilation errors. Browser shows the existing layout (possibly unstyled since scoped CSS still exists — that's fine for now).

**Step 5: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add dashboard/src/style.css dashboard/src/components/ui/ dashboard/index.html dashboard/package.json dashboard/package-lock.json
git commit -m "chore: add shadcn-vue components and Tailwind CSS variables"
```

---

## Task 4: Rewrite AppLayout.vue

**Files:**
- Modify: `dashboard/src/components/AppLayout.vue`

**Step 1: Replace entire file content**

```vue
<script setup lang="ts">
import { useRoute } from 'vue-router';
import { LayoutDashboard, Receipt, Building2, Bot } from 'lucide-vue-next';
import { Separator } from '@/components/ui/separator';

const route = useRoute();

const navItems = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/transactions', label: 'Transactions', icon: Receipt },
  { path: '/accounts', label: 'Accounts', icon: Building2 },
  { path: '/chat', label: 'AI Chat', icon: Bot },
];
</script>

<template>
  <div class="flex min-h-screen bg-background text-foreground">
    <aside class="w-56 flex-shrink-0 border-r border-border bg-card flex flex-col">
      <div class="px-4 py-5">
        <span class="text-base font-bold tracking-tight">Money Monitor</span>
      </div>
      <Separator />
      <nav class="flex-1 p-3 space-y-0.5">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors no-underline"
          :class="route.path === item.path
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'"
        >
          <component :is="item.icon" class="h-4 w-4 flex-shrink-0" />
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="flex-1 overflow-y-auto p-6 min-w-0">
      <slot />
    </main>
  </div>
</template>
```

**Step 2: Verify in browser**

Visit http://localhost:5173. Expected: sidebar with clean nav links and lucide icons. Dark/light mode should switch based on OS preference.

**Step 3: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add dashboard/src/components/AppLayout.vue
git commit -m "feat: rewrite AppLayout with shadcn-vue sidebar"
```

---

## Task 5: Rewrite OverviewDashboard.vue

**Files:**
- Modify: `dashboard/src/components/OverviewDashboard.vue`

**Step 1: Replace entire file content**

```vue
<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { Doughnut, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, Title
} from 'chart.js';
import { getSummary } from '../api/client';
import { useApi } from '../composables/useApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

const now = new Date();
const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

const categorySummary = useApi(() => getSummary({ groupBy: 'category', startDate: thisMonthStart }));
const monthlySummary = useApi(() => getSummary({ groupBy: 'month' }));
const accountSummary = useApi(() => getSummary({ groupBy: 'account', startDate: thisMonthStart }));
const lastMonthSummary = useApi(() => getSummary({ groupBy: 'category', startDate: lastMonthStart, endDate: lastMonthEnd }));

onMounted(() => {
  categorySummary.execute();
  monthlySummary.execute();
  accountSummary.execute();
  lastMonthSummary.execute();
});

const thisMonthTotal = computed(() =>
  categorySummary.data.value?.summary.reduce((sum, s) => sum + s.totalAmount, 0) ?? 0
);
const lastMonthTotal = computed(() =>
  lastMonthSummary.data.value?.summary.reduce((sum, s) => sum + s.totalAmount, 0) ?? 0
);

const categoryChartData = computed(() => {
  const items = categorySummary.data.value?.summary ?? [];
  const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
                  '#FF9F40', '#C9CBCF', '#7BC8A4', '#E7E9ED', '#F7464A',
                  '#46BFBD', '#FDB45C'];
  return {
    labels: items.map(s => s.category ?? 'uncategorized'),
    datasets: [{
      data: items.map(s => Math.abs(s.totalAmount)),
      backgroundColor: colors.slice(0, items.length),
    }],
  };
});

const monthlyChartData = computed(() => {
  const items = (monthlySummary.data.value?.summary ?? []).slice(0, 12).reverse();
  return {
    labels: items.map(s => s.month ?? ''),
    datasets: [{
      label: 'Monthly Spending (ILS)',
      data: items.map(s => Math.abs(s.totalAmount)),
      backgroundColor: '#36A2EB',
    }],
  };
});

function formatCurrency(amount: number): string {
  return `₪${Math.abs(amount).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold tracking-tight">Overview</h1>

    <!-- Stat Cards -->
    <div class="grid grid-cols-3 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">This Month</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="categorySummary.loading.value">
            <Skeleton class="h-8 w-32" />
          </div>
          <div v-else class="text-2xl font-bold">{{ formatCurrency(thisMonthTotal) }}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">Last Month</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="lastMonthSummary.loading.value">
            <Skeleton class="h-8 w-32" />
          </div>
          <div v-else class="text-2xl font-bold">{{ formatCurrency(lastMonthTotal) }}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">Difference</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="categorySummary.loading.value || lastMonthSummary.loading.value">
            <Skeleton class="h-8 w-32" />
          </div>
          <template v-else>
            <div
              class="text-2xl font-bold"
              :class="thisMonthTotal > lastMonthTotal ? 'text-destructive' : 'text-green-500'"
            >
              {{ formatCurrency(Math.abs(thisMonthTotal - lastMonthTotal)) }}
            </div>
            <Badge
              v-if="thisMonthTotal > lastMonthTotal"
              variant="destructive"
              class="mt-2"
            >
              ↑ More than last month
            </Badge>
            <Badge
              v-else
              class="mt-2 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            >
              ↓ Less than last month
            </Badge>
          </template>
        </CardContent>
      </Card>
    </div>

    <!-- Charts Row -->
    <div class="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Spending by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <Doughnut v-if="categorySummary.data.value" :data="categoryChartData" />
          <Skeleton v-else-if="categorySummary.loading.value" class="h-48 w-full rounded-md" />
          <p v-else class="text-muted-foreground text-sm text-center py-12">No data yet</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">Monthly Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <Bar v-if="monthlySummary.data.value" :data="monthlyChartData" />
          <Skeleton v-else-if="monthlySummary.loading.value" class="h-48 w-full rounded-md" />
          <p v-else class="text-muted-foreground text-sm text-center py-12">No data yet</p>
        </CardContent>
      </Card>
    </div>

    <!-- Per Account -->
    <div v-if="accountSummary.data.value">
      <h2 class="text-lg font-semibold mb-3">Per Account (This Month)</h2>
      <p v-if="accountSummary.data.value.summary.length === 0" class="text-muted-foreground text-sm">
        No account data yet
      </p>
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <Card v-for="acc in accountSummary.data.value.summary" :key="acc.accountId">
          <CardHeader class="pb-1">
            <CardTitle class="text-sm font-medium truncate">{{ acc.displayName }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-xl font-bold">{{ formatCurrency(acc.totalAmount) }}</div>
            <p class="text-xs text-muted-foreground mt-1">{{ acc.transactionCount }} transactions</p>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
```

**Step 2: Verify in browser**

Navigate to Overview. Expected: 3 stat cards, 2 chart cards, account summary grid — all using the card component style.

**Step 3: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add dashboard/src/components/OverviewDashboard.vue
git commit -m "feat: rewrite OverviewDashboard with shadcn-vue cards"
```

---

## Task 6: Rewrite TransactionTable.vue

**Files:**
- Modify: `dashboard/src/components/TransactionTable.vue`

**Step 1: Replace entire file content**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getTransactions, getAccounts, type Transaction, type TransactionFilters } from '../api/client';
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

onMounted(async () => {
  const accountData = await getAccounts();
  accounts.value = accountData.accounts;
  fetchTransactions();
});
</script>

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
              <TableRow v-else v-for="txn in transactions" :key="txn.id">
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
  </div>
</template>
```

**Step 2: Verify in browser**

Navigate to Transactions. Expected: filter bar with Input/Select components, shadcn Table, Badge status chips, pagination buttons.

**Step 3: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add dashboard/src/components/TransactionTable.vue
git commit -m "feat: rewrite TransactionTable with shadcn-vue table and filters"
```

---

## Task 7: Rewrite AccountManager.vue

**Files:**
- Modify: `dashboard/src/components/AccountManager.vue`

**Step 1: Replace entire file content**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  triggerScrape,
  createScrapeEventSource,
  submitOtp,
  type Account,
} from '../api/client';
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Plus, Trash2, RefreshCw, Power } from 'lucide-vue-next';

const accounts = ref<Account[]>([]);
const loading = ref(false);
const showAddDialog = ref(false);

const newCompanyId = ref('');
const newDisplayName = ref('');
const credentialFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);

// SSE & OTP state
let eventSource: EventSource | null = null;
const scrapingAccounts = ref(new Set<number>());
const otpAccountId = ref<number | null>(null);
const otpMessage = ref('');
const otpCode = ref('');
const otpSubmitting = ref(false);

const providers = [
  { id: 'hapoalim', name: 'Bank Hapoalim' },
  { id: 'leumi', name: 'Bank Leumi' },
  { id: 'discount', name: 'Bank Discount' },
  { id: 'mizrahi', name: 'Bank Mizrahi' },
  { id: 'otsarHahayal', name: 'Otsar Hahayal' },
  { id: 'mercantile', name: 'Mercantile' },
  { id: 'massad', name: 'Massad' },
  { id: 'beinleumi', name: 'First International' },
  { id: 'union', name: 'Union Bank' },
  { id: 'yahav', name: 'Bank Yahav' },
  { id: 'isracard', name: 'Isracard' },
  { id: 'amex', name: 'American Express (Israel)' },
  { id: 'max', name: 'Max (Leumi Card)' },
  { id: 'visaCal', name: 'Visa Cal' },
  { id: 'beyahadBishvilha', name: 'Beyond (Beyahad)' },
  { id: 'oneZero', name: 'One Zero' },
  { id: 'behatsdaa', name: 'Behatsdaa' },
  { id: 'pagi', name: 'Pagi' },
];

function connectSse() {
  eventSource = createScrapeEventSource();

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data) as {
      type: string;
      accountId?: number;
      message?: string;
    };

    switch (data.type) {
      case 'otp-required':
        if (data.accountId != null) {
          otpAccountId.value = data.accountId;
          otpMessage.value = data.message ?? 'Enter OTP code';
          otpCode.value = '';
        }
        break;

      case 'scrape-started':
        if (data.accountId != null) {
          scrapingAccounts.value.add(data.accountId);
          scrapingAccounts.value = new Set(scrapingAccounts.value);
        }
        break;

      case 'scrape-done':
      case 'scrape-error':
        if (data.accountId != null) {
          scrapingAccounts.value.delete(data.accountId);
          scrapingAccounts.value = new Set(scrapingAccounts.value);
          if (otpAccountId.value === data.accountId) {
            otpAccountId.value = null;
          }
          fetchAccounts();
        }
        break;
    }
  };

  eventSource.onerror = () => {
    eventSource?.close();
    setTimeout(connectSse, 3000);
  };
}

async function fetchAccounts() {
  loading.value = true;
  try {
    const result = await getAccounts();
    accounts.value = result.accounts;
  } finally {
    loading.value = false;
  }
}

function addCredentialField() {
  credentialFields.value.push({ key: '', value: '' });
}

async function handleAdd() {
  const credentials: Record<string, string> = {};
  for (const field of credentialFields.value) {
    if (field.key) credentials[field.key] = field.value;
  }

  await createAccount({
    companyId: newCompanyId.value,
    displayName: newDisplayName.value,
    credentials,
  });

  newCompanyId.value = '';
  newDisplayName.value = '';
  credentialFields.value = [{ key: '', value: '' }];
  showAddDialog.value = false;
  fetchAccounts();
}

async function handleToggleActive(account: Account) {
  await updateAccount(account.id, { isActive: !account.isActive });
  fetchAccounts();
}

async function handleDelete(account: Account) {
  await deleteAccount(account.id, true);
  fetchAccounts();
}

async function handleScrape(account: Account) {
  if (scrapingAccounts.value.has(account.id)) return;
  try {
    const result = await triggerScrape(account.id);
    alert(`Scrape complete: ${result.transactionsFound} found, ${result.transactionsNew} new`);
    fetchAccounts();
  } catch (err) {
    alert(`Scrape failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function handleOtpSubmit() {
  if (!otpAccountId.value || !otpCode.value.trim()) return;
  otpSubmitting.value = true;
  try {
    await submitOtp(otpAccountId.value, otpCode.value.trim());
    otpAccountId.value = null;
    otpCode.value = '';
  } catch (err) {
    alert(`OTP submit failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    otpSubmitting.value = false;
  }
}

function handleOtpCancel() {
  otpAccountId.value = null;
  otpCode.value = '';
}

onMounted(() => {
  fetchAccounts();
  connectSse();
});

onUnmounted(() => {
  eventSource?.close();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Accounts</h1>
      <Button @click="showAddDialog = true">
        <Plus class="h-4 w-4 mr-2" />
        Add Account
      </Button>
    </div>

    <!-- Loading skeletons -->
    <div v-if="loading" class="space-y-3">
      <Skeleton v-for="i in 3" :key="i" class="h-24 w-full rounded-lg" />
    </div>

    <!-- Account cards -->
    <div v-else class="space-y-3">
      <p v-if="accounts.length === 0" class="text-muted-foreground text-sm text-center py-12">
        No accounts configured. Add one to get started.
      </p>

      <Card v-for="account in accounts" :key="account.id">
        <CardContent class="pt-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <CardTitle class="text-base">{{ account.displayName }}</CardTitle>
                <Badge
                  :variant="account.isActive ? 'default' : 'secondary'"
                  class="text-xs"
                >
                  {{ account.isActive ? 'Active' : 'Inactive' }}
                </Badge>
              </div>
              <CardDescription class="text-sm">
                {{ providers.find(p => p.id === account.companyId)?.name ?? account.companyId }}
                <span v-if="account.accountNumber"> · {{ account.accountNumber }}</span>
              </CardDescription>
              <p class="text-xs text-muted-foreground mt-1">
                <span v-if="account.lastScrapedAt">
                  Last scraped: {{ new Date(account.lastScrapedAt).toLocaleString('he-IL') }}
                </span>
                <span v-else>Never scraped</span>
              </p>
            </div>

            <div class="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                :disabled="scrapingAccounts.has(account.id)"
                @click="handleScrape(account)"
              >
                <Loader2 v-if="scrapingAccounts.has(account.id)" class="h-3 w-3 mr-1 animate-spin" />
                <RefreshCw v-else class="h-3 w-3 mr-1" />
                {{ scrapingAccounts.has(account.id) ? 'Scraping...' : 'Scrape' }}
              </Button>

              <Button
                variant="outline"
                size="sm"
                @click="handleToggleActive(account)"
              >
                <Power class="h-3 w-3 mr-1" />
                {{ account.isActive ? 'Disable' : 'Enable' }}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger as-child>
                  <Button variant="destructive" size="sm">
                    <Trash2 class="h-3 w-3" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete "{{ account.displayName }}"?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the account and all its transactions. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      @click="handleDelete(account)"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Add Account Dialog -->
    <Dialog v-model:open="showAddDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Account</DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Provider</label>
            <Select v-model="newCompanyId">
              <SelectTrigger>
                <SelectValue placeholder="Select provider..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in providers" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-1.5">
            <label class="text-sm font-medium">Display Name</label>
            <Input v-model="newDisplayName" placeholder="e.g. My Hapoalim Account" />
          </div>

          <div class="space-y-1.5">
            <label class="text-sm font-medium">Credentials</label>
            <div v-for="(field, i) in credentialFields" :key="i" class="flex gap-2">
              <Input v-model="field.key" placeholder="Field name (e.g. userCode)" />
              <Input v-model="field.value" type="password" placeholder="Value" />
            </div>
            <Button variant="outline" size="sm" @click="addCredentialField">
              <Plus class="h-3 w-3 mr-1" />
              Add Field
            </Button>
          </div>
        </div>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            :disabled="!newCompanyId || !newDisplayName"
            @click="handleAdd"
          >
            Save Account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- OTP Dialog -->
    <Dialog :open="otpAccountId !== null" @update:open="(v) => { if (!v) handleOtpCancel() }">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Two-Factor Authentication</DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <p class="text-sm text-muted-foreground">{{ otpMessage }}</p>
          <Input
            v-model="otpCode"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="Enter code..."
            class="text-center text-lg tracking-widest font-mono"
            @keyup.enter="handleOtpSubmit"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" @click="handleOtpCancel">Cancel</Button>
          <Button
            :disabled="!otpCode.trim() || otpSubmitting"
            @click="handleOtpSubmit"
          >
            <Loader2 v-if="otpSubmitting" class="h-4 w-4 mr-2 animate-spin" />
            {{ otpSubmitting ? 'Submitting...' : 'Submit' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
```

**Step 2: Verify in browser**

Navigate to Accounts. Expected: account cards with status badges, scrape/enable/delete buttons. "Add Account" opens a dialog. Delete shows an AlertDialog confirmation. OTP modal appears when SSE sends otp-required.

**Step 3: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add dashboard/src/components/AccountManager.vue
git commit -m "feat: rewrite AccountManager with shadcn-vue dialog and cards"
```

---

## Task 8: Rewrite AiChat.vue

**Files:**
- Modify: `dashboard/src/components/AiChat.vue`

**Step 1: Replace entire file content**

```vue
<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { aiChat, type ChatMessage } from '../api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { SendHorizontal, Bot, User } from 'lucide-vue-next';

const messages = ref<ChatMessage[]>([]);
const input = ref('');
const loading = ref(false);
const chatContainer = ref<HTMLElement | null>(null);

const suggestions = [
  'What are my top spending categories this month?',
  'How much did I spend on food this month vs last month?',
  'Any unusually large charges recently?',
  'Categorize my uncategorized transactions',
  'What is my total spending this month?',
];

async function scrollToBottom() {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
}

async function sendMessage(text?: string) {
  const messageText = text ?? input.value.trim();
  if (!messageText) return;

  messages.value.push({ role: 'user', content: messageText });
  input.value = '';
  loading.value = true;
  await scrollToBottom();

  try {
    const result = await aiChat(messages.value);
    messages.value.push({ role: 'assistant', content: result.response });
  } catch (err) {
    messages.value.push({
      role: 'assistant',
      content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
    });
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-6rem)]">
    <h1 class="text-2xl font-semibold tracking-tight mb-4 flex-shrink-0">AI Financial Advisor</h1>

    <!-- Chat area -->
    <Card class="flex-1 overflow-hidden flex flex-col min-h-0">
      <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-4">

        <!-- Empty state with suggestions -->
        <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-full text-center py-8">
          <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Bot class="h-6 w-6 text-primary" />
          </div>
          <p class="text-muted-foreground text-sm mb-4">
            Ask me anything about your finances
          </p>
          <div class="flex flex-wrap gap-2 justify-center max-w-lg">
            <Button
              v-for="s in suggestions"
              :key="s"
              variant="outline"
              size="sm"
              class="rounded-full text-xs h-auto py-1.5 px-3"
              @click="sendMessage(s)"
            >
              {{ s }}
            </Button>
          </div>
        </div>

        <!-- Messages -->
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="flex gap-3"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <!-- AI avatar -->
          <div
            v-if="msg.role === 'assistant'"
            class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"
          >
            <Bot class="h-4 w-4 text-primary" />
          </div>

          <div
            class="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
            :class="msg.role === 'user'
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-muted text-foreground rounded-bl-sm'"
          >
            <div class="text-[10px] font-semibold opacity-60 mb-1">
              {{ msg.role === 'user' ? 'You' : 'AI Advisor' }}
            </div>
            <div v-html="msg.content.replace(/\n/g, '<br>')" />
          </div>

          <!-- User avatar -->
          <div
            v-if="msg.role === 'user'"
            class="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5"
          >
            <User class="h-4 w-4 text-primary-foreground" />
          </div>
        </div>

        <!-- Typing indicator -->
        <div v-if="loading" class="flex gap-3 justify-start">
          <div class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot class="h-4 w-4 text-primary" />
          </div>
          <div class="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
            <div class="flex gap-1 items-center h-4">
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
              <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
            </div>
          </div>
        </div>
      </div>

      <!-- Input area -->
      <div class="border-t border-border p-3 flex gap-2 items-end flex-shrink-0">
        <Textarea
          v-model="input"
          placeholder="Ask about your finances... (Enter to send, Shift+Enter for newline)"
          class="resize-none min-h-[40px] max-h-32 text-sm"
          rows="1"
          :disabled="loading"
          @keydown="handleKeydown"
        />
        <Button
          size="icon"
          :disabled="loading || !input.trim()"
          @click="sendMessage()"
          class="flex-shrink-0"
        >
          <SendHorizontal class="h-4 w-4" />
        </Button>
      </div>
    </Card>
  </div>
</template>
```

**Step 2: Verify in browser**

Navigate to AI Chat. Expected: clean chat interface with suggestion pills, proper message bubbles (user right/AI left), animated typing indicator, Textarea input that sends on Enter.

**Step 3: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add dashboard/src/components/AiChat.vue
git commit -m "feat: rewrite AiChat with polished shadcn-vue chat UI"
```

---

## Task 9: Final verification and polish

**Step 1: Run the dev server and check all 4 routes**

```bash
cd /Users/saaramrani/projects/money-monitor/dashboard
npm run dev
```

Check each route:
- `/` — Overview: stat cards, charts, account grid
- `/transactions` — Transactions: filter bar, table, pagination
- `/accounts` — Accounts: account cards, Add dialog, Delete dialog
- `/chat` — AI Chat: suggestions, chat interface

**Step 2: Check dark mode**

Toggle your OS to dark mode (System Preferences > Appearance > Dark). The app should switch automatically without a page reload.

**Step 3: Run TypeScript build check**

```bash
cd /Users/saaramrani/projects/money-monitor/dashboard
npm run build
```

Expected: Builds successfully with no TypeScript errors.

If build errors appear, fix them before proceeding (common issues: missing component imports, wrong prop types on shadcn components).

**Step 4: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add -A
git commit -m "feat: complete UI redesign with shadcn-vue

All 5 dashboard components rewritten using shadcn-vue + Tailwind CSS v4.
Supports system dark/light mode. Removes all vanilla CSS."
```

---

## Troubleshooting

**Issue: `@` alias not resolving**
- Ensure both `vite.config.ts` and `tsconfig.app.json` have the alias configured
- Restart the dev server after config changes

**Issue: `shadcn-vue add` fails or asks questions**
- Ensure `components.json` exists in `dashboard/` before running the command
- If it still prompts, answer: framework=vite, typescript=yes, css-variables=yes, base-color=zinc

**Issue: CSS variables not applying (no colors)**
- Ensure `style.css` starts with `@import "tailwindcss";`
- Ensure the `@tailwindcss/vite` plugin is in `vite.config.ts`
- Restart the dev server

**Issue: Dark mode not toggling**
- The `<script>` block in `index.html` is responsible for adding the `dark` class to `<html>`
- Check browser console for JS errors in that script

**Issue: Chart.js charts look broken in dark mode**
- Chart.js uses its own color config — this is expected and out of scope for this task
