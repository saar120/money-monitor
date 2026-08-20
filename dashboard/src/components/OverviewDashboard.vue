<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart, BarChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import { getHomeOverview, type HomeOverview } from '../api/client';
import { useApi } from '../composables/useApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { useChartTheme } from '@/composables/useChartTheme';
import { BarChart3, ArrowRight } from 'lucide-vue-next';

use([CanvasRenderer, PieChart, BarChart, TooltipComponent, LegendComponent, GridComponent]);

const router = useRouter();
const { textPrimary, textSecondary, bgPrimary, separator } = useChartTheme();
const overview = useApi(getHomeOverview);

function numeric(value: { value: string } | null): number {
  return value ? Number(value.value) : 0;
}

function displayMoney(value: { value: string; currencyCode: string } | null): string {
  return value ? formatCurrency(numeric(value)) : 'Unavailable';
}

function refresh() {
  overview.execute();
}

function openDrillDown(drillDown: { startDate: string; endDate: string; category?: string }) {
  router.push({
    path: '/transactions',
    query: {
      startDate: drillDown.startDate,
      endDate: drillDown.endDate,
      ...(drillDown.category ? { category: drillDown.category } : {}),
    },
  });
}

onMounted(refresh);

const data = computed<HomeOverview | null>(() => overview.data.value?.data ?? null);
const categoryOption = computed(() => {
  if (!data.value?.categories.length) return null;
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      textStyle: { color: textPrimary.value, fontSize: 12 },
      formatter: (params: any) => `${params.name}<br/><b>${formatCurrency(params.value)}</b> (${params.percent}%)`,
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
      radius: ['50%', '72%'],
      center: ['50%', '38%'],
      itemStyle: { borderRadius: 6 },
      label: { show: false },
      data: data.value.categories.map((category, index) => ({
        name: category.label,
        value: numeric(category.amount),
        itemStyle: { color: ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA'][index % 6] },
      })),
    }],
  };
});

const cashFlowOption = computed(() => {
  if (!data.value?.cashFlow.length) return null;
  const items = data.value.cashFlow;
  return {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      textStyle: { color: textPrimary.value, fontSize: 12 },
    },
    grid: { left: 12, right: 12, top: 10, bottom: 10, containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: items.map((item) => item.period.startDate.slice(0, 7)),
      axisLabel: { color: textSecondary.value, fontSize: 11 },
      axisLine: { lineStyle: { color: separator.value } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: textSecondary.value, fontSize: 11 },
      splitLine: { lineStyle: { color: separator.value, type: 'dashed' as const } },
    },
    series: [
      { name: 'Income', type: 'bar', data: items.map((item) => numeric(item.income)), itemStyle: { color: '#34C759' } },
      { name: 'Expenses', type: 'bar', data: items.map((item) => numeric(item.expenses)), itemStyle: { color: '#FF9500' } },
    ],
  };
});

function freshnessLabel(status: HomeOverview['accountFreshness'][number]['status']): string {
  return status === 'current' ? 'Current' : status === 'stale' ? 'Stale' : 'Unknown';
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <div class="flex-1 min-h-0 overflow-y-auto space-y-5">
      <div v-if="overview.loading.value && !data" class="grid grid-cols-3 gap-3">
        <Skeleton v-for="i in 3" :key="i" class="h-24 rounded-xl" />
      </div>
      <div v-else-if="overview.error.value && !data" class="rounded-xl border border-destructive/30 p-6 text-center">
        <p class="text-destructive text-sm">Home data could not be loaded.</p>
        <button class="mt-2 text-sm text-primary underline" @click="refresh">Retry</button>
      </div>
      <template v-else-if="data">
        <div
          v-if="overview.data.value?.meta.completeness === 'partial'"
          class="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
          role="status"
        >
          Partial Home data — unavailable values are marked individually.
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardContent class="py-4 px-5">
              <p class="text-[12px] text-text-secondary">Available money</p>
              <p class="text-[18px] font-semibold mt-1 tabular-nums">{{ displayMoney(data.availableMoney) }}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="py-4 px-5">
              <p class="text-[12px] text-text-secondary">Spending this period</p>
              <p class="text-[18px] font-semibold mt-1 tabular-nums">{{ displayMoney(data.spending.current.amount) }}</p>
              <p class="text-[11px] text-text-tertiary">{{ data.spending.current.period.startDate }} – {{ data.spending.current.period.endDate }}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="py-4 px-5">
              <p class="text-[12px] text-text-secondary">Compared with prior period</p>
              <p class="text-[18px] font-semibold mt-1 tabular-nums">{{ displayMoney(data.spending.change) }}</p>
              <p class="text-[11px] text-text-tertiary">Server-calculated change</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="py-4 px-5">
              <p class="text-[12px] text-text-secondary">Net worth</p>
              <p class="text-[18px] font-semibold mt-1 tabular-nums">{{ displayMoney(data.netWorth.total) }}</p>
              <p class="text-[11px] text-text-tertiary">Mac-calculated</p>
            </CardContent>
          </Card>
        </div>

        <Card v-if="data.budget">
          <CardContent class="py-4 px-5 flex items-center justify-between gap-3">
            <div>
              <p class="text-[12px] text-text-secondary">{{ data.budget.name }}</p>
              <p class="text-[17px] font-semibold mt-1">{{ displayMoney(data.budget.remaining) }} remaining</p>
              <p class="text-[11px] text-text-tertiary">{{ displayMoney(data.budget.spent) }} of {{ displayMoney(data.budget.limit) }} · {{ data.budget.state.replace('_', ' ') }}</p>
            </div>
            <span class="text-xs capitalize">{{ data.budget.state.replace('_', ' ') }}</span>
          </CardContent>
        </Card>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card id="chart-spending-by-category">
            <CardHeader class="py-4 px-5"><CardTitle class="text-[15px]">Spending by category</CardTitle></CardHeader>
            <CardContent class="px-5 pb-4 pt-0">
              <div class="h-[260px]">
                <VChart v-if="categoryOption" :option="categoryOption" autoresize class="h-full w-full" aria-label="Spending by category chart" />
                <div v-else class="flex flex-col items-center justify-center h-full text-center"><BarChart3 class="h-8 w-8 text-text-tertiary mb-2" /><p class="text-text-secondary text-[13px]">No spending data yet</p></div>
              </div>
              <ul class="space-y-1 text-sm" aria-label="Spending by category details">
                <li v-for="category in data.categories" :key="category.label">
                  <button class="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted" @click="openDrillDown(category.drillDown)">
                    <span>{{ category.textSummary }}</span><ArrowRight class="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card id="chart-cashflow">
            <CardHeader class="py-4 px-5"><CardTitle class="text-[15px]">Cash flow</CardTitle></CardHeader>
            <CardContent class="px-5 pb-4 pt-0">
              <div class="h-[260px]">
                <VChart v-if="cashFlowOption" :option="cashFlowOption" autoresize class="h-full w-full" aria-label="Cash flow chart" />
                <div v-else class="flex flex-col items-center justify-center h-full text-center"><BarChart3 class="h-8 w-8 text-text-tertiary mb-2" /><p class="text-text-secondary text-[13px]">No cash flow data yet</p></div>
              </div>
              <ul class="space-y-1 text-sm" aria-label="Cash flow details">
                <li v-for="point in data.cashFlow.slice(-3)" :key="point.period.startDate">
                  <button class="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted" @click="openDrillDown(point.drillDown)">
                    <span>{{ point.textSummary }}</span><ArrowRight class="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader class="py-4 px-5"><CardTitle class="text-[15px]">Account freshness</CardTitle></CardHeader>
          <CardContent class="px-5 pb-4 pt-0">
            <p v-if="data.accountFreshness.length === 0" class="text-sm text-text-tertiary">No accounts configured.</p>
            <ul v-else class="divide-y divide-border" aria-label="Account freshness details">
              <li v-for="account in data.accountFreshness" :key="account.displayName" class="flex items-center justify-between py-2 text-sm">
                <span>{{ account.displayName }}</span><span>{{ freshnessLabel(account.status) }}</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <p class="text-[11px] text-text-tertiary">Calculated {{ data.calculatedAt }} · Financial date {{ data.financialDate }} · {{ data.isEmpty ? 'No financial data yet.' : 'Mac is the source of truth.' }}</p>
      </template>
    </div>
  </div>
</template>
