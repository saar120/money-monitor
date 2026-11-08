<script setup lang="ts">
import SelectField from '@/components/ui/select/SelectField.vue';
import { useMonthSwipe } from '@/composables/useMonthSwipe';
import { categoryMotionName } from '@/lib/cardMotion';
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
  type Account,
  type BudgetProgress,
  type CashflowItem,
  type Category,
  type Member,
  type OwnerType,
  type SummaryItem,
} from '../api/client';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import { useSseConnection } from '@/composables/useSseConnection';
import { useChartTheme } from '@/composables/useChartTheme';
import { isValidMonth } from '@/lib/month';
import { language, t } from '@/lib/language';
import { Button } from '@/components/ui/button';
import MonthControl from './MonthControl.vue';

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
    ? t('spendingOverTime')
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
    <div v-if="!noAccounts" class="home-grid">
      <section class="home-main">
        <div class="home-hero">
          <div class="home-hero-top">
            <h2>{{ t('totalSpending') }}</h2>
            <RouterLink :to="activityLink()"
              >{{ t('viewActivity') }} <ArrowRight :size="15"
            /></RouterLink>
          </div>
          <p
            v-if="loading"
            class="home-total home-amount-loading skeleton-shimmer"
            aria-hidden="true"
          />
          <p v-else-if="spendingFailed" class="home-total">—</p>
          <p v-else class="home-total" dir="ltr" aria-live="polite">
            <AnimatedAmount :value="totalSpent" />
          </p>
          <p v-if="!loading && !spendingFailed" class="home-comparison">
            {{
              spendingDelta === 0
                ? t('sameAsLastMonth')
                : `${formatCurrency(Math.abs(spendingDelta))} ${spendingDelta > 0 ? t('more') : t('less')} ${selectedMonth === today.slice(0, 7) ? t('samePointLastMonth') : t('thanLastMonth')}`
            }}
          </p>
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
        </div>
        <div class="home-stats">
          <div>
            <span>{{ t('postedIncome') }}</span
            ><strong>{{ loading || spendingFailed ? '—' : formatCurrency(income) }}</strong>
          </div>
          <div>
            <span>{{ t('netCashFlow') }}</span
            ><strong
              :class="{
                'is-positive': !loading && !spendingFailed && netCashflow > 0,
                'is-danger': !loading && !spendingFailed && netCashflow < 0,
              }"
            >
              <template v-if="loading || spendingFailed">—</template>
              <AnimatedAmount v-else :value="netCashflow" />
            </strong>
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
              :style="{ viewTransitionName: categoryMotionName(item.category ?? 'uncategorized') }"
              class="category-ledger-row"
            >
              <span
                class="category-dot"
                :style="{ background: categoryMap.get(item.category ?? '')?.color ?? '#B8C2CC' }"
              />
              <span class="category-row-content"
                ><span>{{
                  categoryMap.get(item.category ?? '')?.label ??
                  (item.category === 'uncategorized' ? t('uncategorized') : item.category)
                }}</span
                ><span class="category-track"
                  ><span
                    :style="{
                      width: `${Math.min(100, (Math.abs(item.totalAmount) / Math.max(totalSpent, 1)) * 100)}%`,
                      background: categoryMap.get(item.category ?? '')?.color ?? 'var(--accent)',
                    }" /></span
              ></span>
              <strong dir="ltr">{{ formatCurrency(Math.abs(item.totalAmount)) }}</strong
              ><ArrowRight :size="15" class="row-chevron" />
            </RouterLink>
            <p v-if="!loading && !spendingFailed && !topCategories.length" class="ledger-empty">
              {{ t('noSpendingThisMonth') }}
            </p>
          </div>
        </section>
      </section>
      <aside class="home-rail">
        <section
          v-if="hasAttentionItems || !(attentionFailed || budgetsFailed)"
          class="rail-section home-attention"
        >
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
                ><strong>{{ reviewCount }} {{ t('toReview') }}</strong></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <RouterLink
              v-if="budgetsNeedingAttention.length"
              :to="{ path: '/budgets', query: { month: selectedMonth } }"
              class="attention-row"
              ><AlertCircle :size="18" /><span
                ><strong>{{ t('budgetNeedsAttention') }}</strong
                ><small>{{
                  budgetsNeedingAttention.map((item) => item.budget.name).join(', ')
                }}</small></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <RouterLink v-if="staleAccounts.length" to="/accounts" class="attention-row"
              ><AlertCircle :size="18" /><span
                ><strong>{{ staleAccounts.length }} {{ t('accountsNeedAttention') }}</strong></span
              ><ArrowRight :size="15"
            /></RouterLink>
            <div
              v-if="!loading && !attentionFailed && !budgetsFailed && !hasAttentionItems"
              class="attention-row all-clear"
            >
              <CheckCircle2 :size="18" /><span
                ><strong>{{ t('everythingCurrent') }}</strong></span
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
          <div v-if="budgetTotals" class="budget-readout">
            <strong>{{ budgetTotals.percentage }}%</strong
            ><span
              >{{ t('ofPlanned') }} {{ formatCurrency(budgetTotals.planned) }}
              {{ t('planned') }}</span
            >
            <div class="budget-track">
              <span :style="{ width: `${Math.min(100, budgetTotals.percentage)}%` }" />
            </div>
            <p>
              {{ formatCurrency(Math.max(0, budgetTotals.planned - budgetTotals.spent)) }}
              {{ t('remaining') }}
            </p>
          </div>
          <p v-else-if="budgetsFailed" class="networth-readout">—</p>
          <RouterLink
            v-else-if="!loading"
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
          <p class="networth-readout">
            <bdi dir="ltr">{{
              netWorth == null ? '—' : `${netWorth < 0 ? '−' : ''}${formatCurrency(netWorth)}`
            }}</bdi>
          </p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.home-hero-top h2 {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}
.home-section {
  margin-block-start: 32px;
}
.home-section .ledger-section-heading,
.rail-section .ledger-section-heading {
  margin-block-end: 16px;
}
.home-section h2,
.rail-section h2 {
  font-size: var(--type-section);
  font-weight: 600;
  line-height: 1.3;
}
.category-ledger-row,
.attention-row {
  padding: 16px;
}
.rail-section {
  padding-block: 20px 0;
}
</style>
