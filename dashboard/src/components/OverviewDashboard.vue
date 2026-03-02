<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { Doughnut, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, Title
} from 'chart.js';
import { getSummary, getAccounts } from '../api/client';
import { useApi } from '../composables/useApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PROVIDERS } from '@/lib/providers';
import { formatCurrency } from '@/lib/format';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

const now = new Date();
const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

const accountsData = useApi(() => getAccounts());
const categorySummary = useApi(() => getSummary({ groupBy: 'category', startDate: thisMonthStart, accountType: 'credit_card' }));
const monthlySummary = useApi(() => getSummary({ groupBy: 'month', accountType: 'credit_card' }));
const accountSummary = useApi(() => getSummary({ groupBy: 'account', startDate: thisMonthStart }));
const lastMonthSummary = useApi(() => getSummary({ groupBy: 'category', startDate: lastMonthStart, endDate: lastMonthEnd, accountType: 'credit_card' }));

const bankAccounts = computed(() =>
  (accountsData.data.value?.accounts ?? []).filter(a => a.accountType === 'bank')
);

onMounted(() => {
  accountsData.execute();
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

const chartColors = ['#8b5cf6', '#06b6d4', '#a78bfa', '#34d399', '#f59e0b',
                     '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

const chartOptions = {
  plugins: {
    legend: {
      labels: {
        color: '#71717a',
        font: { family: 'Geist' },
      },
    },
    tooltip: {
      backgroundColor: '#18181c',
      borderColor: 'rgba(139,92,246,0.2)',
      borderWidth: 1,
      titleColor: '#f0f0f3',
      bodyColor: '#f0f0f3',
    },
  },
  scales: {
    x: {
      ticks: { color: '#71717a' },
      grid: { color: 'rgba(255,255,255,0.03)' },
    },
    y: {
      ticks: { color: '#71717a' },
      grid: { color: 'rgba(255,255,255,0.03)' },
    },
  },
};

const doughnutOptions = {
  plugins: chartOptions.plugins,
};

const categoryChartData = computed(() => {
  const items = categorySummary.data.value?.summary ?? [];
  return {
    labels: items.map(s => s.category ?? 'uncategorized'),
    datasets: [{
      data: items.map(s => Math.abs(s.totalAmount)),
      backgroundColor: chartColors.slice(0, items.length),
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
      backgroundColor: '#8b5cf6',
      borderRadius: 6,
    }],
  };
});
</script>

<template>
  <div class="space-y-6 animate-fade-in-up">
    <h1 class="text-2xl font-semibold tracking-tight heading-font">Overview</h1>

    <!-- Bank Balances -->
    <div v-if="bankAccounts.length > 0" class="space-y-3">
      <h2 class="text-lg font-semibold">Bank Balances</h2>
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <Card v-for="account in bankAccounts" :key="account.id">
          <CardHeader class="pb-1">
            <CardTitle class="text-sm font-medium truncate">{{ account.displayName }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="account.balance != null" class="text-xl font-bold">
              {{ formatCurrency(account.balance) }}
            </div>
            <div v-else class="text-sm text-muted-foreground">No balance data</div>
            <p class="text-xs text-muted-foreground mt-1">
              {{ PROVIDERS.find(p => p.id === account.companyId)?.name ?? account.companyId }}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
    <div v-else-if="accountsData.loading.value" class="space-y-3">
      <h2 class="text-lg font-semibold">Bank Balances</h2>
      <Skeleton class="h-24 w-full rounded-lg" />
    </div>

    <!-- Credit Card Spending -->
    <h2 class="text-lg font-semibold">Credit Card Spending</h2>
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
              :class="thisMonthTotal > lastMonthTotal ? 'text-destructive' : 'text-success'"
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
              class="mt-2 bg-success/10 text-success"
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
          <Doughnut v-if="categorySummary.data.value" :data="categoryChartData" :options="doughnutOptions" />
          <Skeleton v-else-if="categorySummary.loading.value" class="h-48 w-full rounded-md" />
          <p v-else class="text-muted-foreground text-sm text-center py-12">No data yet</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">Monthly Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <Bar v-if="monthlySummary.data.value" :data="monthlyChartData" :options="chartOptions" />
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
