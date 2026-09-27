<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { getTransactions, type Transaction } from '@/api/client';
import { formatAmount } from '@/lib/format';
import { t } from '@/lib/language';

const props = defineProps<{ categories: string[]; startDate: string; endDate: string }>();
const rows = ref<Transaction[]>([]);
const loading = ref(true);
const error = ref('');
const visibleCount = ref(20);
let requestId = 0;

async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  visibleCount.value = 20;
  try {
    const groups = await Promise.all(
      props.categories.map(async (category) => {
        const found: Transaction[] = [];
        let offset = 0;
        while (true) {
          const page = await getTransactions({
            category,
            startDate: props.startDate,
            endDate: props.endDate,
            ignored: false,
            maxAmount: -0.01,
            limit: 500,
            offset,
          });
          if (id !== requestId) return [];
          found.push(...page.transactions);
          if (!page.pagination.hasMore) break;
          offset += page.transactions.length;
        }
        return found;
      }),
    );
    if (id === requestId)
      rows.value = groups.flat().sort((a, b) => b.reportingDate.localeCompare(a.reportingDate));
  } catch (cause) {
    if (id === requestId)
      error.value = cause instanceof Error ? cause.message : 'Transactions could not load.';
  } finally {
    if (id === requestId) loading.value = false;
  }
}
watch(() => [props.startDate, props.endDate, ...props.categories], load, { immediate: true });
onUnmounted(() => requestId++);
</script>

<template>
  <div class="budget-transactions">
    <p class="budget-transactions-title">{{ t('transactionsCounted') }}</p>
    <p v-if="loading" class="ledger-empty">{{ t('loadingTransactions') }}</p>
    <p v-else-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="load">{{ t('retry') }}</button>
    </p>
    <p v-else-if="!rows.length" class="ledger-empty">{{ t('noMatchingTransactions') }}</p>
    <RouterLink
      v-for="transaction in rows.slice(0, visibleCount)"
      :key="transaction.id"
      :to="{
        path: '/transactions',
        query: { month: transaction.reportingDate.slice(0, 7), transactionId: transaction.id },
      }"
      class="budget-transaction-row"
    >
      <span
        ><strong dir="auto">{{ transaction.description }}</strong
        ><small>{{ transaction.reportingDate }}</small></span
      >
      <b>{{ formatAmount(transaction.chargedAmount, transaction.chargedCurrency) }}</b>
    </RouterLink>
    <button
      v-if="rows.length > visibleCount"
      type="button"
      class="budget-more"
      @click="visibleCount += 20"
    >
      {{ t('showMore') }}
    </button>
  </div>
</template>
