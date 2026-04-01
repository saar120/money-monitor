<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import { getCashflowDetail, getCategories } from '../api/client';
import { useApi } from '../composables/useApi';
import { useChartTheme } from '@/composables/useChartTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
// Select is used by PeriodSelector
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, DEFAULT_CATEGORY_COLOR, buildCategoryMap } from '@/lib/format';
import { BarChart3, Expand } from 'lucide-vue-next';
import PeriodSelector from './PeriodSelector.vue';

use([CanvasRenderer, SankeyChart, TooltipComponent]);

const { textPrimary, bgPrimary, separator } = useChartTheme();

const route = useRoute();

// ── Period selector ──

const periodMode = ref<'days' | 'month'>('month');
const selectedDays = ref('30');
const now = new Date();
// Allow URL query params to override month (used by Puppeteer screenshots)
const qStart = route.query.startDate as string | undefined;
const initialMonth = qStart
  ? qStart.slice(0, 7) // "2026-01-01" → "2026-01"
  : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const selectedMonth = ref(initialMonth);

function israelDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

const dateRange = computed(() => {
  if (periodMode.value === 'month') {
    const [y, m] = selectedMonth.value.split('-').map(Number);
    const start = new Date(y!, m! - 1, 1);
    const end = new Date(y!, m!, 0);
    return { startDate: israelDate(start), endDate: israelDate(end) };
  }
  const days = Number(selectedDays.value);
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

watch([periodMode, selectedDays, selectedMonth], refresh);

onMounted(() => {
  categoriesData.execute();
  cashflowData.execute();
});

// ── Category colors ──

const categoryMap = computed(() => buildCategoryMap(categoriesData.data.value?.categories ?? []));

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

// Compress values so large flows (surplus/income) don't dwarf small ones.
const compress = (v: number): number => Math.sqrt(v);

// ── Chart config ──

const summary = computed(() => cashflowData.data.value?.summary ?? null);
const dialogOpen = ref(false);
const dialogChartRef = ref<InstanceType<typeof VChart> | null>(null);

const CHART_HEIGHT = 420;

function buildOption(interactive: boolean) {
  if (!summary.value) return null;
  const data = summary.value;
  if (data.income.length === 0 && data.expenses.length === 0) return null;

  // Build nodes
  const nodes: Array<{ name: string; itemStyle: { color: string; borderColor: string } }> = [];
  const links: Array<{ source: string; target: string; value: number; realValue: number }> = [];

  for (const item of data.income) {
    const color = getCategoryColor(item.category);
    nodes.push({ name: `in_${item.category}`, itemStyle: { color, borderColor: color } });
  }
  nodes.push({
    name: 'cashflow',
    itemStyle: { color: CASHFLOW_COLOR, borderColor: CASHFLOW_COLOR },
  });
  for (const item of data.expenses) {
    const color = getCategoryColor(item.category);
    nodes.push({ name: `out_${item.category}`, itemStyle: { color, borderColor: color } });
  }
  if (data.surplus > 0) {
    nodes.push({
      name: 'surplus',
      itemStyle: { color: SURPLUS_COLOR, borderColor: SURPLUS_COLOR },
    });
  } else if (data.surplus < 0) {
    nodes.push({
      name: 'deficit',
      itemStyle: { color: DEFICIT_COLOR, borderColor: DEFICIT_COLOR },
    });
  }

  // Compress outgoing flows, scale income to match (Sankey conservation)
  const expenseFlows = data.expenses.map((e) => ({
    category: e.category,
    compressed: compress(e.amount),
    real: e.amount,
  }));
  const compressedSurplus = data.surplus > 0 ? compress(data.surplus) : 0;
  const compressedDeficit = data.surplus < 0 ? compress(Math.abs(data.surplus)) : 0;
  const totalCompressedOut = expenseFlows.reduce((s, e) => s + e.compressed, 0) + compressedSurplus;
  const totalCompressedIn = totalCompressedOut + compressedDeficit;

  for (const item of data.income) {
    const share = data.totalIncome > 0 ? item.amount / data.totalIncome : 1 / data.income.length;
    links.push({
      source: `in_${item.category}`,
      target: 'cashflow',
      value: share * totalCompressedIn,
      realValue: item.amount,
    });
  }
  for (const ef of expenseFlows) {
    links.push({
      source: 'cashflow',
      target: `out_${ef.category}`,
      value: ef.compressed,
      realValue: ef.real,
    });
  }
  if (data.surplus > 0) {
    links.push({
      source: 'cashflow',
      target: 'surplus',
      value: compressedSurplus,
      realValue: data.surplus,
    });
  } else if (data.surplus < 0) {
    links.push({
      source: 'deficit',
      target: 'cashflow',
      value: compressedDeficit,
      realValue: Math.abs(data.surplus),
    });
  }

  // Label & value maps
  const labelMap: Record<string, string> = {
    cashflow: 'Cash Flow',
    surplus: 'Surplus',
    deficit: 'Deficit',
  };
  const valueMap: Record<string, number> = {
    cashflow: data.totalIncome,
    surplus: data.surplus,
    deficit: Math.abs(data.surplus),
  };
  for (const item of data.income) {
    labelMap[`in_${item.category}`] = getCategoryLabel(item.category);
    valueMap[`in_${item.category}`] = item.amount;
  }
  for (const item of data.expenses) {
    labelMap[`out_${item.category}`] = getCategoryLabel(item.category);
    valueMap[`out_${item.category}`] = item.amount;
  }

  return {
    tooltip: {
      trigger: 'item' as const,
      triggerOn: 'mousemove' as const,
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      borderWidth: 1,
      textStyle: { color: textPrimary.value, fontSize: 12 },
      formatter(params: any) {
        if (params.dataType === 'edge') {
          const src = labelMap[params.data.source] ?? params.data.source;
          const tgt = labelMap[params.data.target] ?? params.data.target;
          return `${src} → ${tgt}<br/><b>${formatCurrency(params.data.realValue)}</b>`;
        }
        const name = labelMap[params.name] ?? params.name;
        const val = valueMap[params.name];
        return val != null ? `${name}<br/><b>${formatCurrency(val)}</b>` : name;
      },
    },
    series: [
      {
        type: 'sankey',
        layoutIterations: 32,
        nodeWidth: 12,
        nodeGap: 14,
        draggable: interactive,
        left: '12%',
        right: '20%',
        top: 10,
        bottom: 10,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', opacity: 0.4, curveness: 0.5 },
        label: {
          show: true,
          color: textPrimary.value,
          fontSize: 12,
          formatter(params: any) {
            const name = labelMap[params.name] ?? params.name;
            const val = valueMap[params.name];
            return val != null ? `${name}\n${formatCurrency(val)}` : name;
          },
        },
        data: nodes,
        links,
      },
    ],
  };
}

const chartOption = computed(() => buildOption(false));
const dialogChartOption = computed(() => buildOption(true));

// ── Dialog: drift clamping + CSS-based zoom/pan ──

const scale = ref(1);
const panX = ref(0);
const panY = ref(0);
const isZoomed = computed(
  () => Math.abs(scale.value - 1) > 0.01 || Math.abs(panX.value) > 1 || Math.abs(panY.value) > 1,
);
const dialogTransform = computed(
  () =>
    `scale(${scale.value}) translate(${panX.value / scale.value}px, ${panY.value / scale.value}px)`,
);

function patchDialogDrift() {
  const vc = dialogChartRef.value as any;
  const ec = vc?.chart ?? vc;
  if (!ec?.getModel) return;

  const seriesModel = ec.getModel().getSeriesByIndex(0);
  if (!seriesModel?.layoutInfo) return;
  const { width, height } = seriesModel.layoutInfo;
  const nodeData = seriesModel.getData();
  if (!nodeData?.eachItemGraphicEl) return;

  nodeData.eachItemGraphicEl((el: any, dataIndex: number) => {
    if (!el.draggable || (el as any).__driftPatched) return;

    el.drift = function (dx: number, dy: number) {
      // Adjust delta for current zoom level
      const s = scale.value;
      const adjDx = dx / s;
      const adjDy = dy / s;
      this.shape.x = Math.max(0, Math.min(this.shape.x + adjDx, width - this.shape.width));
      this.shape.y = Math.max(0, Math.min(this.shape.y + adjDy, height - this.shape.height));
      this.dirty();
      ec.dispatchAction({
        type: 'dragNode',
        seriesId: seriesModel.id,
        dataIndex: nodeData.getRawIndex(dataIndex),
        localX: this.shape.x / width,
        localY: this.shape.y / height,
      });
    };
    (el as any).__driftPatched = true;
  });
}

// Scroll to zoom (CSS transform, no ECharts conflict)
function onDialogWheel(e: WheelEvent) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  scale.value = Math.max(0.5, Math.min(scale.value * delta, 3));
}

// Click-and-hold to pan
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;

function onPanStart(e: PointerEvent) {
  if (e.button !== 0) return;
  // Don't pan if clicking on a node — check via target element
  const target = e.target as HTMLElement;
  if (target.tagName === 'CANVAS') {
    const vc = dialogChartRef.value as any;
    const ec = vc?.chart ?? vc;
    if (ec) {
      const zr = ec.getZr();
      const hovered = zr?.findHover?.(e.offsetX, e.offsetY)?.target;
      if (hovered?.draggable) return;
    }
  }
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panOriginX = panX.value;
  panOriginY = panY.value;
  document.addEventListener('pointermove', onPanMove);
  document.addEventListener('pointerup', onPanEnd);
}

function onPanMove(e: PointerEvent) {
  if (!isPanning) return;
  panX.value = panOriginX + (e.clientX - panStartX);
  panY.value = panOriginY + (e.clientY - panStartY);
}

function onPanEnd() {
  isPanning = false;
  document.removeEventListener('pointermove', onPanMove);
  document.removeEventListener('pointerup', onPanEnd);
}

function resetView() {
  scale.value = 1;
  panX.value = 0;
  panY.value = 0;
}

watch(dialogOpen, (open) => {
  if (!open) resetView();
});

onBeforeUnmount(() => {
  document.removeEventListener('pointermove', onPanMove);
  document.removeEventListener('pointerup', onPanEnd);
});
</script>

<template>
  <Card id="chart-cashflow">
    <CardHeader class="py-4 px-5 flex flex-row items-center justify-between">
      <CardTitle class="text-[15px]">Cashflow</CardTitle>
      <div class="flex items-center gap-1.5">
        <button
          v-if="chartOption"
          class="p-1 rounded-md text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-text-primary transition-all duration-150"
          title="Expand"
          @click="dialogOpen = true"
        >
          <Expand class="h-4 w-4" />
        </button>
        <PeriodSelector
          v-model:period-mode="periodMode"
          v-model:selected-days="selectedDays"
          v-model:selected-month="selectedMonth"
        />
      </div>
    </CardHeader>
    <CardContent class="px-5 pb-4 pt-0">
      <div :style="{ height: CHART_HEIGHT + 'px' }">
        <!-- Loading -->
        <Skeleton
          v-if="cashflowData.loading.value || categoriesData.loading.value"
          class="h-full w-full rounded-lg"
        />
        <!-- Error -->
        <div
          v-else-if="cashflowData.error.value || categoriesData.error.value"
          class="flex flex-col items-center justify-center h-full text-center"
        >
          <BarChart3 class="h-8 w-8 text-red-400 mb-2" />
          <p class="text-red-500 text-[13px] mb-1">Failed to load cashflow data</p>
          <button
            class="text-[12px] text-primary underline underline-offset-4 hover:no-underline transition-all duration-150"
            @click="
              refresh();
              categoriesData.execute();
            "
          >
            Retry
          </button>
        </div>
        <!-- Static chart -->
        <VChart v-else-if="chartOption" :option="chartOption" autoresize class="h-full w-full" />
        <!-- Empty state -->
        <div v-else class="flex flex-col items-center justify-center h-full text-center">
          <BarChart3 class="h-8 w-8 text-text-tertiary mb-2" />
          <p class="text-text-secondary text-[13px]">No cashflow data yet</p>
        </div>
      </div>
    </CardContent>
  </Card>

  <!-- Interactive dialog -->
  <Dialog v-model:open="dialogOpen">
    <DialogContent class="max-w-[90vw] w-[90vw] h-[85vh] flex flex-col">
      <DialogHeader class="flex-shrink-0 flex flex-row items-center justify-between pr-10">
        <div>
          <DialogTitle>Cashflow</DialogTitle>
          <DialogDescription class="text-[12px]">
            Drag nodes to rearrange. Scroll to zoom. Click and drag empty space to pan.
          </DialogDescription>
        </div>
        <PeriodSelector
          v-model:period-mode="periodMode"
          v-model:selected-days="selectedDays"
          v-model:selected-month="selectedMonth"
        />
      </DialogHeader>
      <div
        class="relative flex-1 min-h-0 overflow-hidden cursor-grab active:cursor-grabbing"
        @wheel.prevent="onDialogWheel"
        @pointerdown="onPanStart"
      >
        <VChart
          v-if="dialogChartOption && dialogOpen"
          ref="dialogChartRef"
          :option="dialogChartOption"
          autoresize
          :style="{
            width: '100%',
            height: '100%',
            transformOrigin: 'center center',
            transform: dialogTransform,
          }"
          @rendered="patchDialogDrift"
        />
        <button
          v-if="isZoomed"
          class="absolute top-2 right-2 z-10 px-2 py-1 text-[11px] rounded-md bg-[var(--glass-bg)] text-text-secondary hover:bg-[var(--glass-bg-heavy)] hover:text-text-primary border border-[var(--glass-border)] backdrop-blur-[10px] transition-all duration-150"
          @click="resetView"
        >
          Reset
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
