# Phase 5: Dashboard (Vue 3)

**Goal:** Build a Vue 3 SPA with Vite that provides four pages: Overview (charts), Transactions (filterable table), Accounts (CRUD + scrape trigger), and AI Chat. Uses Composition API with `<script setup>`, vue-chartjs for charts, and vue-router for navigation.

**Prerequisites:** Phase 1–4 complete — all backend API endpoints are working.

---

## Task 5.1 — Vue 3 + Vite Project Setup

### Steps

1. Scaffold the Vue project inside the `dashboard/` directory:
   ```bash
   cd money-monitor
   npm create vite@latest dashboard -- --template vue-ts
   cd dashboard
   ```

2. Install dependencies:
   ```bash
   npm install vue-router@4 chart.js vue-chartjs
   ```

3. Update `dashboard/vite.config.ts`:
   ```typescript
   import { defineConfig } from 'vite';
   import vue from '@vitejs/plugin-vue';

   export default defineConfig({
     plugins: [vue()],
     server: {
       port: 5173,
       proxy: {
         '/api': {
           target: 'http://localhost:3000',
           changeOrigin: true,
         },
       },
     },
   });
   ```

4. Update `dashboard/tsconfig.json` — ensure `compilerOptions` includes:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "bundler",
       "strict": true,
       "jsx": "preserve",
       "paths": { "@/*": ["./src/*"] }
     },
     "include": ["src/**/*.ts", "src/**/*.vue"]
   }
   ```

### File: `dashboard/src/main.ts`

```typescript
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./components/OverviewDashboard.vue') },
    { path: '/transactions', component: () => import('./components/TransactionTable.vue') },
    { path: '/accounts', component: () => import('./components/AccountManager.vue') },
    { path: '/chat', component: () => import('./components/AiChat.vue') },
  ],
});

const app = createApp(App);
app.use(router);
app.mount('#app');
```

### File: `dashboard/src/App.vue`

```vue
<script setup lang="ts">
// App shell with navigation
</script>

<template>
  <AppLayout>
    <router-view />
  </AppLayout>
</template>
```

This imports and uses the `AppLayout` component (Task 5.2).

### Acceptance Criteria
- `cd dashboard && npm run dev` starts on port 5173
- API calls to `/api/*` are proxied to `localhost:3000`
- Route navigation works between all 4 pages
- No TypeScript errors

---

## Task 5.2 — API Client & Composables

### File: `dashboard/src/api/client.ts`

A thin fetch wrapper. All methods return typed data.

```typescript
const BASE_URL = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || res.statusText);
  }
  return res.json();
}

// ─── Accounts ───

export interface Account {
  id: number;
  companyId: string;
  displayName: string;
  accountNumber: string | null;
  credentialsRef: string;
  isActive: boolean;
  lastScrapedAt: string | null;
  createdAt: string;
}

export function getAccounts() {
  return request<{ accounts: Account[] }>('/accounts');
}

export function createAccount(data: { companyId: string; displayName: string; credentials: Record<string, string> }) {
  return request<{ account: Account }>('/accounts', { method: 'POST', body: JSON.stringify(data) });
}

export function updateAccount(id: number, data: { displayName?: string; isActive?: boolean; credentials?: Record<string, string> }) {
  return request<{ account: Account }>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteAccount(id: number, deleteTransactions = false) {
  return request<{ deleted: boolean }>(`/accounts/${id}?deleteTransactions=${deleteTransactions}`, { method: 'DELETE' });
}

// ─── Transactions ───

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
  hash: string;
  createdAt: string;
}

export interface Pagination {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface TransactionFilters {
  accountId?: number;
  startDate?: string;
  endDate?: string;
  category?: string;
  status?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function getTransactions(filters: TransactionFilters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<{ transactions: Transaction[]; pagination: Pagination }>(`/transactions?${params}`);
}

// ─── Summary ───

export interface SummaryItem {
  category?: string;
  month?: string;
  accountId?: number;
  displayName?: string;
  totalAmount: number;
  transactionCount: number;
}

export function getSummary(params: { groupBy?: string; accountId?: number; startDate?: string; endDate?: string } = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ groupBy: string; summary: SummaryItem[] }>(`/transactions/summary?${query}`);
}

// ─── Scraping ───

export function triggerScrape(accountId: number) {
  return request<{ success: boolean; transactionsFound: number; transactionsNew: number }>(`/scrape/${accountId}`, { method: 'POST' });
}

export function triggerScrapeAll() {
  return request<{ results: Array<{ success: boolean; accountId: number }> }>('/scrape/all', { method: 'POST' });
}

export function getScrapeLogs(params: { accountId?: number; limit?: number } = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ logs: Array<Record<string, unknown>> }>(`/scrape/logs?${query}`);
}

// ─── AI ───

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function aiChat(messages: ChatMessage[]) {
  return request<{ response: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ messages }) });
}

export function aiCategorize(batchSize = 50) {
  return request<{ categorized: number }>('/ai/categorize', { method: 'POST', body: JSON.stringify({ batchSize }) });
}
```

### File: `dashboard/src/composables/useApi.ts`

A generic composable for async data fetching with loading/error states.

```typescript
import { ref, type Ref } from 'vue';

export function useApi<T>(fetcher: () => Promise<T>) {
  const data: Ref<T | null> = ref(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function execute() {
    loading.value = true;
    error.value = null;
    try {
      data.value = await fetcher();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, execute };
}
```

### Acceptance Criteria
- All API methods match the backend routes exactly
- Types match the backend response shapes
- `useApi` composable handles loading/error/data states
- Proxy config routes `/api/*` to the backend

---

## Task 5.3 — AppLayout Component

### File: `dashboard/src/components/AppLayout.vue`

Navigation sidebar/header with links to all four pages. Minimal styling.

```vue
<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();

const navItems = [
  { path: '/', label: 'Overview', icon: '📊' },
  { path: '/transactions', label: 'Transactions', icon: '📋' },
  { path: '/accounts', label: 'Accounts', icon: '🏦' },
  { path: '/chat', label: 'AI Chat', icon: '🤖' },
];
</script>

<template>
  <div class="app-layout">
    <nav class="sidebar">
      <div class="logo">Money Monitor</div>
      <ul>
        <li v-for="item in navItems" :key="item.path">
          <router-link
            :to="item.path"
            :class="{ active: route.path === item.path }"
          >
            <span class="icon">{{ item.icon }}</span>
            {{ item.label }}
          </router-link>
        </li>
      </ul>
    </nav>
    <main class="content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 220px;
  background: #1a1a2e;
  color: #fff;
  padding: 1rem;
  flex-shrink: 0;
}
.logo {
  font-size: 1.25rem;
  font-weight: bold;
  margin-bottom: 2rem;
  padding: 0.5rem;
}
.sidebar ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sidebar li a {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  color: #ccc;
  text-decoration: none;
  border-radius: 6px;
  margin-bottom: 0.25rem;
}
.sidebar li a:hover,
.sidebar li a.active {
  background: #16213e;
  color: #fff;
}
.icon { font-size: 1.1rem; }
.content {
  flex: 1;
  padding: 2rem;
  background: #f5f5f5;
  overflow-y: auto;
}
</style>
```

### Acceptance Criteria
- Sidebar shows all 4 navigation links
- Active route is highlighted
- Content area renders the router view via `<slot />`
- Responsive enough for desktop use (mobile is out of scope)

---

## Task 5.4 — Overview Dashboard Page

### File: `dashboard/src/components/OverviewDashboard.vue`

Shows: spending this month vs last month, category breakdown (doughnut chart), monthly trend (bar chart), and per-account summary cards.

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

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

// Current and last month date ranges
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
  <div class="overview">
    <h1>Overview</h1>

    <!-- Summary cards -->
    <div class="summary-cards">
      <div class="card">
        <h3>This Month</h3>
        <p class="amount">{{ formatCurrency(thisMonthTotal) }}</p>
      </div>
      <div class="card">
        <h3>Last Month</h3>
        <p class="amount">{{ formatCurrency(lastMonthTotal) }}</p>
      </div>
      <div class="card">
        <h3>Difference</h3>
        <p class="amount" :class="thisMonthTotal > lastMonthTotal ? 'negative' : 'positive'">
          {{ formatCurrency(thisMonthTotal - lastMonthTotal) }}
        </p>
      </div>
    </div>

    <!-- Charts row -->
    <div class="charts-row">
      <div class="chart-container">
        <h3>Spending by Category</h3>
        <Doughnut v-if="categorySummary.data.value" :data="categoryChartData" />
        <p v-else-if="categorySummary.loading.value">Loading...</p>
      </div>
      <div class="chart-container">
        <h3>Monthly Trend</h3>
        <Bar v-if="monthlySummary.data.value" :data="monthlyChartData" />
        <p v-else-if="monthlySummary.loading.value">Loading...</p>
      </div>
    </div>

    <!-- Account summary -->
    <div class="account-summary" v-if="accountSummary.data.value">
      <h3>Per Account (This Month)</h3>
      <div class="account-cards">
        <div class="card" v-for="acc in accountSummary.data.value.summary" :key="acc.accountId">
          <h4>{{ acc.displayName }}</h4>
          <p>{{ formatCurrency(acc.totalAmount) }}</p>
          <small>{{ acc.transactionCount }} transactions</small>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview h1 { margin-bottom: 1.5rem; }
.summary-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}
.card {
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.amount { font-size: 1.5rem; font-weight: bold; margin: 0.5rem 0; }
.positive { color: #27ae60; }
.negative { color: #e74c3c; }
.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 2rem;
}
.chart-container {
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.account-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}
</style>
```

### Acceptance Criteria
- Shows this month vs last month total spending
- Doughnut chart shows category breakdown for current month
- Bar chart shows last 12 months of spending
- Per-account cards show spending totals
- All data fetched from the real API
- Loading states shown while fetching

---

## Task 5.5 — Transactions Table Page

### File: `dashboard/src/components/TransactionTable.vue`

Sortable, filterable table with pagination. Filters: date range, account, category, min/max amount, text search.

```vue
<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { getTransactions, getAccounts, type Transaction, type TransactionFilters } from '../api/client';

const transactions = ref<Transaction[]>([]);
const total = ref(0);
const loading = ref(false);
const accounts = ref<Array<{ id: number; displayName: string }>>([]);

// Filters
const filters = ref<TransactionFilters>({
  offset: 0,
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
});
const search = ref('');
const selectedAccount = ref<number | undefined>();
const startDate = ref('');
const endDate = ref('');
const selectedCategory = ref('');

async function fetchTransactions() {
  loading.value = true;
  try {
    const params: TransactionFilters = {
      ...filters.value,
      search: search.value || undefined,
      accountId: selectedAccount.value,
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

onMounted(async () => {
  const accountData = await getAccounts();
  accounts.value = accountData.accounts;
  fetchTransactions();
});
</script>

<template>
  <div class="transactions-page">
    <h1>Transactions</h1>

    <!-- Filters bar -->
    <div class="filters">
      <input v-model="search" placeholder="Search description..." @keyup.enter="applyFilters" />
      <select v-model="selectedAccount" @change="applyFilters">
        <option :value="undefined">All Accounts</option>
        <option v-for="acc in accounts" :key="acc.id" :value="acc.id">{{ acc.displayName }}</option>
      </select>
      <input v-model="startDate" type="date" @change="applyFilters" />
      <input v-model="endDate" type="date" @change="applyFilters" />
      <input v-model="selectedCategory" placeholder="Category" @keyup.enter="applyFilters" />
      <button @click="applyFilters">Filter</button>
    </div>

    <!-- Table -->
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th @click="sort('date')" class="sortable">
              Date {{ filters.sortBy === 'date' ? (filters.sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </th>
            <th>Description</th>
            <th @click="sort('chargedAmount')" class="sortable">
              Amount {{ filters.sortBy === 'chargedAmount' ? (filters.sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </th>
            <th>Category</th>
            <th>Status</th>
            <th>Account</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6">Loading...</td>
          </tr>
          <tr v-else-if="transactions.length === 0">
            <td colspan="6">No transactions found</td>
          </tr>
          <tr v-for="txn in transactions" :key="txn.id">
            <td>{{ formatDate(txn.date) }}</td>
            <td>{{ txn.description }}</td>
            <td :class="txn.chargedAmount >= 0 ? 'positive' : 'negative'">
              {{ formatCurrency(txn.chargedAmount) }}
            </td>
            <td>{{ txn.category ?? '—' }}</td>
            <td><span :class="'status-' + txn.status">{{ txn.status }}</span></td>
            <td>{{ txn.accountId }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination">
      <button @click="prevPage" :disabled="(filters.offset ?? 0) === 0">Previous</button>
      <span>{{ (filters.offset ?? 0) + 1 }}–{{ Math.min((filters.offset ?? 0) + (filters.limit ?? 50), total) }} of {{ total }}</span>
      <button @click="nextPage" :disabled="(filters.offset ?? 0) + (filters.limit ?? 50) >= total">Next</button>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.filters input, .filters select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.filters button {
  padding: 0.5rem 1rem;
  background: #36A2EB;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.table-wrapper { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}
th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
th { background: #f8f9fa; font-weight: 600; }
th.sortable { cursor: pointer; }
th.sortable:hover { background: #e9ecef; }
.positive { color: #27ae60; }
.negative { color: #e74c3c; }
.status-completed { color: #27ae60; }
.status-pending { color: #f39c12; }
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
}
.pagination button {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
}
.pagination button:disabled { opacity: 0.5; cursor: default; }
</style>
```

### Acceptance Criteria
- Table shows all transaction fields
- Click column headers to sort by date or amount
- All filters work: text search, account, date range, category
- Pagination with Previous/Next and total count display
- Loading and empty states are shown

---

## Task 5.6 — Account Manager Page

### File: `dashboard/src/components/AccountManager.vue`

Lists accounts, allows adding/editing/deleting accounts, and triggering scrapes.

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getAccounts, createAccount, updateAccount, deleteAccount, triggerScrape, type Account } from '../api/client';

const accounts = ref<Account[]>([]);
const loading = ref(false);
const showAddForm = ref(false);

// Form fields
const newCompanyId = ref('');
const newDisplayName = ref('');
const newCredentials = ref<Record<string, string>>({});
const credentialFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);

// Provider options
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

  // Reset form
  newCompanyId.value = '';
  newDisplayName.value = '';
  credentialFields.value = [{ key: '', value: '' }];
  showAddForm.value = false;
  fetchAccounts();
}

async function handleToggleActive(account: Account) {
  await updateAccount(account.id, { isActive: !account.isActive });
  fetchAccounts();
}

async function handleDelete(account: Account) {
  if (confirm(`Delete "${account.displayName}"? This will also delete its transactions.`)) {
    await deleteAccount(account.id, true);
    fetchAccounts();
  }
}

async function handleScrape(account: Account) {
  try {
    const result = await triggerScrape(account.id);
    alert(`Scrape complete: ${result.transactionsFound} found, ${result.transactionsNew} new`);
    fetchAccounts();
  } catch (err) {
    alert(`Scrape failed: ${err instanceof Error ? err.message : err}`);
  }
}

onMounted(fetchAccounts);
</script>

<template>
  <div class="accounts-page">
    <div class="header">
      <h1>Accounts</h1>
      <button class="btn-primary" @click="showAddForm = !showAddForm">
        {{ showAddForm ? 'Cancel' : '+ Add Account' }}
      </button>
    </div>

    <!-- Add form -->
    <div v-if="showAddForm" class="add-form card">
      <h3>Add New Account</h3>
      <div class="form-row">
        <label>Provider</label>
        <select v-model="newCompanyId">
          <option value="">Select provider...</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>Display Name</label>
        <input v-model="newDisplayName" placeholder="e.g. My Hapoalim Account" />
      </div>
      <div class="form-row">
        <label>Credentials</label>
        <div v-for="(field, i) in credentialFields" :key="i" class="cred-row">
          <input v-model="field.key" placeholder="Field name (e.g. userCode)" />
          <input v-model="field.value" type="password" placeholder="Value" />
        </div>
        <button class="btn-small" @click="addCredentialField">+ Add Field</button>
      </div>
      <button class="btn-primary" @click="handleAdd" :disabled="!newCompanyId || !newDisplayName">
        Save Account
      </button>
    </div>

    <!-- Accounts list -->
    <div v-if="loading" class="loading">Loading...</div>
    <div v-else class="accounts-list">
      <div v-for="account in accounts" :key="account.id" class="card account-card">
        <div class="account-info">
          <h3>{{ account.displayName }}</h3>
          <p class="meta">
            {{ providers.find(p => p.id === account.companyId)?.name ?? account.companyId }}
            <span v-if="account.accountNumber"> · {{ account.accountNumber }}</span>
          </p>
          <p class="meta">
            <span :class="account.isActive ? 'active' : 'inactive'">
              {{ account.isActive ? 'Active' : 'Inactive' }}
            </span>
            <span v-if="account.lastScrapedAt"> · Last scraped: {{ new Date(account.lastScrapedAt).toLocaleString('he-IL') }}</span>
            <span v-else> · Never scraped</span>
          </p>
        </div>
        <div class="account-actions">
          <button @click="handleScrape(account)" title="Trigger scrape">Scrape</button>
          <button @click="handleToggleActive(account)">
            {{ account.isActive ? 'Disable' : 'Enable' }}
          </button>
          <button class="btn-danger" @click="handleDelete(account)">Delete</button>
        </div>
      </div>
      <p v-if="accounts.length === 0">No accounts configured. Add one to get started.</p>
    </div>
  </div>
</template>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.card { background: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1rem; }
.account-card { display: flex; justify-content: space-between; align-items: center; }
.meta { color: #666; font-size: 0.875rem; margin: 0.25rem 0; }
.active { color: #27ae60; font-weight: 600; }
.inactive { color: #999; }
.account-actions { display: flex; gap: 0.5rem; }
.account-actions button {
  padding: 0.4rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
  font-size: 0.8rem;
}
.btn-primary { padding: 0.5rem 1rem; background: #36A2EB; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
.btn-danger { background: #e74c3c; color: #fff; border-color: #e74c3c; }
.btn-small { padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #f5f5f5; }
.add-form { margin-bottom: 1.5rem; }
.form-row { margin-bottom: 1rem; }
.form-row label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
.form-row input, .form-row select { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; }
.cred-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
.cred-row input { flex: 1; }
</style>
```

### Acceptance Criteria
- Lists all accounts with provider name, status, and last scrape time
- "Add Account" form with provider dropdown, display name, and dynamic credential fields
- Toggle active/inactive per account
- "Scrape" button triggers manual scrape and shows result
- "Delete" confirms before removing account + transactions
- Never displays raw credentials

---

## Task 5.7 — AI Chat Page

### File: `dashboard/src/components/AiChat.vue`

Chat interface with conversation history, suggested starter questions, and a loading indicator.

```vue
<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { aiChat, type ChatMessage } from '../api/client';

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

  // Add user message
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
</script>

<template>
  <div class="chat-page">
    <h1>AI Financial Advisor</h1>

    <div class="chat-container" ref="chatContainer">
      <!-- Empty state -->
      <div v-if="messages.length === 0" class="empty-state">
        <p>Ask me anything about your finances. Try one of these:</p>
        <div class="suggestions">
          <button v-for="s in suggestions" :key="s" @click="sendMessage(s)" class="suggestion">
            {{ s }}
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div v-for="(msg, i) in messages" :key="i" :class="['message', msg.role]">
        <div class="message-bubble">
          <div class="message-role">{{ msg.role === 'user' ? 'You' : 'AI Advisor' }}</div>
          <div class="message-content" v-html="msg.content.replace(/\n/g, '<br>')"></div>
        </div>
      </div>

      <!-- Loading indicator -->
      <div v-if="loading" class="message assistant">
        <div class="message-bubble">
          <div class="message-role">AI Advisor</div>
          <div class="message-content typing">Analyzing your finances...</div>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="chat-input">
      <input
        v-model="input"
        @keyup.enter="sendMessage()"
        placeholder="Ask about your finances..."
        :disabled="loading"
      />
      <button @click="sendMessage()" :disabled="loading || !input.trim()">Send</button>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 4rem);
}
.chat-page h1 { margin-bottom: 1rem; flex-shrink: 0; }
.chat-container {
  flex: 1;
  overflow-y: auto;
  background: #fff;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}
.empty-state { text-align: center; padding: 2rem; color: #666; }
.suggestions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; margin-top: 1rem; }
.suggestion {
  padding: 0.5rem 1rem;
  background: #f0f7ff;
  border: 1px solid #36A2EB;
  border-radius: 20px;
  color: #36A2EB;
  cursor: pointer;
  font-size: 0.875rem;
}
.suggestion:hover { background: #36A2EB; color: #fff; }
.message { margin-bottom: 1rem; display: flex; }
.message.user { justify-content: flex-end; }
.message.assistant { justify-content: flex-start; }
.message-bubble {
  max-width: 80%;
  padding: 0.75rem 1rem;
  border-radius: 12px;
}
.message.user .message-bubble { background: #36A2EB; color: #fff; }
.message.assistant .message-bubble { background: #f0f0f0; color: #333; }
.message-role { font-size: 0.75rem; font-weight: 600; margin-bottom: 0.25rem; opacity: 0.7; }
.typing { font-style: italic; opacity: 0.7; }
.chat-input {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}
.chat-input input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
}
.chat-input button {
  padding: 0.75rem 1.5rem;
  background: #36A2EB;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
}
.chat-input button:disabled { opacity: 0.5; cursor: default; }
</style>
```

### Acceptance Criteria
- Empty state shows suggested starter questions
- Clicking a suggestion sends it as a message
- Messages alternate between user (right-aligned, blue) and assistant (left-aligned, grey)
- Loading indicator appears while waiting for AI response
- Full conversation history is sent with each request (multi-turn works)
- Input is disabled while loading
- Chat auto-scrolls to the latest message

---

## Final Verification

```bash
# Terminal 1: Start backend
npm run dev

# Terminal 2: Start dashboard
cd dashboard && npm run dev

# Open http://localhost:5173
# - Navigate between all 4 pages
# - Add an account (won't scrape without real creds, but form should work)
# - Check Overview charts (will be empty without data)
# - Chat with AI (requires ANTHROPIC_API_KEY)
```

---

## Files Created in This Phase

```
dashboard/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
└── src/
    ├── main.ts
    ├── App.vue
    ├── api/
    │   └── client.ts
    ├── composables/
    │   └── useApi.ts
    └── components/
        ├── AppLayout.vue
        ├── OverviewDashboard.vue
        ├── TransactionTable.vue
        ├── AccountManager.vue
        └── AiChat.vue
```
