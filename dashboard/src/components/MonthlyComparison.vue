<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, ArrowRight } from 'lucide-vue-next';
import { getCategories, getSummary, type Category, type SummaryItem } from '../api/client';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
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
const maximum = computed(() => Math.max(1, ...months.value.map((item) => item.total)));
const categoryMap = computed(() => new Map(categories.value.map((item) => [item.name, item])));
const categoryLink = (name: string) => ({
  path: `/explore/category/${encodeURIComponent(name)}`,
  query: { month: selected.value.key },
});
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
      <strong>{{ loading ? '—' : formatCurrency(grossByMonth.get(selected.key) ?? 0) }}</strong
      ><small>{{ t('postedSpending') }}</small>
    </section>
    <div
      class="comparison-chart"
      :aria-label="t('monthlySpending')"
      :style="{ gridTemplateColumns: `repeat(${range}, minmax(0, 1fr))` }"
    >
      <button
        v-for="month in months"
        :key="month.key"
        type="button"
        :class="{ selected: month.key === selected.key }"
        :aria-label="`${month.key}: ${formatCurrency(month.total)}`"
        :aria-pressed="month.key === selected.key"
        @click="selectedMonth = month.key"
      >
        <span class="comparison-bar-value" dir="ltr">{{ formatCompactCurrency(month.total) }}</span>
        <span
          class="comparison-bar"
          :style="{ height: `${Math.max(2, (month.total / maximum) * 75)}%` }"
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
        <span>{{
          new Date(`${month.key}-01T12:00:00`).toLocaleDateString(
            language === 'he' ? 'he-IL' : 'en',
            { month: 'short' },
          )
        }}</span>
      </button>
    </div>
    <div class="ledger-section-heading explore-subheading">
      <h2>{{ t('categoryBreakdown') }}</h2>
      <span>{{ selected.key }}</span>
    </div>
    <div class="ledger-list">
      <RouterLink
        v-for="item in selected.items"
        :key="item.category"
        :to="categoryLink(item.category ?? 'uncategorized')"
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
      <p v-if="!loading && !selected.items.length" class="ledger-empty">
        {{ t('noPostedSpending') }}
      </p>
    </div>
  </div>
</template>
