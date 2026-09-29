<script setup lang="ts">
import { categoryMotionName } from '@/lib/cardMotion';
import AnimatedAmount from './AnimatedAmount.vue';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, ArrowRight } from 'lucide-vue-next';
import { getCategories, getSummary, type Category, type SummaryItem } from '../api/client';
import { formatCompactNumber, formatCurrency } from '@/lib/format';
import { isValidMonth } from '@/lib/month';
import { language, t } from '@/lib/language';

const route = useRoute();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const initial = isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7);
const selectedMonth = ref(initial);
const range = ref<3 | 6 | 12>(6);
const loading = ref(true);
const error = ref('');
const categories = ref<Category[]>([]);
const byMonth = ref(new Map<string, SummaryItem[]>());
const grossByMonth = ref(new Map<string, number>());
function monthKey(back: number) {
  const [year, number] = initial.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1 - back, 1)).toISOString().slice(0, 7);
}
function monthRange(key: string) {
  const [year, number] = key.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return {
    startDate: `${key}-01`,
    endDate: `${key}-${String(key === today.slice(0, 7) ? Math.min(lastDay, Number(today.slice(8, 10))) : lastDay).padStart(2, '0')}`,
  };
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const keys = Array.from({ length: 12 }, (_, index) => monthKey(11 - index));
    const [categoryData, gross, ...summaries] = await Promise.all([
      getCategories(),
      getSummary({ groupBy: 'month', expensesOnly: true, endDate: monthRange(initial).endDate }),
      ...keys.map((key) => getSummary({ groupBy: 'spending-category', ...monthRange(key) })),
    ]);
    categories.value = categoryData.categories;
    grossByMonth.value = new Map(
      gross.summary.map((item) => [item.month ?? '', Math.abs(item.totalAmount)]),
    );
    byMonth.value = new Map(keys.map((key, index) => [key, summaries[index]!.summary]));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Monthly comparison could not load.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);
const months = computed(() =>
  Array.from({ length: range.value }, (_, index) => {
    const key = monthKey(range.value - 1 - index);
    const items = (byMonth.value.get(key) ?? [])
      .filter((item) => item.totalAmount !== 0)
      .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount));
    const spendingItems = items.filter((item) => item.totalAmount < 0);
    return {
      key,
      items,
      spendingItems,
      total: spendingItems.reduce((sum, item) => sum + Math.abs(item.totalAmount), 0),
    };
  }),
);
const selected = computed(
  () =>
    months.value.find((item) => item.key === selectedMonth.value) ??
    months.value[months.value.length - 1]!,
);
const axisMaximum = computed(() => {
  const maximum = Math.max(0, ...months.value.map((item) => item.total));
  if (maximum <= 0) return 5;
  const roughStep = maximum / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude * 5;
});
const ticks = computed(() =>
  Array.from({ length: 6 }, (_, index) => axisMaximum.value - (axisMaximum.value / 5) * index),
);
const categoryMap = computed(() => new Map(categories.value.map((item) => [item.name, item])));
const categoryLink = (name: string) => ({
  path: `/explore/category/${encodeURIComponent(name)}`,
  query: { month: selected.value.key },
});
let scrubPointer: number | null = null;
let scrubCenters: Array<{ key: string; x: number }> = [];
const scrubbing = ref(false);
function scrub(event: PointerEvent) {
  if (scrubPointer !== event.pointerId) return;
  const closest = scrubCenters.reduce<{ key: string; x: number } | undefined>(
    (best, point) =>
      !best || Math.abs(event.clientX - point.x) < Math.abs(event.clientX - best.x) ? point : best,
    undefined,
  );
  if (closest) selectedMonth.value = closest.key;
}
function beginScrub(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = event.currentTarget as HTMLElement;
  scrubCenters = Array.from(
    target.querySelectorAll<globalThis.HTMLButtonElement>(
      'button[data-month]:not(.ledger-reflow-leave-active)',
    ),
    (button) => {
      const rect = button.getBoundingClientRect();
      return { key: button.dataset.month!, x: rect.left + rect.width / 2 };
    },
  );
  scrubPointer = event.pointerId;
  scrubbing.value = true;
  target.setPointerCapture(event.pointerId);
  scrub(event);
}
function endScrub() {
  scrubPointer = null;
  scrubbing.value = false;
  scrubCenters = [];
}
</script>

<template>
  <div class="ledger-page monthly-comparison-page">
    <Teleport to="#toolbar-actions">
      <div class="comparison-range" role="group" :aria-label="t('timeRange')">
        <button
          v-for="count in [3, 6, 12] as const"
          :key="count"
          type="button"
          :aria-pressed="range === count"
          :class="{ selected: range === count }"
          @click="
            range = count;
            selectedMonth = initial;
          "
        >
          {{ count === 12 ? '1Y' : `${count}M` }}
        </button>
      </div>
    </Teleport>
    <RouterLink :to="{ path: '/explore', query: { month: selected.key } }" class="detail-back"
      ><ArrowLeft :size="15" /> {{ t('explore') }}</RouterLink
    >
    <div v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </div>
    <section class="comparison-total">
      <span>{{
        new Date(`${selected.key}-01T12:00:00`).toLocaleDateString(
          language === 'he' ? 'he-IL' : 'en',
          {
            month: 'long',
            year: 'numeric',
          },
        )
      }}</span>
      <strong
        ><AnimatedAmount
          :value="grossByMonth.get(selected.key) ?? 0"
          :animate="!scrubbing" /></strong
      ><small>{{ t('postedSpending') }}</small>
    </section>
    <div class="comparison-chart" :aria-label="t('monthlySpending')">
      <div class="comparison-axis" aria-hidden="true">
        <span v-for="tick in ticks" :key="tick">{{ formatCompactNumber(tick) }}</span>
      </div>
      <div class="comparison-plot">
        <div class="comparison-guides" aria-hidden="true">
          <span v-for="tick in ticks" :key="tick" />
        </div>
        <TransitionGroup
          tag="div"
          name="ledger-reflow"
          class="comparison-bars"
          data-scrub
          :style="{ gridTemplateColumns: `repeat(${range}, minmax(0, 1fr))` }"
          @pointerdown="beginScrub"
          @pointermove="scrub"
          @pointerup="endScrub"
          @pointercancel="endScrub"
        >
          <button
            v-for="month in months"
            :key="month.key"
            :data-month="month.key"
            type="button"
            :class="{ selected: month.key === selected.key }"
            :aria-label="`${month.key}: ${formatCurrency(month.total)}`"
            :aria-pressed="month.key === selected.key"
            @click="selectedMonth = month.key"
          >
            <span class="comparison-bar-track">
              <span
                class="comparison-bar"
                :style="{ height: `${(month.total / axisMaximum) * 100}%` }"
              >
                <span
                  v-for="item in month.spendingItems"
                  :key="item.category"
                  :style="{
                    height: `${(Math.abs(item.totalAmount) / Math.max(month.total, 1)) * 100}%`,
                    background: categoryMap.get(item.category ?? '')?.color ?? 'var(--accent)',
                  }"
                />
              </span>
            </span>
            <span class="comparison-month-label">{{
              new Date(`${month.key}-01T12:00:00`).toLocaleDateString(
                language === 'he' ? 'he-IL' : 'en',
                { month: 'short' },
              )
            }}</span>
          </button>
        </TransitionGroup>
      </div>
    </div>
    <div class="ledger-section-heading explore-subheading">
      <h2>{{ t('categoryBreakdown') }}</h2>
      <span>{{ selected.key }}</span>
    </div>
    <TransitionGroup tag="div" name="ledger-reflow" class="ledger-list">
      <RouterLink
        v-for="item in selected.items"
        :key="item.category"
        :to="categoryLink(item.category ?? 'uncategorized')"
        :style="{ viewTransitionName: categoryMotionName(item.category ?? 'uncategorized') }"
        class="explore-row"
      >
        <span
          class="category-dot"
          :style="{ background: categoryMap.get(item.category ?? '')?.color ?? 'var(--accent)' }"
        />
        <span class="explore-row-title">{{
          categoryMap.get(item.category ?? '')?.label ?? item.category
        }}</span>
        <small v-if="item.totalAmount > 0" class="is-positive">{{ t('netReceived') }}</small>
        <strong :class="item.totalAmount > 0 ? 'is-positive' : ''"
          >{{ item.totalAmount > 0 ? '+' : '' }}{{ formatCurrency(item.totalAmount) }}</strong
        ><ArrowRight :size="15" />
      </RouterLink>
      <p v-if="!loading && !selected.items.length" key="empty" class="ledger-empty">
        {{ t('noPostedSpending') }}
      </p>
    </TransitionGroup>
  </div>
</template>
