<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, ArrowRight } from 'lucide-vue-next';
import { getCategories, getTransactions, type Category, type Transaction } from '../api/client';
import { formatCurrency } from '@/lib/format';
import { normalizeMerchant } from '@/lib/merchant';
import { isValidMonth } from '@/lib/month';
import { t } from '@/lib/language';

const route = useRoute();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const month = ref(isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7));
const name = computed(() => String(route.params.name ?? ''));
const categoryName = computed(() =>
  typeof route.query.category === 'string' ? route.query.category : '',
);
const categories = ref<Category[]>([]);
const rows = ref<Transaction[]>([]);
function setMonth(event: Event) {
  const input = event.target as globalThis.HTMLInputElement;
  if (isValidMonth(input.value)) month.value = input.value;
  else input.value = month.value;
}
const loading = ref(true);
const error = ref('');
let requestId = 0;

function previousMonth(key: string) {
  const [year, number] = key.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}
function endOfMonth(key: string, throughDay?: number) {
  const [year, number] = key.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const elapsed = key === today.slice(0, 7) ? Number(today.slice(8, 10)) : lastDay;
  return `${key}-${String(Math.min(lastDay, throughDay ?? elapsed)).padStart(2, '0')}`;
}
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const categoryData = await getCategories();
    const matching: Transaction[] = [];
    let offset = 0;
    while (true) {
      const page = await getTransactions({
        startDate: `${previousMonth(month.value)}-01`,
        endDate: endOfMonth(month.value),
        ignored: false,
        limit: 500,
        offset,
      });
      if (id !== requestId) return;
      matching.push(
        ...page.transactions.filter(
          (item) =>
            normalizeMerchant(item.description) === name.value &&
            item.category !== 'income' &&
            (item.chargedAmount < 0 || item.category !== null),
        ),
      );
      if (!page.pagination.hasMore) break;
      offset += page.transactions.length;
    }
    if (id !== requestId) return;
    categories.value = categoryData.categories;
    rows.value = matching;
  } catch (cause) {
    if (id === requestId)
      error.value = cause instanceof Error ? cause.message : 'Merchant could not load.';
  } finally {
    if (id === requestId) loading.value = false;
  }
}
onMounted(load);
watch([month, name], load);
const currentRows = computed(() =>
  rows.value.filter((item) => item.reportingDate.startsWith(month.value)),
);
const previousRows = computed(() =>
  rows.value.filter(
    (item) =>
      item.reportingDate.startsWith(previousMonth(month.value)) &&
      item.reportingDate <=
        endOfMonth(previousMonth(month.value), Number(endOfMonth(month.value).slice(-2))),
  ),
);
const total = computed(() => -currentRows.value.reduce((sum, item) => sum + item.chargedAmount, 0));
const previous = computed(
  () => -previousRows.value.reduce((sum, item) => sum + item.chargedAmount, 0),
);
const delta = computed(() => total.value - previous.value);
const categoryLabel = computed(() => {
  const key = currentRows.value[0]?.category ?? categoryName.value;
  return categories.value.find((item) => item.name === key)?.label ?? key;
});
const backLink = computed(() =>
  categoryName.value
    ? {
        path: `/explore/category/${encodeURIComponent(categoryName.value)}`,
        query: { month: month.value },
      }
    : { path: '/explore', query: { month: month.value } },
);
const activityLink = (transaction: Transaction) => ({
  path: '/transactions',
  query: { month: month.value, transactionId: transaction.id },
});
</script>

<template>
  <div class="ledger-page merchant-detail-page">
    <RouterLink :to="backLink" class="detail-back"
      ><ArrowLeft :size="15" /> {{ categoryLabel || t('explore') }}</RouterLink
    >
    <div class="home-head">
      <div>
        <p class="home-context">{{ t('merchant') }}</p>
        <h1 dir="auto">{{ name }}</h1>
      </div>
      <label class="month-control"
        >{{ t('month') }}
        <input :value="month" type="month" :aria-label="t('month')" @change="setMonth"
      /></label>
    </div>
    <div v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </div>
    <section class="merchant-hero">
      <span>{{ t('netSpending') }}</span>
      <strong>{{ loading ? '—' : `${total < 0 ? '−' : ''}${formatCurrency(total)}` }}</strong>
      <small :class="delta > 0 ? 'is-warning' : 'is-positive'">{{
        delta === 0
          ? t('sameAsLastMonth')
          : `${formatCurrency(Math.abs(delta))} ${delta > 0 ? t('more') : t('less')} ${t('thanLastMonth')}`
      }}</small>
      <p>
        {{ categoryLabel }} · {{ currentRows.length }}
        {{ t('transactions') }}
      </p>
    </section>
    <div class="ledger-section-heading explore-subheading">
      <h2>{{ t('transactions') }}</h2>
      <span>{{ month }}</span>
    </div>
    <div class="ledger-list merchant-transactions">
      <RouterLink
        v-for="item in currentRows"
        :key="item.id"
        :to="activityLink(item)"
        class="explore-row"
      >
        <span class="explore-row-title"
          ><bdi dir="auto">{{ item.description }}</bdi></span
        >
        <small>{{ item.reportingDate }}</small>
        <strong :class="item.chargedAmount > 0 ? 'is-positive' : ''"
          >{{ item.chargedAmount > 0 ? '+' : '' }}{{ formatCurrency(item.chargedAmount) }}</strong
        >
        <ArrowRight :size="15" />
      </RouterLink>
      <p v-if="!loading && !currentRows.length" class="ledger-empty">
        {{ t('noMerchantTransactions') }}
      </p>
    </div>
  </div>
</template>
