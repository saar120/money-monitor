<script setup lang="ts">
import { useMonthSwipe } from '@/composables/useMonthSwipe';
import { categoryMotionName } from '@/lib/cardMotion';
import AnimatedAmount from './AnimatedAmount.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowRight } from 'lucide-vue-next';
import {
  getCashflowSummary,
  getCategories,
  getSummary,
  type CashflowItem,
  type Category,
  type SummaryItem,
} from '../api/client';
import { formatCurrency } from '@/lib/format';
import { isValidMonth } from '@/lib/month';
import { language, t } from '@/lib/language';
import MonthControl from './MonthControl.vue';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const route = useRoute();
const month = ref(isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7));
const monthSwipe = useMonthSwipe(month);
const loading = ref(true);
const error = ref('');
const current = ref<SummaryItem[]>([]);
const previousFlow = ref<CashflowItem | null>(null);
const monthly = ref<SummaryItem[]>([]);
const categories = ref<Category[]>([]);
const cashflow = ref<CashflowItem | null>(null);
let requestId = 0;
function monthRange(key: string, throughDay?: number) {
  const [year, number] = key.split('-').map(Number) as [number, number];
  return {
    startDate: `${key}-01`,
    endDate: `${key}-${String(Math.min(throughDay ?? Infinity, new Date(Date.UTC(year, number, 0)).getUTCDate())).padStart(2, '0')}`,
  };
}
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  const [year, number] = month.value.split('-').map(Number) as [number, number];
  const previousMonth = new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
  const selectedRange = monthRange(
    month.value,
    month.value === today.slice(0, 7) ? Number(today.slice(8, 10)) : undefined,
  );
  const elapsedDays = Number(selectedRange.endDate.slice(-2));
  try {
    const [thisMonth, lastMonth, history, categoryData, flow] = await Promise.all([
      getSummary({ groupBy: 'spending-category', ...selectedRange }),
      getCashflowSummary(monthRange(previousMonth, elapsedDays)),
      getSummary({ groupBy: 'month', expensesOnly: true }),
      getCategories(),
      getCashflowSummary(selectedRange),
    ]);
    if (id !== requestId) return;
    current.value = thisMonth.summary;
    previousFlow.value = lastMonth.summary[0] ?? null;
    monthly.value = history.summary;
    categories.value = categoryData.categories;
    cashflow.value = flow.summary[0] ?? null;
  } catch (cause) {
    if (id === requestId) error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    if (id === requestId) loading.value = false;
  }
}
onMounted(load);
watch(month, load);
watch(
  () => route.query.month,
  (value) => {
    if (isValidMonth(value)) month.value = value;
  },
);
const total = computed(() => cashflow.value?.expense ?? 0);
const lastTotal = computed(() => previousFlow.value?.expense ?? 0);
const delta = computed(() => total.value - lastTotal.value);
const categoryMap = computed(
  () => new Map(categories.value.map((category) => [category.name, category])),
);
const sortedCategories = computed(() =>
  [...current.value]
    .filter((item) => item.totalAmount !== 0)
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount)),
);
const recentMonths = computed(() =>
  [...monthly.value].sort((a, b) => (b.month ?? '').localeCompare(a.month ?? '')).slice(0, 6),
);
const biggestMonth = computed(() =>
  Math.max(1, ...recentMonths.value.map((item) => Math.abs(item.totalAmount))),
);
const mix = computed(() =>
  sortedCategories.value
    .filter((item) => item.totalAmount < 0)
    .map((item) => ({
      name: categoryMap.value.get(item.category ?? '')?.label ?? item.category ?? t('categories'),
      color: categoryMap.value.get(item.category ?? '')?.color ?? 'var(--accent)',
      share: Math.abs(item.totalAmount) / Math.max(total.value, 1),
    })),
);
</script>

<template>
  <div
    class="ledger-page explore-page month-swipe-surface"
    v-bind="monthSwipe"
    :aria-busy="loading"
  >
    <Teleport to="#toolbar-actions"><MonthControl v-model="month" /></Teleport>
    <div v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </div>
    <section class="explore-summary">
      <div>
        <span>{{ t('totalSpending') }}</span
        ><strong><AnimatedAmount :value="total" /></strong>
        <small :class="delta > 0 ? 'is-warning' : 'is-positive'">{{
          delta === 0
            ? t('sameAsLastMonth')
            : `${formatCurrency(Math.abs(delta))} ${delta > 0 ? t('more') : t('less')} ${t('thanLastMonth')}`
        }}</small>
      </div>
      <div class="explore-mix" :aria-label="t('categories')">
        <span
          v-for="item in mix"
          :key="item.name"
          :title="`${item.name}: ${Math.round(item.share * 100)}%`"
          :style="{ flexGrow: Math.max(item.share * 100, 1), background: item.color }"
        />
      </div>
    </section>
    <nav class="explore-switcher" :aria-label="t('explore')">
      <RouterLink to="/explore" aria-current="page">{{ t('categories') }}</RouterLink>
      <RouterLink :to="{ path: '/explore/monthly-comparison', query: { month } }">{{
        t('monthlySpending')
      }}</RouterLink>
      <RouterLink :to="{ path: '/cash-flow', query: { month } }">{{ t('cashFlow') }}</RouterLink>
    </nav>
    <div class="explore-grid">
      <section class="explore-main">
        <div class="ledger-section-heading">
          <h2>{{ t('categories') }}</h2>
          <RouterLink to="/categories"
            >{{ t('manageCategories') }} <ArrowRight :size="15"
          /></RouterLink>
        </div>
        <div class="ledger-list">
          <RouterLink
            v-for="item in sortedCategories"
            :key="item.category"
            :to="{
              path: `/explore/category/${encodeURIComponent(item.category ?? 'uncategorized')}`,
              query: { month },
            }"
            class="explore-row"
            :style="{ viewTransitionName: categoryMotionName(item.category ?? 'uncategorized') }"
          >
            <span
              class="category-dot"
              :style="{
                background: categoryMap.get(item.category ?? '')?.color ?? 'var(--accent)',
              }"
            />
            <span class="explore-row-title">{{
              categoryMap.get(item.category ?? '')?.label ?? item.category
            }}</span>
            <small v-if="item.totalAmount > 0" class="is-positive">{{ t('netReceived') }}</small>
            <strong :class="item.totalAmount > 0 ? 'is-positive' : ''"
              >{{ item.totalAmount > 0 ? '+' : '' }}{{ formatCurrency(item.totalAmount) }}</strong
            ><ArrowRight :size="15" />
          </RouterLink>
          <p v-if="!loading && !sortedCategories.length" class="ledger-empty">
            {{ t('noSpendingInMonth') }}
          </p>
        </div>
        <div class="ledger-section-heading explore-subheading">
          <h2>{{ t('monthlySpending') }}</h2>
          <RouterLink :to="{ path: '/explore/monthly-comparison', query: { month } }"
            >{{ t('compareMonths') }} <ArrowRight :size="15"
          /></RouterLink>
        </div>
        <div class="ledger-list">
          <RouterLink
            v-for="item in recentMonths"
            :key="item.month"
            :to="{ path: '/explore/monthly-comparison', query: { month: item.month } }"
            class="monthly-row"
          >
            <span>{{
              new Date(`${item.month}-01T12:00:00`).toLocaleDateString(
                language === 'he' ? 'he-IL' : 'en',
                {
                  month: 'long',
                  year: 'numeric',
                },
              )
            }}</span>
            <span class="monthly-track"
              ><span :style="{ width: `${(Math.abs(item.totalAmount) / biggestMonth) * 100}%` }"
            /></span>
            <strong>{{ formatCurrency(Math.abs(item.totalAmount)) }}</strong
            ><ArrowRight :size="15" />
          </RouterLink>
          <p v-if="!loading && !recentMonths.length" class="ledger-empty">
            {{ t('monthlyHistoryEmpty') }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
