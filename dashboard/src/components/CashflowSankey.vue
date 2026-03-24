<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Chart as ChartJS, type ScriptableContext } from 'chart.js';
import { SankeyController, Flow } from 'chartjs-chart-sankey';
import { getCashflowDetail, getCategories } from '../api/client';
import { useApi } from '../composables/useApi';
import { useChartTheme } from '@/composables/useChartTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, DEFAULT_CATEGORY_COLOR, buildCategoryMap } from '@/lib/format';
import { BarChart3 } from 'lucide-vue-next';

ChartJS.register(SankeyController, Flow);

const { tooltip: themeTooltip, textPrimary } = useChartTheme();

// ── Period selector ──

const periods = [
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '180', label: '6M' },
  { value: '365', label: '1Y' },
] as const;

const selectedPeriod = ref('30');

function israelDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

const dateRange = computed(() => {
  const days = Number(selectedPeriod.value);
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: israelDate(start), endDate: israelDate(end) };
});

// ── Data fetching ──

const categoriesData = useApi(() => getCategories());
const cashflowData = useApi(() =>
  getCashflowDetail({ startDate: dateRange.value.startDate, endDate: dateRange.value.endDate }),
);

function refresh() {
  cashflowData.execute();
}

watch(selectedPeriod, refresh);

onMounted(() => {
  categoriesData.execute();
  cashflowData.execute();
});

// ── Category colors ──

const categoryMap = computed(() =>
  buildCategoryMap(categoriesData.data.value?.categories ?? []),
);

function getCategoryColor(name: string): string {
  return categoryMap.value.get(name)?.color ?? DEFAULT_CATEGORY_COLOR;
}

function getCategoryLabel(name: string): string {
  return categoryMap.value.get(name)?.label ?? name;
}

// ── Chart colors ──

const CASHFLOW_COLOR = '#34C759';
const SURPLUS_COLOR = '#34C759';
const DEFICIT_COLOR = '#FF2D55';

// ── Canvas ref & rendering ──

const canvasRef = ref<HTMLCanvasElement | null>(null);
let chartInstance: ChartJS<'sankey'> | null = null;

const summary = computed(() => cashflowData.data.value?.summary ?? null);

function buildChart() {
  if (!canvasRef.value || !summary.value) return;

  const data = summary.value;
  if (data.income.length === 0 && data.expenses.length === 0) return;

  // Destroy existing chart
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  // Build flows: income → Cash Flow → expenses + surplus/deficit
  const flows: Array<{ from: string; to: string; flow: number }> = [];

  for (const item of data.income) {
    flows.push({ from: `in_${item.category}`, to: 'cashflow', flow: item.amount });
  }
  for (const item of data.expenses) {
    flows.push({ from: 'cashflow', to: `out_${item.category}`, flow: item.amount });
  }
  if (data.surplus > 0) {
    flows.push({ from: 'cashflow', to: 'surplus', flow: data.surplus });
  } else if (data.surplus < 0) {
    flows.push({ from: 'deficit', to: 'cashflow', flow: Math.abs(data.surplus) });
  }

  // Build label map
  const labels: Record<string, string> = { cashflow: `Cash Flow\n${formatCurrency(data.totalIncome)}` };
  for (const item of data.income) {
    labels[`in_${item.category}`] = `${getCategoryLabel(item.category)}\n${formatCurrency(item.amount)}`;
  }
  for (const item of data.expenses) {
    labels[`out_${item.category}`] = `${getCategoryLabel(item.category)}\n${formatCurrency(item.amount)}`;
  }
  if (data.surplus > 0) {
    labels['surplus'] = `Surplus\n${formatCurrency(data.surplus)}`;
  } else if (data.surplus < 0) {
    labels['deficit'] = `Deficit\n${formatCurrency(Math.abs(data.surplus))}`;
  }

  // Build color map
  const colorMap: Record<string, string> = { cashflow: CASHFLOW_COLOR };
  for (const item of data.income) {
    colorMap[`in_${item.category}`] = getCategoryColor(item.category);
  }
  for (const item of data.expenses) {
    colorMap[`out_${item.category}`] = getCategoryColor(item.category);
  }
  if (data.surplus > 0) {
    colorMap['surplus'] = SURPLUS_COLOR;
  } else if (data.surplus < 0) {
    colorMap['deficit'] = DEFICIT_COLOR;
  }

  // Column assignments: income=0, cashflow=1, expenses=2
  const column: Record<string, number> = { cashflow: 1 };
  for (const item of data.income) {
    column[`in_${item.category}`] = 0;
  }
  for (const item of data.expenses) {
    column[`out_${item.category}`] = 2;
  }
  if (data.surplus > 0) {
    column['surplus'] = 2;
  } else if (data.surplus < 0) {
    column['deficit'] = 0;
  }

  const ctx = canvasRef.value.getContext('2d');
  if (!ctx) return;

  chartInstance = new ChartJS(ctx, {
    type: 'sankey',
    data: {
      datasets: [
        {
          data: flows,
          colorFrom: (c: ScriptableContext<'sankey'>) => {
            const raw = c.dataset.data[c.dataIndex] as { from: string } | undefined;
            return raw ? colorMap[raw.from] ?? DEFAULT_CATEGORY_COLOR : DEFAULT_CATEGORY_COLOR;
          },
          colorTo: (c: ScriptableContext<'sankey'>) => {
            const raw = c.dataset.data[c.dataIndex] as { to: string } | undefined;
            return raw ? colorMap[raw.to] ?? DEFAULT_CATEGORY_COLOR : DEFAULT_CATEGORY_COLOR;
          },
          colorMode: 'gradient',
          labels,
          column,
          nodeWidth: 12,
          nodePadding: 14,
          borderWidth: 0,
          color: textPrimary.value,
        } as any,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        tooltip: {
          ...themeTooltip.value,
          callbacks: {
            label(ctx: any) {
              const raw = ctx.raw as { from: string; to: string; flow: number };
              const fromLabel = labels[raw.from]?.split('\n')[0] ?? raw.from;
              const toLabel = labels[raw.to]?.split('\n')[0] ?? raw.to;
              return `${fromLabel} → ${toLabel}: ${formatCurrency(raw.flow)}`;
            },
          },
        },
        legend: { display: false },
      },
    } as any,
  });
}

watch([summary, canvasRef], () => buildChart(), { flush: 'post' });
watch(textPrimary, () => {
  if (chartInstance && summary.value) buildChart();
});
</script>

<template>
  <Card>
    <CardHeader class="py-4 px-5 flex flex-row items-center justify-between">
      <CardTitle class="text-[15px]">Cashflow</CardTitle>
      <Select v-model="selectedPeriod">
        <SelectTrigger class="w-[80px] h-7 text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="p in periods" :key="p.value" :value="p.value">
            {{ p.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </CardHeader>
    <CardContent class="px-5 pb-4 pt-0">
      <div class="h-[320px]">
        <!-- Loading -->
        <Skeleton
          v-if="cashflowData.loading.value || categoriesData.loading.value"
          class="h-full w-full rounded-lg"
        />
        <!-- Chart -->
        <canvas
          v-else-if="summary && (summary.income.length > 0 || summary.expenses.length > 0)"
          ref="canvasRef"
        />
        <!-- Empty state -->
        <div v-else class="flex flex-col items-center justify-center h-full text-center">
          <BarChart3 class="h-8 w-8 text-text-tertiary mb-2" />
          <p class="text-text-secondary text-[13px]">No cashflow data yet</p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
