<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AdvisorChart } from '@/api/client';
import { formatAmount } from '@/lib/format';

const props = defineProps<{ chart: AdvisorChart }>();
const selected = ref(props.chart.kind === 'line' ? props.chart.points.length - 1 : 0);
watch(
  () => props.chart,
  (chart) => {
    selected.value = chart.kind === 'line' ? chart.points.length - 1 : 0;
  },
);
const point = computed(() => props.chart.points[selected.value] ?? props.chart.points[0]);
const max = computed(() => Math.max(1, ...props.chart.points.map((item) => item.value)));
const plotted = computed(() =>
  props.chart.points.map((item, index) => ({
    x: props.chart.points.length === 1 ? 300 : 12 + (index * 576) / (props.chart.points.length - 1),
    y: 132 - (item.value / max.value) * 116,
  })),
);
const line = computed(() => plotted.value.map(({ x, y }) => `${x},${y}`).join(' '));
</script>

<template>
  <section class="advisor-chart" :aria-label="chart.title">
    <p class="advisor-chart-title" dir="auto">{{ chart.title }}</p>
    <strong v-if="point" class="advisor-chart-value" dir="auto">
      {{ point.label }} · {{ formatAmount(point.value, chart.currencyCode) }}
    </strong>
    <template v-if="chart.kind === 'line'">
      <div class="advisor-line-wrap" dir="ltr">
        <svg viewBox="0 0 600 148" role="img" :aria-label="chart.title" preserveAspectRatio="none">
          <line x1="12" y1="132" x2="588" y2="132" class="advisor-axis" />
          <polyline :points="line" class="advisor-line" />
          <circle
            v-for="(position, index) in plotted"
            :key="index"
            :cx="position.x"
            :cy="position.y"
            :r="selected === index ? 6 : 3"
            class="advisor-dot"
          />
        </svg>
        <div class="advisor-line-targets">
          <button
            v-for="(item, index) in chart.points"
            :key="`${item.label}-${index}`"
            type="button"
            :aria-label="`${item.label}, ${formatAmount(item.value, chart.currencyCode)}`"
            :aria-pressed="selected === index"
            @click="selected = index"
          />
        </div>
      </div>
      <div class="advisor-line-labels" dir="ltr">
        <span dir="auto">{{ chart.points[0]?.label }}</span>
        <span dir="auto">{{ chart.points[chart.points.length - 1]?.label }}</span>
      </div>
    </template>
    <div v-else class="advisor-bars">
      <button
        v-for="(item, index) in chart.points"
        :key="`${item.label}-${index}`"
        type="button"
        class="advisor-bar-row"
        :class="{ selected: selected === index }"
        :aria-pressed="selected === index"
        :aria-label="`${item.label}, ${formatAmount(item.value, chart.currencyCode)}`"
        @click="selected = index"
      >
        <span class="advisor-bar-label" dir="auto">{{ item.label }}</span>
        <span class="advisor-bar-track"
          ><span :style="{ width: `${(item.value / max) * 100}%` }"
        /></span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.advisor-chart {
  width: min(420px, 100%);
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--separator);
  border-radius: 16px;
  background: var(--bg-primary);
}
.advisor-chart-title {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.advisor-chart-value {
  display: block;
  margin-top: 5px;
  color: var(--text-primary);
  font-size: 15px;
}
.advisor-line-wrap {
  position: relative;
  height: 150px;
  margin-top: 12px;
}
.advisor-line-wrap svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.advisor-axis {
  stroke: var(--separator);
  stroke-width: 1;
}
.advisor-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.advisor-dot {
  fill: var(--accent);
  stroke: var(--bg-primary);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.advisor-line-targets {
  position: absolute;
  inset: 0;
  display: flex;
}
.advisor-line-targets button {
  flex: 1;
  min-width: 0;
  cursor: crosshair;
}
.advisor-line-targets button:focus-visible,
.advisor-bar-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 5px;
}
.advisor-line-labels {
  display: flex;
  justify-content: space-between;
  color: var(--text-tertiary);
  font-size: 11px;
}
.advisor-bars {
  display: grid;
  gap: 5px;
  margin-top: 14px;
}
.advisor-bar-row {
  display: grid;
  grid-template-columns: minmax(0, 110px) 1fr;
  align-items: center;
  gap: 10px;
  min-height: 25px;
  text-align: left;
}
.advisor-bar-label {
  color: var(--text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.advisor-bar-row.selected .advisor-bar-label {
  color: var(--text-primary);
  font-weight: 700;
}
.advisor-bar-track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-tertiary);
}
.advisor-bar-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.3s ease;
}
@media (prefers-reduced-motion: reduce) {
  .advisor-bar-track span {
    transition: none;
  }
}
</style>
