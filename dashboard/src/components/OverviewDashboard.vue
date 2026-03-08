<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { Doughnut, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, Title
} from 'chart.js';
import { getSummary, getCashflowSummary, getAccounts } from '../api/client';
import { useApi } from '../composables/useApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PROVIDERS } from '@/lib/providers';
import { formatCurrency } from '@/lib/format';
import { useChartTheme } from '@/composables/useChartTheme';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

const { tooltip: themeTooltip, legendLabels, axisTicks, grid: themeGrid } = useChartTheme();

function israelDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}
const [y, m] = israelDate(new Date()).split('-').map(Number) as [number, number];
const thisMonthStart = `${y}-${String(m).padStart(2, '0')}-01`;
const lastMonthStart = israelDate(new Date(y, m - 2, 1));
const lastMonthEnd = israelDate(new Date(y, m - 1, 0));

const accountsData = useApi(() => getAccounts());
const categorySummary = useApi(() => getSummary({ groupBy: 'category', startDate: thisMonthStart, accountType: 'credit_card' }));
const monthlySummary = useApi(() => getSummary({ groupBy: 'month', accountType: 'credit_card' }));
const accountSummary = useApi(() => getSummary({ groupBy: 'account', startDate: thisMonthStart }));
const lastMonthSummary = useApi(() => getSummary({ groupBy: 'category', startDate: lastMonthStart, endDate: lastMonthEnd, accountType: 'credit_card' }));
const cashflowSummary = useApi(() => getCashflowSummary());

const bankAccounts = computed(() =>
  (accountsData.data.value?.accounts ?? []).filter(a => a.accountType === 'bank')
);

onMounted(() => {
  accountsData.execute();
  categorySummary.execute();
  monthlySummary.execute();
  accountSummary.execute();
  lastMonthSummary.execute();
  cashflowSummary.execute();
});

const thisMonthTotal = computed(() =>
  categorySummary.data.value?.summary.reduce((sum, s) => sum + s.totalAmount, 0) ?? 0
);
const lastMonthTotal = computed(() =>
  lastMonthSummary.data.value?.summary.reduce((sum, s) => sum + s.totalAmount, 0) ?? 0
);

const chartColors = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55',
                     '#5AC8FA', '#FFCC00', '#FF3B30', '#30D158', '#64D2FF'];

const chartOptions = computed(() => ({
  plugins: {
    legend: { labels: legendLabels.value },
    tooltip: themeTooltip.value,
  },
  scales: {
    x: {
      ticks: axisTicks.value,
      grid: { ...themeGrid.value, drawBorder: false },
      border: { dash: [4, 4] },
    },
    y: {
      ticks: axisTicks.value,
      grid: { ...themeGrid.value, drawBorder: false },
      border: { dash: [4, 4] },
    },
  },
}));

const doughnutOptions = computed(() => ({
  cutout: '70%',
  plugins: chartOptions.value.plugins,
}));

const categoryChartData = computed(() => {
  const items = categorySummary.data.value?.summary ?? [];
  return {
    labels: items.map(s => s.category ?? 'uncategorized'),
    datasets: [{
      data: items.map(s => Math.abs(s.totalAmount)),
      backgroundColor: chartColors.slice(0, items.length),
      borderRadius: 6,
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
      backgroundColor: '#007AFF',
      borderRadius: 6,
    }],
  };
});

const cashflowChartData = computed(() => {
  const items = (cashflowSummary.data.value?.summary ?? []).slice(0, 12).reverse();
  return {
    labels: items.map(s => s.month),
    datasets: [
      {
        label: 'Income (ILS)',
        data: items.map(s => s.income),
        backgroundColor: '#34C759',
        borderRadius: 6,
      },
      {
        label: 'Expenses (ILS)',
        data: items.map(s => s.expense),
        backgroundColor: '#FF2D55',
        borderRadius: 6,
      },
    ],
  };
});
</script>

<template>
  <div class="space-y-6 animate-fade-in-up">
    <h1 class="text-[22px] font-semibold text-text-primary">Overview</h1>

    <!-- Bank Balances -->
    <div v-if="bankAccounts.length > 0" class="space-y-3">
      <h2 class="text-[15px] font-semibold text-text-primary">Bank Balances</h2>
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <Card v-for="account in bankAccounts" :key="account.id">
          <CardHeader class="pb-1">
            <CardTitle class="text-[13px] font-medium truncate">{{ account.displayName }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="account.balance != null" class="text-[17px] font-semibold">
              {{ formatCurrency(account.balance) }}
            </div>
            <div v-else class="text-[13px] text-text-secondary">No balance data</div>
            <p class="text-[11px] text-text-secondary mt-1">
              {{ PROVIDERS.find(p => p.id === account.companyId)?.name ?? account.companyId }}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
    <div v-else-if="accountsData.loading.value" class="space-y-3">
      <h2 class="text-[15px] font-semibold text-text-primary">Bank Balances</h2>
      <Skeleton class="h-24 w-full rounded-lg" />
    </div>

    <!-- Credit Card Spending -->
    <h2 class="text-[15px] font-semibold text-text-primary">Credit Card Spending</h2>
    <div class="grid grid-cols-3 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-[13px] font-medium text-text-secondary">This Month</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="categorySummary.loading.value">
            <Skeleton class="h-8 w-32" />
          </div>
          <div v-else class="text-[22px] font-semibold">{{ formatCurrency(thisMonthTotal) }}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-[13px] font-medium text-text-secondary">Last Month</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="lastMonthSummary.loading.value">
            <Skeleton class="h-8 w-32" />
          </div>
          <div v-else class="text-[22px] font-semibold">{{ formatCurrency(lastMonthTotal) }}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-[13px] font-medium text-text-secondary">Difference</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="categorySummary.loading.value || lastMonthSummary.loading.value">
            <Skeleton class="h-8 w-32" />
          </div>
          <template v-else>
            <div
              class="text-[22px] font-semibold"
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
          <CardTitle class="text-[15px]">Spending by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <Doughnut v-if="categorySummary.data.value" :data="categoryChartData" :options="doughnutOptions" />
          <Skeleton v-else-if="categorySummary.loading.value" class="h-48 w-full rounded-md" />
          <p v-else class="text-text-secondary text-[13px] text-center py-12">No data yet</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-[15px]">Monthly Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <Bar v-if="monthlySummary.data.value" :data="monthlyChartData" :options="chartOptions" />
          <Skeleton v-else-if="monthlySummary.loading.value" class="h-48 w-full rounded-md" />
          <p v-else class="text-text-secondary text-[13px] text-center py-12">No data yet</p>
        </CardContent>
      </Card>
    </div>

    <!-- Cashflow -->
    <Card>
      <CardHeader>
        <CardTitle class="text-[15px]">Cashflow</CardTitle>
      </CardHeader>
      <CardContent>
        <Bar v-if="cashflowSummary.data.value" :data="cashflowChartData" :options="chartOptions" />
        <Skeleton v-else-if="cashflowSummary.loading.value" class="h-48 w-full rounded-md" />
        <p v-else class="text-text-secondary text-[13px] text-center py-12">No data yet</p>
      </CardContent>
    </Card>

    <!-- Per Account -->
    <div v-if="accountSummary.loading.value" class="space-y-3">
      <h2 class="text-[15px] font-semibold text-text-primary">Per Account (This Month)</h2>
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <Skeleton v-for="i in 3" :key="i" class="h-24 w-full rounded-lg" />
      </div>
    </div>
    <div v-else-if="accountSummary.data.value">
      <h2 class="text-[15px] font-semibold text-text-primary mb-3">Per Account (This Month)</h2>
      <p v-if="accountSummary.data.value.summary.length === 0" class="text-text-secondary text-[13px]">
        No account data yet
      </p>
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
        <Card v-for="acc in accountSummary.data.value.summary" :key="acc.accountId">
          <CardHeader class="pb-1">
            <CardTitle class="text-[13px] font-medium truncate">{{ acc.displayName }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-[17px] font-semibold">{{ formatCurrency(acc.totalAmount) }}</div>
            <p class="text-[11px] text-text-secondary mt-1">{{ acc.transactionCount }} transactions</p>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
