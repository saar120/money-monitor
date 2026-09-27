<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import { AlertCircle, ArrowRight, CheckCircle2, Receipt, RefreshCw } from 'lucide-vue-next';
import {
  getAccounts,
  getActivitySince,
  getBudgetProgress,
  getCashflowSummary,
  getCategories,
  getMembers,
  getNeedsReviewCount,
  getNetWorth,
  getSummary,
  type Account,
  type BudgetProgress,
  type CashflowItem,
  type Category,
  type Member,
  type OwnerType,
  type SummaryItem,
} from '../api/client';
import { formatCurrency } from '@/lib/format';
import { useSseConnection } from '@/composables/useSseConnection';
import { useChartTheme } from '@/composables/useChartTheme';
import { isValidMonth } from '@/lib/month';
import { t } from '@/lib/language';
import MonthControl from './MonthControl.vue';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);
const route = useRoute();
const { textPrimary, textSecondary, bgPrimary, separator } = useChartTheme();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const selectedMonth = ref(isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7));
const selectedOwner = ref('all');
const loading = ref(true);
const error = ref('');
const categories = ref<Category[]>([]);
const accounts = ref<Account[]>([]);
const members = ref<Member[]>([]);
const categorySpending = ref<SummaryItem[]>([]);
const previousSpending = ref<SummaryItem[]>([]);
const dailySpending = ref<SummaryItem[]>([]);
const cashflow = ref<CashflowItem | null>(null);
const budget = ref<BudgetProgress | null>(null);
const reviewCount = ref(0);
const sinceLastVisit = ref<{ transactions: number; spent: number } | null>(null);
const visitStartedAt = new Date().toISOString();
const savedVisit = localStorage.getItem('money-monitor:last-home-visit');
const lastVisit = savedVisit && Number.isFinite(Date.parse(savedVisit)) ? savedVisit : null;
const netWorth = ref<number | null>(null);
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = ref(motionPreference.matches);
const syncMotion = () => {
  reduceMotion.value = motionPreference.matches;
};
let requestId = 0;

function monthRange(month: string, throughDay?: number) {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const end = Math.min(throughDay ?? Infinity, new Date(Date.UTC(year, number, 0)).getUTCDate());
  return { startDate: `${month}-01`, endDate: `${month}-${String(end).padStart(2, '0')}` };
}
const elapsedDays = computed(() =>
  selectedMonth.value === today.slice(0, 7)
    ? Number(today.slice(8, 10))
    : Number(monthRange(selectedMonth.value).endDate.slice(-2)),
);
const range = computed(() => monthRange(selectedMonth.value, elapsedDays.value));
const previousRange = computed(() => {
  const [year, month] = selectedMonth.value.split('-').map(Number) as [number, number];
  return monthRange(
    new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7),
    elapsedDays.value,
  );
});
const ownerFilter = computed(() => ({
  ownerType: selectedOwner.value.startsWith('member:')
    ? ('member' as OwnerType)
    : selectedOwner.value === 'all'
      ? undefined
      : (selectedOwner.value as OwnerType),
  ownerMemberId: selectedOwner.value.startsWith('member:')
    ? Number(selectedOwner.value.slice(7))
    : undefined,
}));
const value = <T,>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

async function refresh() {
  const currentRequest = ++requestId;
  loading.value = true;
  error.value = '';
  const results = await Promise.allSettled([
    getSummary({ groupBy: 'spending-category', ...range.value, ...ownerFilter.value }),
    getSummary({
      groupBy: 'day',
      ...previousRange.value,
      expensesOnly: true,
      ...ownerFilter.value,
    }),
    getSummary({ groupBy: 'day', ...range.value, expensesOnly: true, ...ownerFilter.value }),
    getCashflowSummary({ ...range.value, ...ownerFilter.value }),
    getCategories(),
    getAccounts(),
    getMembers(),
    getBudgetProgress(true, `${selectedMonth.value}-01`),
    getNeedsReviewCount(),
    getNetWorth(),
  ] as const);
  if (currentRequest !== requestId) return;
  categorySpending.value = value(results[0])?.summary ?? [];
  previousSpending.value = value(results[1])?.summary ?? [];
  dailySpending.value = value(results[2])?.summary ?? [];
  cashflow.value = value(results[3])?.summary[0] ?? null;
  categories.value = value(results[4])?.categories ?? [];
  accounts.value = value(results[5])?.accounts ?? [];
  members.value = value(results[6])?.members ?? [];
  budget.value =
    value(results[7])?.progress.find((item) => item.budget.period === 'monthly') ?? null;
  reviewCount.value = value(results[8])?.count ?? 0;
  netWorth.value = value(results[9])?.total ?? null;
  if (results.slice(0, 4).some((result) => result.status === 'rejected')) {
    error.value = 'Some financial data could not load. Try refreshing.';
  }
  loading.value = false;
}
const { connect } = useSseConnection({
  'account-scrape-done': refresh,
  'session-completed': refresh,
});
watch([selectedMonth, selectedOwner], refresh);
onMounted(() => {
  motionPreference.addEventListener('change', syncMotion);
  refresh();
  connect();
  if (lastVisit) {
    void getActivitySince(lastVisit)
      .then((result) => {
        sinceLastVisit.value = result;
        localStorage.setItem('money-monitor:last-home-visit', visitStartedAt);
      })
      .catch(() => undefined);
  } else {
    localStorage.setItem('money-monitor:last-home-visit', visitStartedAt);
  }
});
onUnmounted(() => motionPreference.removeEventListener('change', syncMotion));

const totalSpent = computed(() =>
  Math.abs(dailySpending.value.reduce((sum, item) => sum + item.totalAmount, 0)),
);
const previousSpent = computed(() =>
  Math.abs(previousSpending.value.reduce((sum, item) => sum + item.totalAmount, 0)),
);
const spendingDelta = computed(() => totalSpent.value - previousSpent.value);
const income = computed(() => cashflow.value?.income ?? 0);
const netCashflow = computed(() => income.value - (cashflow.value?.expense ?? 0));
const categoryMap = computed(() => new Map(categories.value.map((item) => [item.name, item])));
const topCategories = computed(() =>
  [...categorySpending.value]
    .filter((item) => item.totalAmount < 0)
    .sort((a, b) => a.totalAmount - b.totalAmount)
    .slice(0, 5),
);
const staleAccounts = computed(() =>
  accounts.value.filter((account) => {
    if (!account.isActive || !account.stalenessDays) return false;
    if (!account.lastScrapedAt) return true;
    return Date.now() - Date.parse(account.lastScrapedAt) > account.stalenessDays * 86_400_000;
  }),
);
const budgetNeedsAttention = computed(
  () => budget.value && (budget.value.isAlertTriggered || budget.value.isOverBudget),
);
const chartOption = computed(() => {
  const end = Number(range.value.endDate.slice(-2));
  const daily = new Map(dailySpending.value.map((item) => [item.day, Math.abs(item.totalAmount)]));
  let cumulative = 0;
  const days = Array.from({ length: end }, (_, index) => {
    cumulative += daily.get(`${selectedMonth.value}-${String(index + 1).padStart(2, '0')}`) ?? 0;
    return cumulative;
  });
  return {
    animation: !reduceMotion.value,
    grid: { left: 8, right: 14, top: 18, bottom: 24, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      textStyle: { color: textPrimary.value },
      formatter: (items: Array<{ axisValue: string; value: number }>) =>
        `${selectedMonth.value}-${items[0]?.axisValue}<br/><b>${formatCurrency(items[0]?.value ?? 0)}</b>`,
    },
    xAxis: {
      type: 'category' as const,
      boundaryGap: false,
      data: Array.from({ length: end }, (_, index) => String(index + 1).padStart(2, '0')),
      axisLabel: { color: textSecondary.value, interval: 6 },
      axisLine: { lineStyle: { color: separator.value } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: {
        color: textSecondary.value,
        formatter: (amount: number) => `${Math.round(amount / 1000)}k`,
      },
      splitLine: { lineStyle: { color: separator.value, type: 'dashed' as const } },
    },
    series: [
      {
        type: 'line' as const,
        data: days,
        smooth: 0.25,
        showSymbol: false,
        lineStyle: { color: '#0B5DDD', width: 3 },
        areaStyle: { color: 'rgba(11, 93, 221, 0.11)' },
      },
    ],
  };
});
function activityLink(category?: string) {
  return {
    path: '/transactions',
    query: { month: selectedMonth.value, ...(category ? { category } : {}) },
  };
}
function categoryLink(category: string) {
  return {
    path: `/explore/category/${encodeURIComponent(category)}`,
    query: { month: selectedMonth.value },
  };
}
</script>

<template>
  <div class="ledger-page home-page">
    <Teleport to="#toolbar-actions">
      <div class="toolbar-controls">
        <MonthControl v-model="selectedMonth" />
        <select v-model="selectedOwner" :aria-label="t('everyone')" class="ledger-select">
          <option value="all">{{ t('everyone') }}</option>
          <option value="shared">{{ t('together') }}</option>
          <option
            v-for="member in members.filter((item) => item.isActive)"
            :key="member.id"
            :value="`member:${member.id}`"
          >
            {{ member.name }}
          </option>
          <option value="unassigned">{{ t('unassigned') }}</option>
        </select>
        <button
          class="toolbar-icon-button"
          :aria-label="t('refresh')"
          :title="t('refresh')"
          @click="refresh"
        >
          <RefreshCw :size="16" />
        </button>
      </div>
    </Teleport>
    <div v-if="error" class="ledger-notice" role="alert">
      {{ error }} <button @click="refresh">{{ t('retry') }}</button>
    </div>
    <div class="home-grid">
      <section class="home-main">
        <div class="home-hero">
          <div class="home-hero-top">
            <span>{{ t('netCashFlow') }}</span
            ><RouterLink :to="activityLink()"
              >{{ t('viewActivity') }} <ArrowRight :size="15"
            /></RouterLink>
          </div>
          <p class="home-total" aria-live="polite">
            {{ loading ? '—' : `${netCashflow < 0 ? '−' : ''}${formatCurrency(netCashflow)}` }}
          </p>
          <h2 class="home-chart-title">{{ t('totalSpending') }}</h2>
          <div class="home-chart" :aria-label="t('totalSpending')">
            <div v-if="!loading && !dailySpending.length" class="home-chart-empty">
              <Receipt :size="28" />
              <span>{{ t('noPostedSpendingYet') }}</span>
            </div>
            <VChart v-else :option="chartOption" autoresize class="h-full w-full" />
          </div>
          <p class="home-comparison" :class="spendingDelta > 0 ? 'is-warning' : 'is-positive'">
            {{
              spendingDelta === 0
                ? t('sameAsLastMonth')
                : `${formatCurrency(Math.abs(spendingDelta))} ${spendingDelta > 0 ? t('more') : t('less')} ${t('thanLastMonth')}`
            }}
          </p>
          <p v-if="loading || dailySpending.length" class="home-chart-hint">
            {{ t('dailyChartHint') }}
          </p>
        </div>
        <div class="home-stats">
          <div>
            <span>{{ t('postedIncome') }}</span
            ><strong>{{ loading ? '—' : formatCurrency(income) }}</strong>
          </div>
          <div>
            <span>{{ t('totalSpending') }}</span
            ><strong>{{ loading ? '—' : formatCurrency(totalSpent) }}</strong>
          </div>
        </div>
        <section class="home-section">
          <div class="ledger-section-heading">
            <h2>{{ t('whereItWent') }}</h2>
            <RouterLink :to="{ path: '/explore', query: { month: selectedMonth } }"
              >{{ t('explore') }} <ArrowRight :size="15"
            /></RouterLink>
          </div>
          <div class="ledger-list">
            <RouterLink
              v-for="item in topCategories"
              :key="item.category"
              :to="categoryLink(item.category ?? 'uncategorized')"
              class="category-ledger-row"
            >
              <span
                class="category-dot"
                :style="{ background: categoryMap.get(item.category ?? '')?.color ?? '#B8C2CC' }"
              />
              <span class="category-row-content"
                ><span>{{ categoryMap.get(item.category ?? '')?.label ?? item.category }}</span
                ><span class="category-track"
                  ><span
                    :style="{
                      width: `${Math.min(100, (Math.abs(item.totalAmount) / Math.max(totalSpent, 1)) * 100)}%`,
                      background: categoryMap.get(item.category ?? '')?.color ?? 'var(--accent)',
                    }" /></span
              ></span>
              <strong>{{ formatCurrency(Math.abs(item.totalAmount)) }}</strong
              ><ArrowRight :size="15" class="row-chevron" />
            </RouterLink>
            <p v-if="!loading && !topCategories.length" class="ledger-empty">
              {{ t('noSpendingThisMonth') }}
            </p>
          </div>
        </section>
      </section>
      <aside class="home-rail">
        <section class="rail-section">
          <h2>{{ t('needsAttention') }}</h2>
          <div class="ledger-list attention-list">
            <RouterLink v-if="sinceLastVisit?.transactions" to="/transactions" class="attention-row"
              ><RefreshCw :size="18" /><span
                ><strong>{{ t('sinceLastVisit') }}</strong
                ><small
                  >{{ sinceLastVisit.transactions }} {{ t('newTransactions') }} ·
                  {{ formatCurrency(sinceLastVisit.spent) }} {{ t('spent') }}</small
                ></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <RouterLink v-if="reviewCount" to="/insights" class="attention-row"
              ><AlertCircle :size="18" /><span
                ><strong>{{ reviewCount }} {{ t('toReview') }}</strong
                ><small>{{ t('cleanFinancialInbox') }}</small></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <RouterLink v-if="budgetNeedsAttention" to="/budgets" class="attention-row"
              ><AlertCircle :size="18" /><span
                ><strong>{{ t('budgetNeedsAttention') }}</strong
                ><small>{{ budget?.budget.name }}</small></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <RouterLink v-if="staleAccounts.length" to="/accounts" class="attention-row"
              ><AlertCircle :size="18" /><span
                ><strong>{{ staleAccounts.length }} {{ t('accountsNeedAttention') }}</strong
                ><small>{{ t('checkLatestSync') }}</small></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <div
              v-if="
                !loading &&
                !sinceLastVisit?.transactions &&
                !reviewCount &&
                !budgetNeedsAttention &&
                !staleAccounts.length
              "
              class="attention-row all-clear"
            >
              <CheckCircle2 :size="18" /><span
                ><strong>{{ t('everythingCurrent') }}</strong
                ><small>{{ t('noActionNeeded') }}</small></span
              >
            </div>
          </div>
        </section>
        <section class="rail-section">
          <div class="ledger-section-heading">
            <h2>{{ t('budgetPace') }}</h2>
            <RouterLink :to="{ path: '/budgets', query: { month: selectedMonth } }"
              >{{ t('budgets') }} <ArrowRight :size="15"
            /></RouterLink>
          </div>
          <div v-if="budget" class="budget-readout">
            <strong>{{ Math.round(budget.percentage) }}%</strong
            ><span
              >{{ t('ofPlanned') }} {{ formatCurrency(budget.budget.amount) }}
              {{ t('planned') }}</span
            >
            <div class="budget-track">
              <span :style="{ width: `${Math.min(100, budget.percentage)}%` }" />
            </div>
            <p>{{ formatCurrency(Math.max(0, budget.remaining)) }} {{ t('remaining') }}</p>
          </div>
          <RouterLink
            v-else
            :to="{ path: '/budgets', query: { month: selectedMonth } }"
            class="rail-empty-link"
            >{{ t('setBudgetForPace') }} <ArrowRight :size="15"
          /></RouterLink>
        </section>
        <section class="rail-section">
          <div class="ledger-section-heading">
            <h2>{{ t('netWorth') }}</h2>
            <RouterLink to="/net-worth">{{ t('details') }} <ArrowRight :size="15" /></RouterLink>
          </div>
          <RouterLink to="/net-worth" class="networth-readout"
            ><bdi dir="ltr">{{
              netWorth == null ? '—' : `${netWorth < 0 ? '−' : ''}${formatCurrency(netWorth)}`
            }}</bdi>
            <ArrowRight :size="16"
          /></RouterLink>
        </section>
      </aside>
    </div>
  </div>
</template>
