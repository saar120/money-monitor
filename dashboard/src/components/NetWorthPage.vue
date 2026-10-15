<script setup lang="ts">
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui';
import { ref, computed, onMounted } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { useRouter } from 'vue-router';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, GraphicComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import EChartsLineChart from '@/components/EChartsLineChart.vue';

use([CanvasRenderer, PieChart, TooltipComponent, GraphicComponent]);
const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

import {
  getNetWorth,
  getNetWorthHistory,
  getAccounts,
  getAssets,
  getLiabilities,
  createAsset,
  updateAsset,
  deleteAsset,
  createLiability,
  updateLiability,
  deleteLiability,
  type NetWorth,
  type NetWorthHistory,
  type Account,
  type Asset,
  type Liability,
} from '../api/client';
import { useApi } from '../composables/useApi';
import { formatCurrency, formatAmount, CURRENCY_SYMBOLS } from '@/lib/format';
import { language, t } from '@/lib/language';
import {
  ASSET_TYPE_COLORS,
  ASSET_TYPE_LABELS,
  LIQUIDITY_LABELS,
  LIQUIDITY_STYLES,
  LIABILITY_TYPE_LABELS,
} from '@/lib/net-worth-constants';
import { getAssetCategory } from '@/lib/asset-categories';
import { useChartTheme } from '@/composables/useChartTheme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus,
  ChevronRight,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Loader2,
} from 'lucide-vue-next';

const { textPrimary, bgPrimary, separator, chartPrimary, chartComparison } = useChartTheme();

const router = useRouter();

// ─── Data fetching ───
const netWorth = useApi<NetWorth>(() => getNetWorth());
const history = useApi<NetWorthHistory>(() => getNetWorthHistory({ granularity: 'monthly' }));
const accountsApi = useApi<{ accounts: Account[] }>(() => getAccounts());
const assetsApi = useApi<Asset[]>(() => getAssets());
const liabilitiesApi = useApi<Liability[]>(() => getLiabilities());

onMounted(() => {
  netWorth.execute();
  history.execute();
  accountsApi.execute();
  assetsApi.execute();
  liabilitiesApi.execute();
});

async function refreshAll() {
  await Promise.all([netWorth.execute(), assetsApi.execute(), liabilitiesApi.execute()]);
}

// ─── Computed data ───
const nw = computed(() => netWorth.data.value);
const banks = computed(() => nw.value?.banks ?? []);
const assets = computed(() => nw.value?.assets ?? []);
const nwLiabilities = computed(() => nw.value?.liabilities ?? []);
const bankAccounts = computed(() =>
  (accountsApi.data.value?.accounts ?? []).filter((a) => a.accountType === 'bank'),
);

function assetNativeDisplay(asset: { currency: string; totalValueIls: number }): string {
  if (asset.currency === 'ILS') return formatAmount(asset.totalValueIls, 'ILS');
  const rate = nw.value?.exchangeRates?.[asset.currency] ?? 1;
  const native = asset.totalValueIls / rate;
  return `${formatAmount(native, asset.currency)} (${formatAmount(asset.totalValueIls, 'ILS')})`;
}

// Merged liability data: net-worth summary + full detail
interface MergedLiability {
  id: number;
  name: string;
  currentBalanceIls: number;
  full: Liability | undefined;
}
const liabilities = computed<MergedLiability[]>(() =>
  nwLiabilities.value.map((l) => ({
    ...l,
    full: fullLiabilityMap.value.get(l.id),
  })),
);

// Last month delta
const lastMonthDelta = computed(() => {
  const series = history.data.value?.series ?? [];
  if (series.length < 2) return null;
  const current = series[series.length - 1]!.total;
  const previous = series[series.length - 2]!.total;
  const diff = current - previous;
  const pct = previous !== 0 ? (diff / previous) * 100 : 0;
  return { diff, pct };
});

// ─── Allocation doughnut ───
const allocationSlices = computed(() => {
  const nwData = nw.value;
  const slices: { label: string; value: number; color: string }[] = [];
  if (!nwData) return slices;
  const byType = new Map<string, number>();
  for (const asset of nwData.assets) {
    byType.set(asset.type, (byType.get(asset.type) ?? 0) + asset.totalValueIls);
  }
  for (const [type, value] of byType) {
    if (value > 0) {
      slices.push({
        label: ASSET_TYPE_LABELS[type] ?? type,
        value,
        color: ASSET_TYPE_COLORS[type] ?? '#71717a',
      });
    }
  }
  if (nwData.banksTotal > 0) {
    slices.push({
      label: 'Banks',
      value: nwData.banksTotal,
      color: ASSET_TYPE_COLORS.banks ?? '#3b82f6',
    });
  }

  return slices;
});

const doughnutOption = computed(() => {
  const nwData = nw.value;
  const slices = allocationSlices.value;
  if (!nwData || slices.length === 0) return null;

  return {
    animation: !reduceMotion.value,
    animationDuration: 0,
    animationDurationUpdate: 220,
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: bgPrimary.value,
      borderColor: separator.value,
      borderWidth: 1,
      textStyle: { color: textPrimary.value, fontSize: 12 },
      formatter(params: any) {
        return `${params.name}<br/><b>${formatCurrency(params.value)}</b> (${params.percent}%)`;
      },
    },
    graphic: {
      type: 'text' as const,
      left: 'center',
      top: '45%',
      style: {
        text: formatCompact(slices.reduce((sum, slice) => sum + slice.value, 0)),
        fill: textPrimary.value,
        fontSize: 16,
        fontWeight: 'bold' as const,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        textAlign: 'center' as const,
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['50%', '72%'],
        center: ['50%', '48%'],
        padAngle: 2,
        label: { show: false },
        itemStyle: { borderRadius: 6 },
        data: slices.map((s) => ({
          name: s.label,
          value: s.value,
          itemStyle: { color: s.color },
        })),
      },
    ],
  };
});

// ─── Trend line chart ───
const showLiquidOnly = ref(false);
const trendRange = ref<3 | 6 | 12>(12);
const visibleTrend = computed(() => (history.data.value?.series ?? []).slice(-trendRange.value));

const trendLabels = computed(() => {
  const series = visibleTrend.value;
  return series.map((p) => {
    const d = new Date(p.date);
    return d.toLocaleDateString(language.value === 'he' ? 'he-IL' : 'en-US', {
      month: 'short',
      year: '2-digit',
    });
  });
});

const trendDatasets = computed(() => {
  const series = visibleTrend.value;
  if (series.length === 0) return null;

  if (showLiquidOnly.value) {
    return [
      {
        label: 'Liquid Net Worth',
        data: series.map((p) => p.liquidTotal),
        color: chartComparison.value,
      },
    ];
  }
  return [
    {
      label: 'Total Net Worth',
      data: series.map((p) => p.total),
      color: chartPrimary.value,
    },
  ];
});

const nwYAxisFormatter = (v: number): string => {
  if (v >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `₪${(v / 1_000).toFixed(0)}K`;
  return `₪${v}`;
};

const nwTooltipFormatter = (v: number): string => formatCurrency(v);

// ─── Asset Dialog ───
const showAssetDialog = ref(false);
const mutationError = ref('');
const deleting = ref(false);
const editingAsset = ref<Asset | null>(null);
const assetForm = ref({
  name: '',
  type: 'brokerage',
  currency: 'ILS',
  institution: '',
  liquidity: 'liquid',
  linkedAccountId: 'none',
  notes: '',
  initialValue: 0,
  initialCostBasis: 0,
});
const assetSaving = ref(false);

function openAddAsset() {
  editingAsset.value = null;
  assetForm.value = {
    name: '',
    type: 'brokerage',
    currency: 'ILS',
    institution: '',
    liquidity: 'liquid',
    linkedAccountId: 'none',
    notes: '',
    initialValue: 0,
    initialCostBasis: 0,
  };
  mutationError.value = '';
  showAssetDialog.value = true;
}

function openEditAsset(asset: Asset) {
  editingAsset.value = asset;
  assetForm.value = {
    name: asset.name,
    type: asset.type,
    currency: asset.currency,
    institution: asset.institution ?? '',
    liquidity: asset.liquidity,
    linkedAccountId: asset.linkedAccountId != null ? String(asset.linkedAccountId) : 'none',
    notes: asset.notes ?? '',
    initialValue: 0,
    initialCostBasis: 0,
  };
  mutationError.value = '';
  showAssetDialog.value = true;
}

const assetValid = computed(() => assetForm.value.name.trim() && assetForm.value.type);
const assetCategory = computed(() => getAssetCategory(assetForm.value.type));

async function handleSaveAsset() {
  if (!assetValid.value) return;
  assetSaving.value = true;
  mutationError.value = '';
  try {
    const linked =
      assetForm.value.linkedAccountId === 'none'
        ? undefined
        : Number(assetForm.value.linkedAccountId);
    const data = {
      name: assetForm.value.name.trim(),
      type: assetForm.value.type,
      currency: assetForm.value.currency,
      institution: assetForm.value.institution.trim() || undefined,
      liquidity: assetForm.value.liquidity,
      linkedAccountId: linked ?? undefined,
      notes: assetForm.value.notes.trim() || undefined,
      ...(assetCategory.value === 'real_estate' && !editingAsset.value
        ? {
            initialValue: assetForm.value.initialValue || undefined,
            initialCostBasis: assetForm.value.initialCostBasis || undefined,
          }
        : {}),
    };
    if (editingAsset.value) {
      await updateAsset(editingAsset.value.id, {
        ...data,
        institution: data.institution ?? null,
        linkedAccountId: linked ?? null,
        notes: data.notes ?? null,
      });
    } else {
      await createAsset(data);
    }
    showAssetDialog.value = false;
    refreshAll();
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    assetSaving.value = false;
  }
}

// ─── Liability Dialog ───
const showLiabilityDialog = ref(false);
const editingLiability = ref<Liability | null>(null);
const liabilityForm = ref({
  name: '',
  type: 'loan',
  currency: 'ILS',
  originalAmount: 0,
  currentBalance: 0,
  interestRate: 0,
  startDate: '',
  notes: '',
});
const liabilitySaving = ref(false);

function openAddLiability() {
  editingLiability.value = null;
  liabilityForm.value = {
    name: '',
    type: 'loan',
    currency: 'ILS',
    originalAmount: 0,
    currentBalance: 0,
    interestRate: 0,
    startDate: '',
    notes: '',
  };
  mutationError.value = '';
  showLiabilityDialog.value = true;
}

function openEditLiability(liability: Liability) {
  editingLiability.value = liability;
  liabilityForm.value = {
    name: liability.name,
    type: liability.type,
    currency: liability.currency,
    originalAmount: liability.originalAmount,
    currentBalance: liability.currentBalance,
    interestRate: liability.interestRate ?? 0,
    startDate: liability.startDate ?? '',
    notes: liability.notes ?? '',
  };
  mutationError.value = '';
  showLiabilityDialog.value = true;
}

const liabilityValid = computed(
  () =>
    liabilityForm.value.name.trim() &&
    liabilityForm.value.type &&
    liabilityForm.value.originalAmount > 0,
);

async function handleSaveLiability() {
  if (!liabilityValid.value) return;
  liabilitySaving.value = true;
  mutationError.value = '';
  try {
    const data = {
      name: liabilityForm.value.name.trim(),
      type: liabilityForm.value.type,
      currency: liabilityForm.value.currency.trim() || undefined,
      originalAmount: Number(liabilityForm.value.originalAmount),
      currentBalance: Number(liabilityForm.value.currentBalance),
      interestRate: liabilityForm.value.interestRate
        ? Number(liabilityForm.value.interestRate)
        : undefined,
      startDate: liabilityForm.value.startDate || undefined,
      notes: liabilityForm.value.notes.trim() || undefined,
    };
    if (editingLiability.value) {
      await updateLiability(editingLiability.value.id, {
        ...data,
        interestRate: data.interestRate ?? null,
        startDate: data.startDate ?? null,
        notes: data.notes ?? null,
      });
    } else {
      await createLiability(data);
    }
    showLiabilityDialog.value = false;
    refreshAll();
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    liabilitySaving.value = false;
  }
}

// ─── Delete confirmations ───
const deletingAsset = ref<{ id: number; name: string } | null>(null);
const deletingLiability = ref<{ id: number; name: string } | null>(null);

async function handleDeleteAsset() {
  const target = deletingAsset.value;
  if (!target || deleting.value) return;
  deleting.value = true;
  mutationError.value = '';
  try {
    await deleteAsset(target.id);
    deletingAsset.value = null;
    await refreshAll();
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    deleting.value = false;
  }
}

async function handleDeleteLiability() {
  const target = deletingLiability.value;
  if (!target || deleting.value) return;
  deleting.value = true;
  mutationError.value = '';
  try {
    await deleteLiability(target.id);
    deletingLiability.value = null;
    await refreshAll();
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    deleting.value = false;
  }
}

// ─── Helpers ───
function pctOfTotal(value: number): string {
  const total = (nw.value?.assetsTotal ?? 0) + (nw.value?.banksTotal ?? 0);
  if (total <= 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function paidOffPct(original: number, current: number): number {
  if (original <= 0) return 0;
  return Math.max(0, Math.min(100, ((original - current) / original) * 100));
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}₪${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}₪${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${formatCurrency(value)}`;
}
function signedCurrency(value: number): string {
  return `${value < 0 ? '−' : ''}${formatCurrency(value)}`;
}
const addMenuOpen = ref(false);

// Lookup maps for O(1) access in template loops
const fullAssetMap = computed(() => {
  const m = new Map<number, Asset>();
  for (const a of assetsApi.data.value ?? []) m.set(a.id, a);
  return m;
});
function getFullAsset(id: number) {
  return fullAssetMap.value.get(id);
}

const fullLiabilityMap = computed(() => {
  const m = new Map<number, Liability>();
  for (const l of liabilitiesApi.data.value ?? []) m.set(l.id, l);
  return m;
});
</script>

<template>
  <div class="networth-page min-w-0 space-y-8">
    <Teleport to="#toolbar-actions">
      <DropdownMenuRoot v-model:open="addMenuOpen">
        <DropdownMenuTrigger as-child>
          <Button size="sm"><Plus class="h-4 w-4" />{{ t('add') }}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent align="end" :side-offset="6" class="networth-add-options">
            <DropdownMenuItem @select="openAddAsset">{{ t('addAsset') }}</DropdownMenuItem>
            <DropdownMenuItem @select="openAddLiability">{{ t('addLiability') }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </Teleport>

    <!-- Stale rates warning -->
    <div
      v-if="nw?.ratesStale"
      class="flex items-center gap-2 px-3 py-2 mb-5 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/20 text-[12px] text-[var(--warning)]"
    >
      <AlertCircle class="h-3.5 w-3.5 flex-shrink-0" />
      <span>{{ t('staleExchangeRates') }}</span>
    </div>

    <!-- Net worth summary -->
    <section class="networth-hero">
      <div class="finance-section-content pt-6">
        <div
          v-if="netWorth.loading.value && !nw"
          class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6"
        >
          <Skeleton class="h-12 w-48" />
          <div class="space-y-2">
            <Skeleton class="h-6 w-32" />
            <Skeleton class="h-5 w-28" />
          </div>
        </div>
        <div v-else-if="nw" class="grid grid-cols-[1fr_auto] gap-6 items-start max-md:grid-cols-1">
          <div>
            <p class="text-[12px] font-semibold text-text-secondary mb-1">
              {{ t('totalNetWorth') }}
            </p>
            <p
              class="text-3xl sm:text-4xl font-semibold tabular-nums break-words text-text-primary"
              dir="ltr"
            >
              {{
                nw.total !== 0 || nw.assets.length > 0 || nw.banks.length > 0
                  ? signedCurrency(nw.total)
                  : '₪0.00'
              }}
            </p>
            <p
              v-if="nw.total === 0 && nw.assets.length === 0"
              class="text-[14px] text-text-secondary mt-2"
            >
              {{ t('addFirstAsset') }}
              <Button size="sm" class="ml-2" @click="openAddAsset">{{ t('addAsset') }}</Button>
            </p>
          </div>
          <div class="space-y-4 text-end max-md:text-start">
            <div>
              <p class="text-[12px] text-text-secondary">{{ t('liquidNetWorth') }}</p>
              <p class="text-[16px] font-semibold tabular-nums" dir="ltr">
                {{ signedCurrency(nw.liquidTotal) }}
              </p>
            </div>
            <div v-if="lastMonthDelta">
              <p class="text-[12px] text-text-secondary">{{ t('vsLastMonth') }}</p>
              <Badge
                :class="
                  lastMonthDelta.diff >= 0
                    ? 'bg-success/10 text-success border-0'
                    : 'bg-destructive/10 text-destructive border-0'
                "
              >
                <component
                  :is="lastMonthDelta.diff >= 0 ? TrendingUp : TrendingDown"
                  class="h-3.5 w-3.5 mr-1"
                />
                {{ lastMonthDelta.diff >= 0 ? '+' : '−'
                }}{{ formatCurrency(lastMonthDelta.diff) }} ({{ lastMonthDelta.pct >= 0 ? '+' : ''
                }}{{ lastMonthDelta.pct.toFixed(1) }}%)
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Charts Row -->
    <div id="networth-charts" class="networth-charts grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section id="chart-networth-allocation" class="finance-section finance-ledger">
        <header class="finance-section-heading">
          <h2 class="text-[20px]">{{ t('allocationByType') }}</h2>
        </header>
        <div class="finance-section-content">
          <div class="h-[220px]">
            <VChart
              v-if="doughnutOption"
              :option="doughnutOption"
              autoresize
              class="h-full w-full"
            />
            <Skeleton v-else-if="netWorth.loading.value" class="h-full w-full rounded-lg" />
            <p v-else class="text-text-secondary text-[14px] text-center py-12">
              {{ t('noDataYet') }}
            </p>
          </div>
          <ul
            v-if="allocationSlices.length"
            class="allocation-values"
            :aria-label="t('allocationByType')"
          >
            <li v-for="slice in allocationSlices" :key="slice.label">
              <span class="allocation-name"
                ><i :style="{ background: slice.color }" /><bdi dir="auto">{{
                  slice.label
                }}</bdi></span
              >
              <strong dir="ltr">{{ formatCurrency(slice.value) }}</strong>
            </li>
          </ul>
        </div>
      </section>

      <section id="chart-networth-trend" class="finance-section finance-ledger">
        <header
          class="finance-section-heading flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-2"
        >
          <h2 class="text-[20px]">{{ t('netWorthTrend') }}</h2>
          <div class="flex flex-wrap items-center gap-2 text-[12px]">
            <div class="comparison-range" role="group" :aria-label="t('timeRange')">
              <button
                v-for="count in [3, 6, 12] as const"
                :key="count"
                type="button"
                :class="{ selected: trendRange === count }"
                :aria-pressed="trendRange === count"
                @click="trendRange = count"
              >
                {{ count === 12 ? '1Y' : `${count}M` }}
              </button>
            </div>
            <Button
              size="sm"
              :variant="showLiquidOnly ? 'ghost' : 'secondary'"
              class="px-2"
              @click="showLiquidOnly = false"
              >{{ t('total') }}</Button
            >
            <Button
              size="sm"
              :variant="showLiquidOnly ? 'secondary' : 'ghost'"
              class="px-2"
              @click="showLiquidOnly = true"
              >{{ t('liquid') }}</Button
            >
          </div>
        </header>
        <div class="finance-section-content">
          <div v-if="trendDatasets" class="h-64">
            <EChartsLineChart
              :labels="trendLabels"
              :datasets="trendDatasets"
              :y-axis-formatter="nwYAxisFormatter"
              :tooltip-formatter="nwTooltipFormatter"
            />
          </div>
          <Skeleton v-else-if="history.loading.value" class="h-48 w-full rounded-lg" />
          <p v-else class="text-[14px] text-text-secondary text-center py-12">
            {{ t('startTrackingAssets') }}
          </p>
        </div>
      </section>
    </div>

    <!-- Lists section -->
    <div class="space-y-8">
      <!-- Assets Section -->
      <div class="space-y-4 animate-fade-in-up stagger-3">
        <h2 class="text-[20px] font-semibold">{{ t('assets') }}</h2>

        <section v-if="assets.length > 0" class="finance-section finance-ledger">
          <div
            v-for="(asset, idx) in assets"
            :key="asset.id"
            :class="['group', idx < assets.length - 1 ? 'border-b border-separator' : '']"
          >
            <!-- Asset summary -->
            <div class="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-150">
              <div
                class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                :style="{ backgroundColor: ASSET_TYPE_COLORS[asset.type] ?? '#71717a' }"
              />
              <div class="flex-1 min-w-0">
                <button
                  type="button"
                  class="text-start text-[14px] font-medium hover:underline cursor-pointer break-words min-h-9"
                  @click.stop="router.push(`/net-worth/assets/${asset.id}`)"
                >
                  {{ asset.name }}
                </button>
                <p class="text-[12px] text-text-secondary">
                  {{ ASSET_TYPE_LABELS[asset.type] ?? asset.type }}
                  <template v-if="getFullAsset(asset.id)?.institution">
                    &middot; {{ getFullAsset(asset.id)!.institution }}</template
                  >
                  <Badge
                    v-if="asset.liquidity"
                    :class="LIQUIDITY_STYLES[asset.liquidity] ?? ''"
                    class="ms-2 text-[12px] px-2 py-0.5 border-0"
                  >
                    {{ LIQUIDITY_LABELS[asset.liquidity] ?? asset.liquidity }}
                  </Badge>
                </p>
              </div>
              <div class="text-end min-w-0 break-words max-sm:w-full max-sm:order-last">
                <p class="text-[16px] font-semibold tabular-nums">
                  {{ assetNativeDisplay(asset) }}
                </p>
                <p class="text-[12px] text-text-secondary">
                  {{ pctOfTotal(asset.totalValueIls) }}
                  {{ language === 'he' ? 'מתוך הנכסים' : 'of assets' }}
                </p>
              </div>
              <!-- Asset actions -->
              <div class="flex items-center gap-0.5 flex-shrink-0" @click.stop>
                <button
                  class="icon-control inline-flex items-center justify-center rounded-md hover:bg-bg-secondary transition-colors"
                  :aria-label="language === 'he' ? 'עריכה' : 'Edit'"
                  @click="openEditAsset(getFullAsset(asset.id)!)"
                >
                  <Pencil class="h-3 w-3" />
                </button>
                <button
                  class="icon-control inline-flex items-center justify-center rounded-md hover:bg-bg-secondary transition-colors"
                  :aria-label="language === 'he' ? 'מחיקה' : 'Delete'"
                  @click="
                    mutationError = '';
                    deletingAsset = { id: asset.id, name: asset.name };
                  "
                >
                  <Trash2 class="h-3 w-3 text-destructive" />
                </button>
              </div>
              <button
                type="button"
                class="icon-control inline-flex items-center justify-center rounded-md hover:bg-bg-secondary shrink-0"
                :aria-label="`${t('assetDetails')}: ${asset.name}`"
                @click="router.push(`/net-worth/assets/${asset.id}`)"
              >
                <ChevronRight class="h-4 w-4 text-text-secondary" />
              </button>
            </div>
          </div>
        </section>

        <p
          v-else-if="!netWorth.loading.value"
          class="text-text-secondary text-[14px] text-center py-6"
        >
          {{ t('noAssetsTracked') }}
        </p>
      </div>

      <!-- Bank Balances -->
      <div v-if="banks.length > 0" class="space-y-4 animate-fade-in-up stagger-4">
        <h2 class="text-[20px] font-semibold">{{ t('bankBalances') }}</h2>
        <div class="networth-banks grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          <section v-for="bank in banks" :key="bank.id" class="finance-section finance-ledger">
            <header class="finance-section-heading pb-1">
              <h2 class="text-[14px] font-medium truncate">{{ bank.name }}</h2>
            </header>
            <div class="finance-section-content">
              <div class="text-[17px] font-semibold tabular-nums">
                {{ formatCurrency(bank.balanceIls) }}
              </div>
            </div>
          </section>
        </div>
      </div>

      <!-- Liabilities Section -->
      <div class="space-y-4 animate-fade-in-up stagger-5">
        <h2 class="text-[20px] font-semibold">{{ t('liabilities') }}</h2>

        <section v-if="liabilities.length > 0" class="finance-section finance-ledger">
          <template v-for="(liab, idx) in liabilities" :key="liab.id">
            <div
              :class="[
                'group px-4 py-3',
                idx < liabilities.length - 1 ? 'border-b border-separator' : '',
              ]"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <p class="text-[14px] font-medium">{{ liab.name }}</p>
                  <p class="text-[12px] text-text-secondary">
                    {{ liab.full ? (LIABILITY_TYPE_LABELS[liab.full.type] ?? liab.full.type) : '' }}
                    <template v-if="liab.full?.currency">
                      &middot; {{ liab.full.currency }}
                    </template>
                  </p>
                </div>
                <div class="flex items-center gap-1.5 transition-opacity" @click.stop>
                  <Button
                    v-if="liab.full"
                    variant="ghost"
                    size="icon"
                    class="w-7"
                    :aria-label="language === 'he' ? 'עריכה' : 'Edit'"
                    @click="openEditLiability(liab.full)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="w-7"
                    :aria-label="language === 'he' ? 'מחיקה' : 'Delete'"
                    @click="
                      mutationError = '';
                      deletingLiability = { id: liab.id, name: liab.name };
                    "
                  >
                    <Trash2 class="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <p class="text-[20px] font-semibold tabular-nums mt-1">
                {{ formatCurrency(liab.currentBalanceIls) }}
                <span v-if="liab.full" class="text-[12px] text-text-secondary font-normal">
                  remaining of {{ formatCurrency(liab.full.originalAmount) }}
                </span>
                <span v-else class="text-[12px] text-text-secondary font-normal">remaining</span>
              </p>
              <!-- Progress bar -->
              <div v-if="liab.full" class="mt-2">
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-1.5 rounded-full bg-bg-tertiary">
                    <div
                      class="h-1.5 rounded-full bg-success"
                      :style="{
                        width: paidOffPct(liab.full.originalAmount, liab.full.currentBalance) + '%',
                      }"
                    />
                  </div>
                  <span class="text-[12px] text-text-secondary">
                    {{ paidOffPct(liab.full.originalAmount, liab.full.currentBalance).toFixed(0) }}%
                    paid off
                  </span>
                </div>
                <p
                  v-if="liab.full.interestRate || liab.full.startDate"
                  class="text-[12px] text-text-secondary mt-1"
                >
                  <template v-if="liab.full.interestRate">
                    {{ liab.full.interestRate }}% interest
                  </template>
                  <template v-if="liab.full.interestRate && liab.full.startDate">
                    &middot;
                  </template>
                  <template v-if="liab.full.startDate">
                    Started
                    {{
                      new Date(liab.full.startDate).toLocaleDateString('en-US', {
                        month: 'short',
                        year: 'numeric',
                      })
                    }}
                  </template>
                </p>
              </div>
            </div>
          </template>
        </section>
        <p
          v-else-if="!netWorth.loading.value"
          class="text-text-secondary text-[14px] text-center py-6"
        >
          {{ t('noLiabilitiesTracked') }}
        </p>
      </div>
    </div>
    <!-- end scrollable lists -->

    <!-- ─── Asset Dialog ─── -->
    <Dialog v-model:open="showAssetDialog">
      <DialogContent class="sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingAsset ? 'Edit Asset' : 'Add Asset' }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <label for="net-worth-page-field-1" class="text-[14px] font-medium">Name</label>
            <Input
              id="net-worth-page-field-1"
              v-model="assetForm.name"
              placeholder="e.g. OneZero Portfolio"
            />
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-2" class="text-[14px] font-medium">Type</label>
            <Select v-model="assetForm.type">
              <SelectTrigger id="net-worth-page-field-2">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, key) in ASSET_TYPE_LABELS" :key="key" :value="key">
                  {{ label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div
            v-if="assetCategory === 'brokerage' || assetCategory === 'real_estate'"
            class="space-y-1.5"
          >
            <label for="net-worth-page-field-3" class="text-[14px] font-medium">Currency</label>
            <Select v-model="assetForm.currency">
              <SelectTrigger id="net-worth-page-field-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(symbol, code) in CURRENCY_SYMBOLS" :key="code" :value="code"
                  >{{ code }} ({{ symbol }})</SelectItem
                >
              </SelectContent>
            </Select>
          </div>
          <template v-if="assetCategory === 'real_estate' && !editingAsset">
            <div class="space-y-1.5">
              <label for="net-worth-page-field-4" class="text-[14px] font-medium"
                >Property Value ({{ assetForm.currency }})</label
              >
              <Input
                id="net-worth-page-field-4"
                v-model.number="assetForm.initialValue"
                type="number"
                placeholder="e.g. 500000"
              />
            </div>
            <div class="space-y-1.5">
              <label for="net-worth-page-field-5" class="text-[14px] font-medium"
                >Purchase Price (ILS)</label
              >
              <Input
                id="net-worth-page-field-5"
                v-model.number="assetForm.initialCostBasis"
                type="number"
                placeholder="e.g. 2000000"
              />
            </div>
          </template>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-6" class="text-[14px] font-medium">Institution</label>
            <Input
              id="net-worth-page-field-6"
              v-model="assetForm.institution"
              placeholder="e.g. oneZero, excelence"
            />
          </div>
          <div v-if="assetCategory === 'brokerage'" class="space-y-1.5">
            <label for="net-worth-page-field-7" class="text-[14px] font-medium">Liquidity</label>
            <Select v-model="assetForm.liquidity">
              <SelectTrigger id="net-worth-page-field-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, key) in LIQUIDITY_LABELS" :key="key" :value="key">
                  {{ label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="assetCategory === 'brokerage'" class="space-y-1.5">
            <label for="net-worth-page-field-8" class="text-[14px] font-medium"
              >Linked Bank Account</label
            >
            <Select v-model="assetForm.linkedAccountId">
              <SelectTrigger id="net-worth-page-field-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (no linked account)</SelectItem>
                <SelectItem v-for="acc in bankAccounts" :key="acc.id" :value="String(acc.id)">
                  {{ acc.displayName
                  }}{{ acc.balance != null ? ` (${formatCurrency(acc.balance)})` : '' }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-9" class="text-[14px] font-medium">Notes</label>
            <Textarea
              id="net-worth-page-field-9"
              v-model="assetForm.notes"
              placeholder="Optional notes..."
              :rows="2"
            />
          </div>
        </div>
        <p v-if="mutationError" role="alert" class="text-sm text-destructive">
          {{ mutationError }}
        </p>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant="filled" :disabled="!assetValid || assetSaving" @click="handleSaveAsset">
            <Loader2 v-if="assetSaving" class="h-4 w-4 mr-2 animate-spin" />
            {{ editingAsset ? 'Save Changes' : 'Add Asset' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ─── Liability Dialog ─── -->
    <Dialog v-model:open="showLiabilityDialog">
      <DialogContent class="sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingLiability ? 'Edit Liability' : 'Add Liability' }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <label for="net-worth-page-field-17" class="text-[14px] font-medium">Name</label>
            <Input
              id="net-worth-page-field-17"
              v-model="liabilityForm.name"
              placeholder="e.g. Poalim Loan"
            />
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-18" class="text-[14px] font-medium">Type</label>
            <Select v-model="liabilityForm.type">
              <SelectTrigger id="net-worth-page-field-18">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, key) in LIABILITY_TYPE_LABELS" :key="key" :value="key">
                  {{ label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-19" class="text-[14px] font-medium">Currency</label>
            <Input
              id="net-worth-page-field-19"
              v-model="liabilityForm.currency"
              placeholder="ILS"
            />
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-20" class="text-[14px] font-medium"
              >Original Amount</label
            >
            <Input
              id="net-worth-page-field-20"
              v-model="liabilityForm.originalAmount"
              type="number"
              step="any"
            />
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-21" class="text-[14px] font-medium"
              >Current Balance</label
            >
            <Input
              id="net-worth-page-field-21"
              v-model="liabilityForm.currentBalance"
              type="number"
              step="any"
            />
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-22" class="text-[14px] font-medium"
              >Interest Rate (%)</label
            >
            <Input
              id="net-worth-page-field-22"
              v-model="liabilityForm.interestRate"
              type="number"
              step="0.01"
              placeholder="Annual rate"
            />
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-23" class="text-[14px] font-medium">Start Date</label>
            <Input id="net-worth-page-field-23" v-model="liabilityForm.startDate" type="date" />
          </div>
          <div class="space-y-1.5">
            <label for="net-worth-page-field-24" class="text-[14px] font-medium">Notes</label>
            <Textarea
              id="net-worth-page-field-24"
              v-model="liabilityForm.notes"
              placeholder="Optional notes..."
              :rows="2"
            />
          </div>
        </div>
        <p v-if="mutationError" role="alert" class="text-sm text-destructive">
          {{ mutationError }}
        </p>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="filled"
            :disabled="!liabilityValid || liabilitySaving"
            @click="handleSaveLiability"
          >
            <Loader2 v-if="liabilitySaving" class="h-4 w-4 mr-2 animate-spin" />
            {{ editingLiability ? 'Save Changes' : 'Add Liability' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ─── Delete Confirmations ─── -->
    <!-- Delete Asset -->
    <AlertDialog
      :open="!!deletingAsset"
      @update:open="
        (v) => {
          if (!v && !deleting) deletingAsset = null;
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hide "{{ deletingAsset?.name }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This will hide {{ deletingAsset?.name }} from your net worth. Holdings and history will
            be preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="mutationError" role="alert" class="text-sm text-destructive">
          {{ mutationError }}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel
            @click="
              mutationError = '';
              deletingAsset = null;
            "
            >Cancel</AlertDialogCancel
          >
          <Button variant="destructive-filled" :disabled="deleting" @click="handleDeleteAsset">
            Hide Asset
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Delete Liability -->
    <AlertDialog
      :open="!!deletingLiability"
      @update:open="
        (v) => {
          if (!v && !deleting) deletingLiability = null;
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hide "{{ deletingLiability?.name }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This will hide {{ deletingLiability?.name }} from your net worth.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="mutationError" role="alert" class="text-sm text-destructive">
          {{ mutationError }}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel
            @click="
              mutationError = '';
              deletingLiability = null;
            "
            >Cancel</AlertDialogCancel
          >
          <Button variant="destructive-filled" :disabled="deleting" @click="handleDeleteLiability">
            Hide Liability
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style scoped>
.networth-hero {
  padding: 24px;
  border-block: 1px solid var(--separator);
}
.finance-section {
  min-width: 0;
}
.finance-section-heading {
  padding: 24px 24px 16px;
}
.finance-section-content {
  min-width: 0;
  padding: 0 24px 24px;
}
.networth-hero > .finance-section-content {
  padding: 0;
}
.finance-section-heading h2 {
  font-weight: 600;
  line-height: 1.3;
}
.networth-charts {
  gap: 24px;
}
.finance-ledger {
  border-block: 1px solid var(--separator);
}
.networth-banks {
  gap: 24px;
  padding: 24px 16px;
  border-block: 1px solid var(--separator);
}
.networth-banks .finance-section {
  border: 0;
}
.networth-banks .finance-section-heading,
.networth-banks .finance-section-content {
  padding: 0;
}
.networth-banks .finance-section-heading {
  margin-block-end: 8px;
}
@media (max-width: 640px) {
  .networth-hero {
    padding: 24px 16px;
  }
  .finance-section-heading,
  .finance-section-content {
    padding-inline: 16px;
  }
}
</style>
