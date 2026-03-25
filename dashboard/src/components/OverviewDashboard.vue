<script setup lang="ts">
import { onMounted, computed, watch } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart, BarChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import { useDocumentVisibility, useThrottleFn } from '@vueuse/core';
import { getSummary, getAccounts } from '../api/client';
import CashflowSankey from './CashflowSankey.vue';
import { useApi } from '../composables/useApi';
import { useSseConnection } from '../composables/useSseConnection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { useChartTheme } from '@/composables/useChartTheme';
import { BarChart3 } from 'lucide-vue-next';

use([CanvasRenderer, PieChart, BarChart, TooltipComponent, LegendComponent, GridComponent]);

const { textPrimary, textSecondary, bgPrimary, separator } = useChartTheme();

function israelDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}
const [y, m] = israelDate(new Date()).split('-').map(Number) as [number, number];
const thisMonthStart = `${y}-${String(m).padStart(2, '0')}-01`;
const thisMonthEnd = israelDate(new Date(y, m, 0)); // last day of current month
const lastMonthStart = israelDate(new Date(y, m - 2, 1));
const lastMonthEnd = israelDate(new Date(y, m - 1, 0));

const accountsData = useApi(() => getAccounts());
const categorySummary = useApi(() =>
  getSummary({
    groupBy: 'category',
    startDate: thisMonthStart,
    endDate: thisMonthEnd,
    expensesOnly: true,
  }),
);
const monthlySummary = useApi(() => getSummary({ groupBy: 'month', expensesOnly: true }));
const accountSummary = useApi(() =>
  getSummary({
    groupBy: 'account',
    startDate: thisMonthStart,
    endDate: thisMonthEnd,
    expensesOnly: true,
  }),
);
const lastMonthSummary = useApi(() =>
  getSummary({
    groupBy: 'category',
    startDate: lastMonthStart,
    endDate: lastMonthEnd,
    expensesOnly: true,
  }),
);
const bankAccounts = computed(() =>
  (accountsData.data.value?.accounts ?? []).filter((a) => a.accountType === 'bank'),
);

function refreshAll() {
  accountsData.execute();
  categorySummary.execute();
  monthlySummary.execute();
  accountSummary.execute();
  lastMonthSummary.execute();
}

const throttledRefresh = useThrottleFn(refreshAll, 2000);

// Refresh when scraping completes
const { connect: connectSse } = useSseConnection({
  'account-scrape-done': throttledRefresh,
  'session-completed': throttledRefresh,
});

// Refresh when window regains focus (catches any external data changes)
const visibility = useDocumentVisibility();
watch(visibility, (state) => {
  if (state === 'visible') throttledRefresh();
});

onMounted(() => {
  refreshAll();
  connectSse();
});

const thisMonthTotal = computed(
  () => categorySummary.data.value?.summary.reduce((sum, s) => sum + s.totalAmount, 0) ?? 0,
);
const lastMonthTotal = computed(
  () => lastMonthSummary.data.value?.summary.reduce((sum, s) => sum + s.totalAmount, 0) ?? 0,
);

const chartColors = [
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#AF52DE',
  '#FF2D55',
  '#5AC8FA',
  '#FFCC00',
  '#FF3B30',
  '#30D158',
  '#64D2FF',
];

const doughnutOption = computed(() => {
  const items = categorySummary.data.value?.summary ?? [];
  if (items.length === 0) return null;
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      borderWidth: 1,
      textStyle: { color: textPrimary.value, fontSize: 12 },
      formatter(params: any) {
        return `${params.name}<br/><b>${formatCurrency(params.value)}</b> (${params.percent}%)`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textSecondary.value, fontSize: 11 },
      itemWidth: 8,
      itemHeight: 8,
      icon: 'circle',
    },
    series: [{
      type: 'pie',
      radius: ['60%', '85%'],
      center: ['50%', '45%'],
      padAngle: 2,
      itemStyle: { borderRadius: 6 },
      label: { show: false },
      data: items.map((s, i) => ({
        name: s.category ?? 'uncategorized',
        value: Math.abs(s.totalAmount),
        itemStyle: { color: chartColors[i % chartColors.length] },
      })),
    }],
  };
});

const barOption = computed(() => {
  const items = (monthlySummary.data.value?.summary ?? []).slice(0, 12).reverse();
  if (items.length === 0) return null;
  return {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      borderWidth: 1,
      textStyle: { color: textPrimary.value, fontSize: 12 },
      formatter(params: any) {
        const p = Array.isArray(params) ? params[0] : params;
        return `${p.axisValueLabel}<br/><b>${formatCurrency(p.value)}</b>`;
      },
    },
    grid: { left: 12, right: 12, top: 10, bottom: 10, containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: items.map(s => s.month ?? ''),
      axisLabel: { color: textSecondary.value, fontSize: 11 },
      axisLine: { lineStyle: { color: separator.value } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: textSecondary.value, fontSize: 11 },
      splitLine: { lineStyle: { color: separator.value, type: 'dashed' as const } },
    },
    series: [{
      type: 'bar',
      data: items.map(s => Math.abs(s.totalAmount)),
      itemStyle: { color: '#007AFF', borderRadius: [6, 6, 0, 0] },
    }],
  };
});

</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <div class="flex-1 min-h-0 overflow-y-auto space-y-5">
      <!-- Bank Balances + Spending — compact top row -->
      <div class="grid grid-cols-[auto_1fr] gap-4 items-end">
        <h2 v-if="bankAccounts.length > 0" class="text-[13px] font-semibold text-text-secondary">
          Bank Balances
        </h2>
        <div v-else-if="accountsData.loading.value" />
        <div v-else />
        <h2 class="text-[13px] font-semibold text-text-secondary">Spending</h2>
      </div>
      <!-- All cards in one flat flex row so they share the same height -->
      <div class="flex gap-3 items-stretch">
        <!-- Bank Balances -->
        <template v-if="bankAccounts.length > 0">
          <Card v-for="account in bankAccounts" :key="account.id" class="min-w-[180px]">
            <CardContent class="py-4 px-5">
              <p class="text-[12px] font-medium truncate text-text-secondary">
                {{ account.displayName }}
              </p>
              <p v-if="account.balance != null" class="text-[17px] font-semibold mt-1 tabular-nums">
                {{ formatCurrency(account.balance) }}
              </p>
              <p v-else class="text-[12px] text-text-tertiary mt-1">No balance data</p>
            </CardContent>
          </Card>
        </template>
        <Skeleton v-else-if="accountsData.loading.value" class="h-16 w-48 rounded-xl" />

        <!-- Spacer between sections -->
        <div class="w-4 flex-shrink-0" />

        <!-- Spending -->
        <Card class="flex-1">
          <CardContent class="py-4 px-5">
            <p class="text-[12px] text-text-secondary">This Month</p>
            <div v-if="categorySummary.loading.value"><Skeleton class="h-6 w-24 mt-1" /></div>
            <p v-else class="text-[18px] font-semibold mt-1 tabular-nums">
              {{ formatCurrency(thisMonthTotal) }}
            </p>
          </CardContent>
        </Card>
        <Card class="flex-1">
          <CardContent class="py-4 px-5">
            <p class="text-[12px] text-text-secondary">Last Month</p>
            <div v-if="lastMonthSummary.loading.value"><Skeleton class="h-6 w-24 mt-1" /></div>
            <p v-else class="text-[18px] font-semibold mt-1 tabular-nums">
              {{ formatCurrency(lastMonthTotal) }}
            </p>
          </CardContent>
        </Card>
        <Card class="flex-1">
          <CardContent class="py-4 px-5">
            <p class="text-[12px] text-text-secondary">Difference</p>
            <div v-if="categorySummary.loading.value || lastMonthSummary.loading.value">
              <Skeleton class="h-6 w-24 mt-1" />
            </div>
            <template v-else>
              <p
                class="text-[18px] font-semibold mt-1 tabular-nums"
                :class="
                  Math.abs(thisMonthTotal) > Math.abs(lastMonthTotal)
                    ? 'text-destructive'
                    : 'text-success'
                "
              >
                {{ formatCurrency(Math.abs(Math.abs(thisMonthTotal) - Math.abs(lastMonthTotal))) }}
              </p>
              <Badge
                v-if="Math.abs(thisMonthTotal) > Math.abs(lastMonthTotal)"
                variant="destructive"
                class="mt-1.5 text-[10px]"
                >↑ More than last month</Badge
              >
              <Badge v-else class="mt-1.5 text-[10px] bg-success/10 text-success"
                >↓ Less than last month</Badge
              >
            </template>
          </CardContent>
        </Card>
      </div>

      <!-- Charts Row — constrained height -->
      <div class="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader class="py-4 px-5">
            <CardTitle class="text-[15px]">Spending by Category</CardTitle>
          </CardHeader>
          <CardContent class="px-5 pb-4 pt-0">
            <div class="h-[240px] flex items-center justify-center">
              <VChart
                v-if="doughnutOption"
                :option="doughnutOption"
                autoresize
                class="h-full w-full"
              />
              <Skeleton
                v-else-if="categorySummary.loading.value"
                class="h-full w-full rounded-lg"
              />
              <div v-else class="flex flex-col items-center justify-center text-center">
                <BarChart3 class="h-8 w-8 text-text-tertiary mb-2" />
                <p class="text-text-secondary text-[13px]">No data yet</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="py-4 px-5">
            <CardTitle class="text-[15px]">Monthly Trend</CardTitle>
          </CardHeader>
          <CardContent class="px-5 pb-4 pt-0">
            <div class="h-[240px]">
              <VChart
                v-if="barOption"
                :option="barOption"
                autoresize
                class="h-full w-full"
              />
              <Skeleton v-else-if="monthlySummary.loading.value" class="h-full w-full rounded-lg" />
              <div v-else class="flex flex-col items-center justify-center h-full text-center">
                <BarChart3 class="h-8 w-8 text-text-tertiary mb-2" />
                <p class="text-text-secondary text-[13px]">No data yet</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Cashflow Sankey -->
      <CashflowSankey />

      <!-- Per Account -->
      <div v-if="accountSummary.loading.value" class="space-y-2">
        <h2 class="text-[13px] font-semibold text-text-secondary">Per Account (This Month)</h2>
        <div
          class="grid gap-3"
          style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))"
        >
          <Skeleton v-for="i in 3" :key="i" class="h-16 w-full rounded-xl" />
        </div>
      </div>
      <div v-else-if="accountSummary.data.value">
        <h2 class="text-[13px] font-semibold text-text-secondary mb-3">Per Account (This Month)</h2>
        <p
          v-if="accountSummary.data.value.summary.length === 0"
          class="text-text-tertiary text-[13px]"
        >
          No account data yet
        </p>
        <div
          class="grid gap-3"
          style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))"
        >
          <Card v-for="acc in accountSummary.data.value.summary" :key="acc.accountId">
            <CardContent class="py-4 px-5">
              <p class="text-[12px] font-medium truncate text-text-secondary">
                {{ acc.displayName }}
              </p>
              <p class="text-[17px] font-semibold mt-1 tabular-nums">
                {{ formatCurrency(acc.totalAmount) }}
              </p>
              <p class="text-[11px] text-text-tertiary mt-0.5">
                {{ acc.transactionCount }} transactions
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>
