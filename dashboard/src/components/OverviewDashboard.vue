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
