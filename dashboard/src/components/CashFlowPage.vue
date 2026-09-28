<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';
import { getCashflowSummary, type CashflowItem } from '@/api/client';
import { formatCurrency } from '@/lib/format';
import { isValidMonth } from '@/lib/month';
import { language, t } from '@/lib/language';
import CashflowSankey from './CashflowSankey.vue';

const route = useRoute();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const initial = isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7);
const range = ref<3 | 6 | 12>(6);
const selectedMonth = ref(initial);
const rows = ref<CashflowItem[]>([]);
const loading = ref(true);
const error = ref('');

function monthKey(back: number) {
  const [year, month] = initial.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 - back, 1)).toISOString().slice(0, 7);
}
function monthLabel(key: string) {
  return new Date(`${key}-01T12:00:00`).toLocaleDateString(
    language.value === 'he' ? 'he-IL' : 'en',
    {
      month: 'short',
      year: 'numeric',
    },
  );
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [year, month] = initial.split('-').map(Number) as [number, number];
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const data = await getCashflowSummary({
      startDate: `${monthKey(11)}-01`,
      endDate: initial === today.slice(0, 7) ? today : `${initial}-${lastDay}`,
    });
    rows.value = data.summary;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    loading.value = false;
  }
}
onMounted(load);
const byMonth = computed(() => new Map(rows.value.map((row) => [row.month, row])));
const months = computed(() =>
  Array.from({ length: 12 }, (_, index) => {
    const key = monthKey(11 - index);
    const row = byMonth.value.get(key);
    return { month: key, income: row?.income ?? 0, expense: row?.expense ?? 0 };
  }),
);
const series = computed(() => months.value.slice(-range.value));
const selected = computed(
  () =>
    months.value.find((row) => row.month === selectedMonth.value) ??
    months.value[months.value.length - 1]!,
);
const selectedIndex = computed(() =>
  months.value.findIndex((row) => row.month === selected.value.month),
);
const previous = computed(() => months.value[selectedIndex.value - 1]);
const net = computed(() => selected.value.income - selected.value.expense);
const previousNet = computed(() =>
  previous.value ? previous.value.income - previous.value.expense : null,
);
const delta = computed(() => (previousNet.value === null ? null : net.value - previousNet.value));
const max = computed(() =>
  Math.max(1, ...series.value.flatMap((row) => [row.income, row.expense])),
);
const totals = computed(() => {
  const income = series.value.reduce((sum, row) => sum + row.income, 0);
  const expense = series.value.reduce((sum, row) => sum + row.expense, 0);
  return {
    income,
    expense,
    net: income - expense,
    average: (income - expense) / series.value.length,
  };
});
function chooseRange(count: 3 | 6 | 12) {
  range.value = count;
  selectedMonth.value = initial;
}
</script>

<template>
  <div class="ledger-page cashflow-page">
    <Teleport to="#toolbar-actions">
      <div class="comparison-range" role="group" :aria-label="t('timeRange')">
        <button
          v-for="count in [3, 6, 12] as const"
          :key="count"
          type="button"
          :class="{ selected: range === count }"
          :aria-pressed="range === count"
          @click="chooseRange(count)"
        >
          {{ count === 12 ? '1Y' : `${count}M` }}
        </button>
      </div>
    </Teleport>
    <RouterLink :to="{ path: '/explore', query: { month: selectedMonth } }" class="detail-back"
      ><ArrowLeft :size="15" /> {{ t('explore') }}</RouterLink
    >
    <div v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </div>
    <section class="cashflow-trend" :aria-label="t('incomeAndSpendingByMonth')">
      <div class="cashflow-trend-summary">
        <span>{{ monthLabel(selected.month) }}</span>
        <strong :class="net >= 0 ? 'is-positive' : 'is-warning'"
          >{{ net < 0 ? '−' : '+' }}{{ formatCurrency(net) }}</strong
        >
        <small v-if="delta !== null"
          >{{ formatCurrency(delta) }} {{ delta >= 0 ? t('better') : t('worse') }}
          {{ t('thanPreviousMonth') }}</small
        >
        <small v-else>{{ t('postedIncomeMinusSpending') }}</small>
      </div>
      <p v-if="loading" class="cashflow-loading">{{ t('loadingCashFlow') }}</p>
      <div v-else class="cashflow-pairs">
        <button
          v-for="row in series"
          :key="row.month"
          type="button"
          class="cashflow-pair-group"
          :class="{ selected: selected.month === row.month }"
          :aria-pressed="selected.month === row.month"
          :aria-label="`${monthLabel(row.month)}: ${t('income')} ${formatCurrency(row.income)}, ${t('spending')} ${formatCurrency(row.expense)}`"
          @click="selectedMonth = row.month"
        >
          <span class="cashflow-pair">
            <span
              class="cashflow-income"
              :style="{ height: `${Math.max(3, (row.income / max) * 100)}%` }" /><span
              class="cashflow-expense"
              :style="{ height: `${Math.max(3, (row.expense / max) * 100)}%` }"
          /></span>
          <span class="cashflow-month-label">{{ monthLabel(row.month).split(' ')[0] }}</span>
        </button>
      </div>
      <div class="cashflow-legend">
        <span><i class="cashflow-income" /> {{ t('postedIncome') }}</span
        ><span><i class="cashflow-expense" /> {{ t('postedSpending') }}</span>
      </div>
      <div class="cashflow-selected">
        <div>
          <span>{{ t('income') }}</span
          ><strong>{{ formatCurrency(selected.income) }}</strong>
        </div>
        <div>
          <span>{{ t('spending') }}</span
          ><strong>{{ formatCurrency(selected.expense) }}</strong>
        </div>
      </div>
    </section>
    <section class="cashflow-range-summary">
      <h2>{{ range === 12 ? t('year') : `${range} ${t('months')}` }} {{ t('atAGlance') }}</h2>
      <div>
        <span>{{ t('netCashFlow') }}</span
        ><strong :class="totals.net >= 0 ? 'is-positive' : 'is-warning'"
          >{{ totals.net < 0 ? '−' : '+' }}{{ formatCurrency(totals.net) }}</strong
        >
      </div>
      <div>
        <span>{{ t('monthlyAverage') }}</span
        ><strong :class="totals.average >= 0 ? 'is-positive' : 'is-warning'"
          >{{ totals.average < 0 ? '−' : '+' }}{{ formatCurrency(totals.average) }}</strong
        >
      </div>
      <div>
        <span>{{ t('totalIncome') }}</span
        ><strong>{{ formatCurrency(totals.income) }}</strong>
      </div>
      <div>
        <span>{{ t('totalSpending') }}</span
        ><strong>{{ formatCurrency(totals.expense) }}</strong>
      </div>
    </section>
    <section class="cashflow-detail-section">
      <h2>{{ t('followFlow') }}</h2>
      <CashflowSankey :month="selectedMonth" />
    </section>
  </div>
</template>
