<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, ArrowRight } from 'lucide-vue-next';
import {
  getCategories,
  getSummary,
  getTransactions,
  type Category,
  type SummaryItem,
  type Transaction,
} from '../api/client';
import { formatCurrency } from '@/lib/format';
import { normalizeMerchant } from '@/lib/merchant';
import { isValidMonth } from '@/lib/month';
import { language, t } from '@/lib/language';

const route = useRoute();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const month = ref(isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7));
const range = ref<3 | 6 | 12>(6);
const categoryName = computed(() => String(route.params.name ?? ''));
const category = ref<Category | null>(null);
const history = ref<SummaryItem[]>([]);
const previousSpent = ref(0);
const transactions = ref<Transaction[]>([]);
function setMonth(event: Event) {
  const input = event.target as globalThis.HTMLInputElement;
  if (isValidMonth(input.value)) month.value = input.value;
  else input.value = month.value;
}
const loading = ref(true);
const error = ref('');
let requestId = 0;

function monthRange(key: string, throughDay?: number) {
  const [year, number] = key.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const elapsed = key === today.slice(0, 7) ? Number(today.slice(8, 10)) : lastDay;
  return {
    startDate: `${key}-01`,
    endDate: `${key}-${String(Math.min(lastDay, throughDay ?? elapsed)).padStart(2, '0')}`,
  };
}
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const selectedRange = monthRange(month.value);
    const elapsedDay = Number(selectedRange.endDate.slice(-2));
    const [year, number] = month.value.split('-').map(Number) as [number, number];
    const priorKey = new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
    const [categories, summary, prior] = await Promise.all([
      getCategories(),
      getSummary({
        groupBy: 'spending-category-month',
        category: categoryName.value,
        endDate: selectedRange.endDate,
      }),
      getSummary({
        groupBy: 'spending-category',
        category: categoryName.value,
        ...monthRange(priorKey, elapsedDay),
      }),
    ]);
    const rows: Transaction[] = [];
    let offset = 0;
    while (true) {
      const page = await getTransactions({
        category: categoryName.value,
        ...selectedRange,
        ignored: false,
        limit: 500,
        offset,
      });
      if (id !== requestId) return;
      rows.push(...page.transactions);
      if (!page.pagination.hasMore) break;
      offset += page.transactions.length;
    }
    if (id !== requestId) return;
    category.value = categories.categories.find((item) => item.name === categoryName.value) ?? null;
    history.value = summary.summary;
    previousSpent.value = -prior.summary.reduce((sum, item) => sum + item.totalAmount, 0);
    transactions.value = rows.filter((item) => item.chargedAmount < 0 || item.category !== null);
  } catch (cause) {
    if (id === requestId)
      error.value = cause instanceof Error ? cause.message : 'Category could not load.';
  } finally {
    if (id === requestId) loading.value = false;
  }
}
onMounted(load);
watch([month, categoryName], load);
const title = computed(() => category.value?.label ?? categoryName.value);
const current = computed(
  () => -(history.value.find((item) => item.month === month.value)?.totalAmount ?? 0),
);
const delta = computed(() => current.value - previousSpent.value);
const months = computed(() => {
  const [year, number] = month.value.split('-').map(Number) as [number, number];
  return Array.from({ length: range.value }, (_, index) => {
    const key = new Date(Date.UTC(year, number - range.value + 1 + index, 1))
      .toISOString()
      .slice(0, 7);
    return {
      key,
      total: -(history.value.find((item) => item.month === key)?.totalAmount ?? 0),
    };
  });
});
const maximum = computed(() => Math.max(1, ...months.value.map((item) => item.total)));
const merchants = computed(() => {
  const grouped = new Map<string, { name: string; total: number; count: number }>();
  for (const transaction of transactions.value) {
    const name = normalizeMerchant(transaction.description);
    const item = grouped.get(name) ?? { name, total: 0, count: 0 };
    item.total -= transaction.chargedAmount;
    item.count += 1;
    grouped.set(name, item);
  }
  return [...grouped.values()].sort((a, b) => b.total - a.total).slice(0, 8);
});
const activityLink = computed(() => ({
  path: '/transactions',
  query: { month: month.value, category: categoryName.value },
}));
const merchantLink = (name: string) => ({
  path: `/explore/merchant/${encodeURIComponent(name)}`,
  query: { month: month.value, category: categoryName.value },
});
</script>

<template>
  <div class="ledger-page category-detail-page">
    <RouterLink :to="{ path: '/explore', query: { month } }" class="detail-back"
      ><ArrowLeft :size="15" /> {{ t('explore') }}</RouterLink
    >
    <div class="home-head">
      <div>
        <p class="home-context">{{ t('categorySpending') }}</p>
        <h1>{{ title }}</h1>
      </div>
      <label class="month-control"
        >{{ t('month') }}
        <input :value="month" type="month" :aria-label="t('month')" @change="setMonth"
      /></label>
    </div>
    <div v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </div>
    <section class="category-detail-hero">
      <span
        class="category-detail-mark"
        :style="{ background: category?.color ?? 'var(--accent)' }"
      />
      <div>
        <span>{{ t('netCategorySpending') }}</span
        ><strong>{{
          loading ? '—' : `${current < 0 ? '−' : ''}${formatCurrency(current)}`
        }}</strong>
        <small :class="delta > 0 ? 'is-warning' : 'is-positive'">{{
          delta === 0
            ? t('sameAsLastMonth')
            : `${formatCurrency(Math.abs(delta))} ${delta > 0 ? t('more') : t('less')} ${t('thanLastMonth')}`
        }}</small>
      </div>
      <RouterLink :to="activityLink"
        >{{ t('viewTransactions') }} <ArrowRight :size="15"
      /></RouterLink>
    </section>
    <div class="explore-grid">
      <section class="explore-main">
        <div class="ledger-section-heading">
          <h2>{{ range === 12 ? t('year') : `${range} ${t('months')}` }} {{ t('history') }}</h2>
          <div class="comparison-range" role="group" :aria-label="t('history')">
            <button
              v-for="count in [3, 6, 12] as const"
              :key="count"
              type="button"
              :class="{ selected: range === count }"
              :aria-pressed="range === count"
              @click="range = count"
            >
              {{ count === 12 ? '1Y' : `${count}M` }}
            </button>
          </div>
        </div>
        <div
          class="category-history"
          :aria-label="`${t('categorySpending')} ${range} ${t('months')}`"
        >
          <button
            v-for="item in months"
            :key="item.key"
            type="button"
            :class="{ selected: item.key === month }"
            @click="month = item.key"
          >
            <span class="category-history-value"
              >{{ item.total < 0 ? '−' : '' }}{{ formatCurrency(item.total) }}</span
            >
            <span class="category-history-track"
              ><span
                :style="{
                  height: `${(Math.max(0, item.total) / maximum) * 100}%`,
                  background: category?.color ?? 'var(--accent)',
                }"
            /></span>
            <span>{{
              new Date(`${item.key}-01T12:00:00`).toLocaleDateString(
                language === 'he' ? 'he-IL' : 'en',
                { month: 'short' },
              )
            }}</span>
          </button>
        </div>
        <div class="ledger-section-heading explore-subheading">
          <h2>{{ t('recentTransactions') }}</h2>
          <RouterLink :to="activityLink"
            >{{ t('all') }} {{ transactions.length }} <ArrowRight :size="15"
          /></RouterLink>
        </div>
        <div class="ledger-list">
          <RouterLink
            v-for="item in transactions.slice(0, 8)"
            :key="item.id"
            :to="{
              path: '/transactions',
              query: { month, category: categoryName, transactionId: item.id },
            }"
            class="explore-row"
          >
            <span class="explore-row-title" dir="auto">{{ item.description }}</span>
            <strong :class="item.chargedAmount > 0 ? 'is-positive' : ''"
              >{{ item.chargedAmount > 0 ? '+' : ''
              }}{{ formatCurrency(item.chargedAmount) }}</strong
            >
            <ArrowRight :size="15" />
          </RouterLink>
          <p v-if="!loading && !transactions.length" class="ledger-empty">
            {{ t('noCategorySpending') }}
          </p>
        </div>
      </section>
      <aside class="explore-rail">
        <h2>{{ t('whereItWent') }}</h2>
        <div class="ledger-list">
          <RouterLink
            v-for="item in merchants"
            :key="item.name"
            :to="merchantLink(item.name)"
            class="category-merchant-row"
          >
            <span dir="auto">{{ item.name }}</span
            ><small>{{ item.count }} {{ t('charges') }}</small>
            <strong>{{ item.total < 0 ? '−' : '' }}{{ formatCurrency(item.total) }}</strong>
          </RouterLink>
          <p v-if="!loading && !merchants.length" class="ledger-empty">
            {{ t('merchantsAppear') }}
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>
