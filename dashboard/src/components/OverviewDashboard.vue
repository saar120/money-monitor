<script setup lang="ts">
import SelectField from '@/components/ui/select/SelectField.vue';
import { useMonthSwipe } from '@/composables/useMonthSwipe';
import AnimatedAmount from './AnimatedAmount.vue';
import { computed, onMounted, onUnmounted, ref, watch, onScopeDispose } from 'vue';
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
  getTransactions,
  type Transaction,
  type Account,
  type BudgetProgress,
  type CashflowItem,
  type Category,
  type Member,
  type OwnerType,
  type SummaryItem,
} from '../api/client';
import { formatAmount, formatCompactCurrency, formatCurrency } from '@/lib/format';
import { useSseConnection } from '@/composables/useSseConnection';
import { useChartTheme } from '@/composables/useChartTheme';
import { isValidMonth } from '@/lib/month';
import { language, t } from '@/lib/language';
import { Button } from '@/components/ui/button';
import MonthControl from './MonthControl.vue';
import MerchantMark from './MerchantMark.vue';
import { normalizeMerchant } from '@/lib/merchant';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);
const route = useRoute();
const { textPrimary, textSecondary, bgPrimary, separator, chartPrimary, chartComparison } =
  useChartTheme();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const selectedMonth = ref(isValidMonth(route.query.month) ? route.query.month : today.slice(0, 7));
const displayedMonth = ref(selectedMonth.value);
const scrubIndex = ref<number | null>(null);
const chart = ref<InstanceType<typeof VChart> | null>(null);
const monthSwipe = useMonthSwipe(selectedMonth);
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
const monthlyBudgets = ref<BudgetProgress[]>([]);
const recentTransactions = ref<Transaction[]>([]);
const recentFailed = ref(false);
const copy = computed(() =>
  language.value === 'he'
    ? {
        spendingPace: 'קצב ההוצאות',
        recent: 'תנועות אחרונות',
        householdNetWorth: 'שווי נקי של משק הבית',
        review: 'בדיקת תנועות',
        categories: 'הוצאות לפי קטגוריה',
        original: 'כל ההוצאות',
      }
    : {
        spendingPace: 'Spending pace',
        recent: 'Recent activity',
        householdNetWorth: 'Household net worth',
        review: 'Review transactions',
        categories: 'Spending by category',
        original: 'All spending',
      },
);
// Unavailable sources render as unknown, never as zero or "all clear".
const spendingFailed = ref(false);
const budgetsFailed = ref(false);
const attentionFailed = ref(false);
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
onScopeDispose(() => {
  requestId++;
});

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
    getTransactions({
      ...range.value,
      ...ownerFilter.value,
      limit: 7,
      sortBy: 'date',
      sortOrder: 'desc',
    }),
  ] as const);
  if (currentRequest !== requestId) return;
  categorySpending.value = value(results[0])?.summary ?? [];
  previousSpending.value = value(results[1])?.summary ?? [];
  dailySpending.value = value(results[2])?.summary ?? [];
  displayedMonth.value = selectedMonth.value;
  scrubIndex.value = null;
  cashflow.value = value(results[3])?.summary[0] ?? null;
  categories.value = value(results[4])?.categories ?? [];
  accounts.value = value(results[5])?.accounts ?? [];
  members.value = value(results[6])?.members ?? [];
  monthlyBudgets.value =
    value(results[7])?.progress.filter((item) => item.budget.period === 'monthly') ?? [];
  reviewCount.value = value(results[8])?.count ?? 0;
  netWorth.value = value(results[9])?.total ?? null;
  recentTransactions.value = value(results[10])?.transactions.slice(0, 7) ?? [];
  recentFailed.value = results[10].status === 'rejected';
  const failed = (...indexes: number[]) => indexes.some((i) => results[i]!.status === 'rejected');
  spendingFailed.value = failed(0, 1, 2, 3);
  budgetsFailed.value = failed(7);
  attentionFailed.value = failed(5, 8);
  if (results.some((result) => result.status === 'rejected')) error.value = t('couldNotLoad');
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
// Totals match the summary on the Budgets page.
const budgetTotals = computed(() => {
  if (!monthlyBudgets.value.length) return null;
  const planned = monthlyBudgets.value.reduce((sum, item) => sum + item.budget.amount, 0);
  const spent = monthlyBudgets.value.reduce((sum, item) => sum + item.spent, 0);
  return { planned, spent, percentage: planned > 0 ? Math.round((spent / planned) * 100) : 0 };
});
const budgetsNeedingAttention = computed(() =>
  monthlyBudgets.value.filter((item) => item.isAlertTriggered || item.isOverBudget),
);
// A new profile has nothing to total, so its first step stands alone.
const noAccounts = computed(() => !loading.value && !error.value && !accounts.value.length);
const hasAttentionItems = computed(
  () =>
    !!sinceLastVisit.value?.transactions ||
    reviewCount.value > 0 ||
    budgetsNeedingAttention.value.length > 0 ||
    staleAccounts.value.length > 0,
);
const chartOption = computed(() => {
  const end = Number(
    monthRange(
      displayedMonth.value,
      displayedMonth.value === today.slice(0, 7) ? Number(today.slice(8, 10)) : undefined,
    ).endDate.slice(-2),
  );
  const cumulativeDays = (items: SummaryItem[], month: string) => {
    const daily = new Map(items.map((item) => [item.day, Math.abs(item.totalAmount)]));
    let cumulative = 0;
    return Array.from({ length: end }, (_, index) => {
      cumulative += daily.get(`${month}-${String(index + 1).padStart(2, '0')}`) ?? 0;
      return cumulative;
    });
  };
  const days = cumulativeDays(dailySpending.value, displayedMonth.value);
  const previousDays = cumulativeDays(
    previousSpending.value,
    previousRange.value.startDate.slice(0, 7),
  );
  return {
    animation: !reduceMotion.value,
    animationDuration: 0,
    animationDurationUpdate: 250,
    animationEasingUpdate: 'cubicOut' as const,
    grid: { left: 0, right: 12, top: 16, bottom: 12, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      confine: true,
      axisPointer: {
        type: 'line' as const,
        snap: true,
        lineStyle: { color: chartPrimary.value, width: 1 },
      },
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      textStyle: { color: textPrimary.value },
      formatter: (items: Array<{ axisValue: string; value: number; seriesName: string }>) =>
        `${displayedMonth.value}-${items[0]?.axisValue}<br/>${items
          .map((item) => `${item.seriesName}: <b>${formatCurrency(item.value)}</b>`)
          .join('<br/>')}`,
    },
    xAxis: {
      type: 'category' as const,
      boundaryGap: false,
      data: Array.from({ length: end }, (_, index) => String(index + 1).padStart(2, '0')),
      axisLabel: {
        color: textSecondary.value,
        // Stay legible whether the month has 3 elapsed days or 31.
        interval: end <= 8 ? 0 : end <= 16 ? 2 : 6,
        fontSize: 12,
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      splitNumber: 3,
      axisLabel: {
        color: textSecondary.value,
        fontSize: 12,
        formatter: (amount: number) => formatCompactCurrency(amount),
      },
      splitLine: { lineStyle: { color: separator.value } },
    },
    series: [
      {
        id: 'daily-spending',
        name: t('thisMonth'),
        type: 'line' as const,
        data: days,
        smooth: false,
        showSymbol: false,
        symbolSize: 12,
        itemStyle: { color: chartPrimary.value },
        lineStyle: { color: chartPrimary.value, width: 3 },
      },
      {
        id: 'previous-spending',
        name: t('previousMonth'),
        type: 'line' as const,
        data: previousSpending.value.length ? previousDays : [],
        showSymbol: false,
        itemStyle: { color: chartComparison.value },
        lineStyle: { color: chartComparison.value, width: 2, type: 'dashed' as const },
      },
    ],
  };
});
const scrubAmount = computed(() =>
  scrubIndex.value == null
    ? totalSpent.value
    : (chartOption.value.series[0]!.data[scrubIndex.value] ?? 0),
);
const scrubDate = computed(() =>
  scrubIndex.value == null
    ? copy.value.spendingPace
    : `${displayedMonth.value}-${String(scrubIndex.value + 1).padStart(2, '0')}`,
);
function pointAt(event: unknown) {
  if (
    !event ||
    typeof event !== 'object' ||
    !('axesInfo' in event) ||
    !Array.isArray(event.axesInfo)
  )
    return;
  const value = Number(event.axesInfo[0]?.value);
  if (Number.isFinite(value))
    scrubIndex.value = Math.max(0, Math.min(chartOption.value.series[0]!.data.length - 1, value));
}
function scrubWithKeyboard(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  const last = chartOption.value.series[0]!.data.length - 1;
  if (event.key === 'Escape') {
    scrubIndex.value = null;
    chart.value?.dispatchAction({ type: 'hideTip' });
    return;
  }
  scrubIndex.value =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : Math.max(
            0,
            Math.min(last, (scrubIndex.value ?? last) + (event.key === 'ArrowLeft' ? -1 : 1)),
          );
  chart.value?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: scrubIndex.value });
}
function activityLink(
  category?: string,
  reportedOnly = true,
  transactionId?: number,
  direction?: string,
) {
  return {
    path: '/transactions',
    query: {
      month: selectedMonth.value,
      ...range.value,
      owner: selectedOwner.value,
      ...(category ? { category } : {}),
      ...(transactionId ? { transactionId } : {}),
      ...(reportedOnly ? { status: 'completed', inclusion: 'included' } : {}),
      ...(direction ? { direction } : {}),
    },
  };
}
function categoryLink(category: string) {
  return activityLink(category);
}
</script>

<template>
  <div class="ledger-page home-page month-swipe-surface" v-bind="monthSwipe" :aria-busy="loading">
    <Teleport defer to="#toolbar-actions">
      <div class="toolbar-controls">
        <MonthControl v-model="selectedMonth" />
        <SelectField
          v-model="selectedOwner"
          :aria-label="t('everyone')"
          class="ledger-select"
          :options="[
            { value: 'all', label: t('everyone') },
            { value: 'shared', label: t('together') },
            ...members
              .filter((item) => item.isActive)
              .map((member) => ({ value: `member:${member.id}`, label: member.name })),
            { value: 'unassigned', label: t('unassigned') },
          ]"
        />
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
    <section v-if="noAccounts" class="mb-6 space-y-3" aria-labelledby="first-account-heading">
      <h2 id="first-account-heading" class="text-lg font-semibold">
        {{
          language === 'he'
            ? 'התמונה הכלכלית מתחילה בחשבון הראשון'
            : 'Start with your first account'
        }}
      </h2>
      <p class="text-text-secondary">
        {{
          language === 'he'
            ? 'חברו בנק או חברת אשראי כדי לראות תנועות ולעקוב אחר ההוצאות.'
            : 'Add a bank or credit card account to see your transactions and track spending.'
        }}
      </p>
      <Button as-child
        ><RouterLink to="/accounts?add=1">{{
          language === 'he' ? 'הוספת חשבון' : 'Add account'
        }}</RouterLink></Button
      >
    </section>
    <template v-if="!noAccounts">
      <section class="home-summary">
        <div class="home-summary-item">
          <div class="home-hero-top">
            <h2>{{ t('totalSpending') }}</h2>
          </div>
          <RouterLink
            :to="activityLink(undefined, true, undefined, 'expense')"
            class="home-summary-value"
            ><span
              v-if="loading"
              class="home-total home-amount-loading skeleton-shimmer"
              aria-hidden="true" /><span v-else-if="spendingFailed" class="home-total">—</span
            ><span v-else class="home-total" dir="ltr"
              ><AnimatedAmount :value="totalSpent" :animate="false" /></span
          ></RouterLink>
          <p v-if="!loading && !spendingFailed" class="home-comparison">
            {{
              spendingDelta === 0
                ? t('sameAsLastMonth')
                : `${formatCurrency(Math.abs(spendingDelta))} ${spendingDelta > 0 ? t('more') : t('less')} ${selectedMonth === today.slice(0, 7) ? t('samePointLastMonth') : t('thanLastMonth')}`
            }}
          </p>
        </div>
        <div class="home-summary-item">
          <h2>{{ t('postedIncome') }}</h2>
          <RouterLink
            :to="activityLink(undefined, true, undefined, 'income')"
            class="home-summary-value"
            ><strong dir="ltr">{{
              loading || spendingFailed ? '—' : formatCurrency(income)
            }}</strong></RouterLink
          ><span v-if="!loading && !spendingFailed" class="home-cashflow"
            >{{ t('netCashFlow') }}
            <bdi dir="ltr"
              >{{ netCashflow < 0 ? '−' : '' }}{{ formatCurrency(netCashflow) }}</bdi
            ></span
          >
        </div>
        <div class="home-summary-item">
          <h2>{{ copy.householdNetWorth }}</h2>
          <RouterLink to="/net-worth" class="home-summary-value"
            ><strong dir="ltr">{{
              loading || netWorth == null
                ? '—'
                : `${netWorth < 0 ? '−' : ''}${formatCurrency(netWorth)}`
            }}</strong></RouterLink
          >
        </div>
      </section>
      <div class="home-top-grid">
        <section class="workspace-surface home-chart-panel">
          <div class="home-chart-heading">
            <h2 class="home-chart-title">{{ scrubDate }}</h2>
            <div class="home-chart-readout">
              <strong
                :class="{ invisible: scrubIndex == null }"
                :aria-hidden="scrubIndex == null"
                dir="ltr"
                ><AnimatedAmount :value="scrubAmount" :animate="false"
              /></strong>
              <div
                class="home-chart-legend"
                :class="{ invisible: scrubIndex != null || spendingFailed }"
                :aria-hidden="scrubIndex != null || spendingFailed"
              >
                <span class="current">{{ t('thisMonth') }}</span>
                <span v-if="previousSpending.length" class="previous">{{
                  t('previousMonth')
                }}</span>
              </div>
            </div>
          </div>
          <div
            class="home-chart"
            data-scrub
            tabindex="0"
            role="slider"
            :aria-label="t('totalSpending')"
            :aria-valuemin="1"
            :aria-valuemax="chartOption.series[0]!.data.length"
            :aria-valuenow="(scrubIndex ?? chartOption.series[0]!.data.length - 1) + 1"
            :aria-valuetext="`${scrubDate}: ${formatCurrency(scrubAmount)}`"
            aria-describedby="home-chart-hint"
            @keydown="scrubWithKeyboard"
          >
            <div v-if="loading" class="home-chart-loading skeleton-shimmer" aria-hidden="true" />
            <div v-else-if="spendingFailed" class="home-chart-empty" />
            <div v-else-if="!dailySpending.length" class="home-chart-empty">
              <Receipt :size="28" />
              <span>{{ t('noPostedSpendingYet') }}</span>
            </div>
            <VChart
              v-else
              ref="chart"
              :option="chartOption"
              autoresize
              class="h-full w-full"
              @update-axis-pointer="pointAt"
              @globalout="scrubIndex = null"
            />
          </div>
          <p id="home-chart-hint" class="sr-only">{{ t('chartKeyboardHint') }}</p>
        </section>
        <section class="workspace-surface home-attention">
          <h2>{{ reviewCount ? `${reviewCount} ${t('toReview')}` : t('needsAttention') }}</h2>
          <div class="attention-list">
            <RouterLink
              v-for="item in recentTransactions.filter((row) => row.needsReview).slice(0, 2)"
              :key="item.id"
              :to="{ path: '/insights', query: { transactionId: item.id } }"
              class="attention-row"
              ><MerchantMark :description="item.description" /><span
                ><strong
                  ><bdi dir="auto">{{ normalizeMerchant(item.description) }}</bdi></strong
                ><small>{{
                  item.reviewReason ?? item.ownerReviewReason ?? t('needsReview')
                }}</small></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <RouterLink v-if="sinceLastVisit?.transactions" to="/transactions" class="attention-row"
              ><RefreshCw :size="17" /><span
                ><strong>{{ t('sinceLastVisit') }}</strong
                ><small
                  >{{ sinceLastVisit.transactions }} {{ t('newTransactions') }} ·
                  {{ formatCurrency(sinceLastVisit.spent) }} {{ t('spent') }}</small
                ></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <RouterLink
              v-if="budgetsNeedingAttention.length"
              :to="{ path: '/budgets', query: { month: selectedMonth } }"
              class="attention-row"
              ><AlertCircle :size="17" /><span
                ><strong>{{ t('budgetNeedsAttention') }}</strong
                ><small>{{
                  budgetsNeedingAttention.map((item) => item.budget.name).join(', ')
                }}</small></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <RouterLink v-if="staleAccounts.length" to="/accounts" class="attention-row"
              ><AlertCircle :size="17" /><span
                ><strong>{{ staleAccounts.length }} {{ t('accountsNeedAttention') }}</strong></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <div
              v-if="!loading && !attentionFailed && !budgetsFailed && !hasAttentionItems"
              class="attention-row all-clear"
            >
              <CheckCircle2 :size="22" /><strong>{{ t('everythingCurrent') }}</strong>
            </div>
            <p v-if="!loading && attentionFailed" class="home-unavailable">
              {{ t('couldNotLoad') }}
            </p>
          </div>
          <Button v-if="reviewCount" variant="filled" as-child class="home-review-action"
            ><RouterLink to="/insights">{{ copy.review }}<ArrowRight :size="16" /></RouterLink
          ></Button>
        </section>
      </div>
      <div class="home-bottom-grid">
        <section class="workspace-surface home-categories">
          <div class="ledger-section-heading">
            <h2>{{ copy.categories }}</h2>
            <RouterLink :to="activityLink()"
              >{{ t('viewActivity') }}<ArrowRight :size="15"
            /></RouterLink>
          </div>
          <div class="ledger-list">
            <RouterLink
              v-for="item in topCategories"
              :key="item.category"
              :to="categoryLink(item.category ?? 'uncategorized')"
              class="category-ledger-row"
              ><span class="category-row-content"
                ><span>{{
                  categoryMap.get(item.category ?? '')?.label ??
                  (item.category === 'uncategorized' ? t('uncategorized') : item.category)
                }}</span
                ><span class="category-track"
                  ><span
                    :style="{
                      width: `${Math.min(100, (Math.abs(item.totalAmount) / Math.max(totalSpent, 1)) * 100)}%`,
                    }" /></span></span
              ><strong dir="ltr">{{ formatCurrency(Math.abs(item.totalAmount)) }}</strong
              ><ArrowRight :size="14" class="row-chevron"
            /></RouterLink>
            <p v-if="!loading && !spendingFailed && !topCategories.length" class="ledger-empty">
              {{ t('noSpendingThisMonth') }}
            </p>
            <p v-if="!loading && spendingFailed" class="ledger-empty">—</p>
          </div>
          <RouterLink
            v-if="!loading && !spendingFailed"
            :to="activityLink(undefined, true, undefined, 'expense')"
            class="home-category-total"
            ><span>{{ copy.original }}</span
            ><strong dir="ltr">{{ formatCurrency(totalSpent) }}</strong></RouterLink
          >
        </section>
        <section class="workspace-surface home-recent">
          <div class="ledger-section-heading">
            <h2>{{ copy.recent }}</h2>
            <RouterLink :to="activityLink(undefined, false)"
              >{{ t('viewActivity') }}<ArrowRight :size="15"
            /></RouterLink>
          </div>
          <div class="recent-activity-list">
            <RouterLink
              v-for="item in recentTransactions"
              :key="item.id"
              :to="activityLink(undefined, false, item.id)"
              class="recent-activity-row"
              ><MerchantMark :description="item.description" /><bdi
                dir="auto"
                class="recent-merchant"
                >{{ normalizeMerchant(item.description) }}</bdi
              ><span class="recent-date"
                ><bdi dir="ltr">{{
                  new Date(`${item.reportingDate.slice(0, 10)}T12:00:00`).toLocaleDateString(
                    language === 'he' ? 'he-IL' : 'en-US',
                    { month: 'short', day: 'numeric' },
                  )
                }}</bdi></span
              ><span class="recent-amount" :class="{ positive: item.chargedAmount > 0 }"
                ><bdi dir="ltr"
                  >{{ item.chargedAmount < 0 ? '−' : item.chargedAmount > 0 ? '+' : ''
                  }}{{ formatAmount(item.chargedAmount, item.chargedCurrency) }}</bdi
                ></span
              ><ArrowRight :size="14"
            /></RouterLink>
            <p v-if="loading" class="ledger-empty">{{ t('loadingTransactions') }}</p>
            <p v-else-if="recentFailed" class="ledger-empty">{{ t('couldNotLoad') }}</p>
            <p v-else-if="!recentTransactions.length" class="ledger-empty">
              {{ t('noTransactionsFound') }}
            </p>
          </div>
        </section>
      </div>
      <section v-if="budgetTotals || budgetsFailed" class="workspace-surface home-budget-section">
        <div class="ledger-section-heading">
          <h2>{{ t('budgetPace') }}</h2>
          <RouterLink :to="{ path: '/budgets', query: { month: selectedMonth } }"
            >{{ t('budgets') }}<ArrowRight :size="15"
          /></RouterLink>
        </div>
        <div v-if="budgetTotals" class="home-budget-content">
          <strong>{{ budgetTotals.percentage }}%</strong
          ><span>{{ formatCurrency(budgetTotals.planned) }} {{ t('planned') }}</span>
          <div class="budget-track">
            <span :style="{ width: `${Math.min(100, budgetTotals.percentage)}%` }" />
          </div>
          <span
            >{{ formatCurrency(Math.max(0, budgetTotals.planned - budgetTotals.spent)) }}
            {{ t('remaining') }}</span
          >
        </div>
        <p v-else class="ledger-empty">—</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.home-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  padding: 6px 0 28px;
}
.home-summary-item {
  min-width: 0;
}
.home-summary-item h2 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary);
}
.home-summary-value {
  display: inline-block;
  color: var(--text-primary);
  text-decoration: none;
  border-radius: 4px;
}
.home-summary-value:hover {
  color: var(--accent);
}
.home-total,
.home-summary-value > strong {
  font-size: 30px;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -0.025em;
  margin: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.home-amount-loading {
  display: block;
  height: 39px;
  width: 200px;
}
.home-comparison,
.home-cashflow {
  display: block;
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.home-top-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 344px;
  gap: 20px;
  margin-bottom: 22px;
  align-items: stretch;
}
.home-chart-panel {
  padding: 18px 20px 14px;
  min-width: 0;
}
.home-chart-heading {
  margin: 0 0 12px;
  gap: 12px;
}
.home-chart-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.015em;
}
.home-chart {
  height: 240px;
  margin: 0;
}
.home-chart-legend {
  font-size: 11px;
  gap: 14px;
}
.home-chart-heading strong {
  font-size: 13px;
}
.home-attention {
  padding: 20px !important;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--surface);
  border-radius: 10px;
}
.home-attention h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.attention-list {
  display: grid;
  gap: 8px;
}
.home-attention .attention-row {
  padding: 6px 0;
  border: 0;
  gap: 9px;
  min-width: 0;
}
.home-attention .attention-row strong {
  font-size: 13px;
  font-weight: 500;
}
.home-attention .attention-row small {
  font-size: 12px;
  color: var(--text-secondary);
}
.home-attention .attention-row > span {
  min-width: 0;
}
.home-review-action {
  margin-top: auto;
  width: 100%;
}
.home-unavailable {
  font-size: 12px;
  color: var(--text-secondary);
}
.home-bottom-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 20px;
  align-items: start;
}
.home-categories,
.home-recent {
  min-width: 0;
}
.ledger-section-heading {
  padding: 18px 20px 14px;
  margin: 0;
  gap: 12px;
}
.ledger-section-heading h2 {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.015em;
}
.ledger-section-heading > a {
  font-size: 12px;
  white-space: nowrap;
}
.ledger-list {
  padding: 0 20px;
}
.category-ledger-row {
  padding: 16px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--separator) 55%, transparent);
  gap: 12px;
}
.category-row-content {
  display: grid;
  grid-template-columns: 84px minmax(24px, 1fr);
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.category-row-content > span:first-child {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.category-track {
  height: 6px;
  margin: 0;
  background: var(--bg-tertiary);
  border-radius: 4px;
}
.category-track > span {
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
}
.category-ledger-row > strong {
  font-size: 13px;
  font-weight: 450;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.category-ledger-row .row-chevron {
  display: none;
}
.home-category-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 17px 20px;
  color: var(--text-primary);
  font-size: 12px;
}
.home-category-total strong {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.recent-activity-list {
  padding: 0 12px 10px;
}
.recent-activity-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px;
  color: var(--text-primary);
  border-bottom: 1px solid color-mix(in srgb, var(--separator) 55%, transparent);
  text-decoration: none;
  font-size: 13px;
}
.recent-activity-row:last-child {
  border: 0;
}
.recent-activity-row:hover {
  background: var(--row-hover);
  border-radius: 5px;
}
.recent-merchant {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-date {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.recent-amount {
  min-width: 102px;
  text-align: end;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.recent-amount.positive {
  color: var(--success);
}
.recent-activity-row > svg {
  color: var(--text-secondary);
}
.home-budget-section {
  margin-top: 22px;
}
.home-budget-content {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 0 20px 20px;
  font-size: 13px;
  color: var(--text-secondary);
}
.home-budget-content > strong {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.home-budget-content .budget-track {
  flex: 1;
  min-width: 100px;
  margin: 0;
}
.home-budget-content .budget-track > span {
  display: block;
  height: 100%;
  background: var(--accent);
}
@media (max-width: 1200px) {
  .home-summary-value > strong,
  .home-total {
    font-size: 27px;
  }
  .home-bottom-grid {
    grid-template-columns: 1fr;
  }
  .home-chart-panel {
    padding-inline: 16px;
  }
  .home-top-grid {
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  .home-chart-legend {
    gap: 8px;
  }
}
@media (max-width: 1050px) {
  .home-top-grid {
    grid-template-columns: 1fr;
  }
  .home-summary {
    gap: 18px;
  }
  .home-summary-value > strong,
  .home-total {
    font-size: 25px;
  }
  .home-attention {
    min-height: 200px;
  }
  .home-chart {
    height: 240px;
  }
}
@media (max-width: 640px) {
  .home-summary {
    grid-template-columns: 1fr 1fr;
    gap: 22px 16px;
  }
  .home-summary-item:last-child {
    grid-column: 1/-1;
  }
  .home-summary-value > strong,
  .home-total {
    font-size: 24px;
  }
  .home-chart-heading {
    grid-template-columns: 1fr;
  }
  .home-chart-readout {
    justify-items: start;
  }
  .home-chart {
    height: 220px;
  }
  .home-chart-panel {
    padding: 16px 14px;
  }
  .home-top-grid,
  .home-bottom-grid {
    gap: 16px;
  }
  .ledger-section-heading {
    padding-inline: 16px;
    flex-wrap: wrap;
  }
  .ledger-list {
    padding-inline: 16px;
  }
  .recent-date {
    display: none;
  }
  .recent-amount {
    min-width: 88px;
    font-size: 12px;
  }
  .category-row-content {
    grid-template-columns: 70px minmax(24px, 1fr);
    gap: 8px;
  }
}

.home-categories .ledger-list {
  background: var(--surface);
}
.category-row-content > span:first-child {
  font-weight: 400;
}
.home-comparison {
  font-weight: 400;
}
</style>
