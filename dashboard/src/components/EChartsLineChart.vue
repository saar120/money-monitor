<script setup lang="ts">
import { computed } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import { useChartTheme } from '@/composables/useChartTheme';
import { formatCurrency } from '@/lib/format';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent]);

export interface LineDataset {
  label: string;
  data: number[];
  color: string;
  areaColor?: string;
}

const props = withDefaults(
  defineProps<{
    labels: string[];
    datasets: LineDataset[];
    yAxisFormatter?: (value: number) => string;
    tooltipFormatter?: (value: number) => string;
    showLegend?: boolean;
  }>(),
  {
    yAxisFormatter: undefined,
    tooltipFormatter: undefined,
    showLegend: false,
  },
);

const { textPrimary, textSecondary, bgPrimary, separator } = useChartTheme();

const defaultYAxisFormatter = (v: number): string => {
  if (v >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `₪${(v / 1_000).toFixed(0)}K`;
  return `₪${v}`;
};

const option = computed(() => ({
  tooltip: {
    trigger: 'axis' as const,
    backgroundColor: bgPrimary.value,
    borderColor: separator.value,
    borderWidth: 1,
    textStyle: { color: textPrimary.value, fontSize: 12 },
    formatter(params: any) {
      const p = Array.isArray(params) ? params : [params];
      const fmt = props.tooltipFormatter ?? ((v: number) => formatCurrency(v));
      let html = `<div style="font-size:11px;color:${textSecondary.value}">${p[0].axisValueLabel}</div>`;
      for (const item of p) {
        html += `<div style="margin-top:4px">${item.marker} ${item.seriesName}: <b>${fmt(item.value)}</b></div>`;
      }
      return html;
    },
  },
  legend: props.showLegend
    ? {
        show: true,
        bottom: 0,
        textStyle: { color: textSecondary.value, fontSize: 11 },
      }
    : { show: false },
  grid: {
    left: 12,
    right: 12,
    top: 10,
    bottom: props.showLegend ? 30 : 10,
    containLabel: true,
  },
  xAxis: {
    type: 'category' as const,
    data: props.labels,
    axisLabel: { color: textSecondary.value, fontSize: 11 },
    axisLine: { lineStyle: { color: separator.value } },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'value' as const,
    axisLabel: {
      color: textSecondary.value,
      fontSize: 11,
      formatter: props.yAxisFormatter ?? defaultYAxisFormatter,
    },
    splitLine: { lineStyle: { color: separator.value, type: 'dashed' as const } },
  },
  series: props.datasets.map((ds) => ({
    name: ds.label,
    type: 'line' as const,
    data: ds.data,
    smooth: 0.4,
    symbol: 'circle',
    symbolSize: 6,
    showSymbol: true,
    lineStyle: { width: 2.5, cap: 'round' as const, join: 'round' as const, color: ds.color },
    itemStyle: { color: ds.color },
    areaStyle: ds.areaColor ? { color: ds.areaColor } : undefined,
    connectNulls: true,
  })),
}));
</script>

<template>
  <VChart :option="option" autoresize class="h-full w-full" />
</template>
