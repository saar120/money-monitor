<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Doughnut, Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Filler,
} from 'chart.js';
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
import { formatCurrency, CURRENCY_SYMBOLS } from '@/lib/format';
import {
  ASSET_TYPE_COLORS,
  ASSET_TYPE_LABELS,
  LIQUIDITY_LABELS,
  LIABILITY_TYPE_LABELS,
} from '@/lib/net-worth-constants';
import { getAssetCategory } from '@/lib/asset-categories';
import { useChartTheme } from '@/composables/useChartTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Filler,
);

const {
  textPrimary,
  tooltip: themeTooltip,
  legendLabels,
  axisTicks,
  grid: themeGrid,
} = useChartTheme();

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
const nwLiabilities = computed(() => nw.value?.liabilities ?? []);
const bankAccounts = computed(() =>
  (accountsApi.data.value?.accounts ?? []).filter((a) => a.accountType === 'bank'),
);

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
const allocationData = computed(() => {
  const nwData = nw.value;
  if (!nwData) return null;
  const slices: { label: string; value: number; color: string }[] = [];
  // Group assets by type
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
  return {
    labels: slices.map((s) => s.label),
    datasets: [
      {
        data: slices.map((s) => s.value),
        backgroundColor: slices.map((s) => s.color),
        borderRadius: 6,
      },
    ],
  };
});

// ─── Assets grouped by category (for enhanced assets section) ───
interface AssetCategoryGroup {
  key: string;
  label: string;
  color: string;
  value: number;
  weight: number; // percentage of total assets (including banks)
  items: { id: number; name: string; type: string; totalValueIls: number; currency: string }[];
}

const assetCategoryGroups = computed<AssetCategoryGroup[]>(() => {
  const nwData = nw.value;
  if (!nwData) return [];

  const assetsTotal = nwData.assetsTotal + nwData.banksTotal;
  if (assetsTotal <= 0) return [];

  // Group assets by type
  const byType = new Map<string, { value: number; items: AssetCategoryGroup['items'] }>();
  for (const asset of nwData.assets) {
    const existing = byType.get(asset.type);
    const item = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      totalValueIls: asset.totalValueIls,
      currency: asset.currency,
    };
    if (existing) {
      existing.value += asset.totalValueIls;
      existing.items.push(item);
    } else {
      byType.set(asset.type, { value: asset.totalValueIls, items: [item] });
    }
  }

  // Add banks as "Cash" category
  if (nwData.banksTotal > 0) {
    byType.set('banks', {
      value: nwData.banksTotal,
      items: nwData.banks.map((b) => ({
        id: b.id,
        name: b.name,
        type: 'banks',
        totalValueIls: b.balanceIls,
        currency: 'ILS',
      })),
    });
  }

  const groups: AssetCategoryGroup[] = [];
  for (const [type, data] of byType) {
    if (data.value <= 0) continue;
    groups.push({
      key: type,
      label: type === 'banks' ? 'Cash' : (ASSET_TYPE_LABELS[type] ?? type),
      color: ASSET_TYPE_COLORS[type] ?? '#71717a',
      value: data.value,
      weight: (data.value / assetsTotal) * 100,
      items: data.items.sort((a, b) => b.totalValueIls - a.totalValueIls),
    });
  }

  // Sort by value descending
  groups.sort((a, b) => b.value - a.value);
  return groups;
});

const totalAssetsValue = computed(() => {
  const nwData = nw.value;
  if (!nwData) return 0;
  return nwData.assetsTotal + nwData.banksTotal;
});

// Expanded categories in the assets table
const expandedCategories = ref(new Set<string>());
function toggleCategory(key: string) {
  if (expandedCategories.value.has(key)) {
    expandedCategories.value.delete(key);
  } else {
    expandedCategories.value.add(key);
  }
}

const doughnutCenterTextPlugin = {
  id: 'doughnutCenterText',
  afterDraw(chart: ChartJS) {
    const total = nw.value?.total;
    if (total == null) return;
    const { ctx, chartArea } = chart;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textPrimary.value;
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(formatCompact(total), cx, cy);
    ctx.restore();
  },
};

const doughnutOptions = computed(() => ({
  cutout: '70%',
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: legendLabels.value,
    },
    tooltip: {
      ...themeTooltip.value,
      callbacks: {
        label(ctx: { label?: string; parsed: number; dataset: { data: number[] } }) {
          const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0);
          const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
          return ` ${formatCurrency(ctx.parsed)} (${pct}%)`;
        },
      },
    },
  },
}));

// ─── Trend line chart ───
const showLiquidOnly = ref(false);

const trendData = computed(() => {
  const series = history.data.value?.series ?? [];
  if (series.length === 0) return null;
  const labels = series.map((p) => {
    const d = new Date(p.date);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });

  if (showLiquidOnly.value) {
    return {
      labels,
      datasets: [
        {
          label: 'Liquid Net Worth',
          data: series.map((p) => p.liquidTotal),
          borderColor: '#5AC8FA',
          backgroundColor: 'rgba(90, 200, 250, 0.15)',
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          borderCapStyle: 'round' as const,
          borderJoinStyle: 'round' as const,
          pointRadius: 3,
          pointHoverRadius: 5,
          spanGaps: true,
        },
      ],
    };
  }

  return {
    labels,
    datasets: [
      {
        label: 'Total Net Worth',
        data: series.map((p) => p.total),
        borderColor: '#007AFF',
        backgroundColor: 'rgba(0, 122, 255, 0.15)',
        fill: true,
        tension: 0.4,
        borderWidth: 2.5,
        borderCapStyle: 'round' as const,
        borderJoinStyle: 'round' as const,
        pointRadius: 3,
        pointHoverRadius: 5,
        spanGaps: true,
      },
    ],
  };
});

const lineOptions = computed(() => ({
  responsive: true,
  plugins: {
    legend: { display: false },
    tooltip: {
      ...themeTooltip.value,
      callbacks: {
        label(ctx: { parsed: { y: number | null } }) {
          return ` ${formatCurrency(ctx.parsed.y ?? 0)}`;
        },
      },
    },
  },
  scales: {
    x: {
      ticks: axisTicks.value,
      grid: themeGrid.value,
    },
    y: {
      ticks: {
        ...axisTicks.value,
        callback(value: number | string) {
          const v = Number(value);
          if (v >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
          if (v >= 1_000) return `₪${(v / 1_000).toFixed(0)}K`;
          return `₪${v}`;
        },
      },
      grid: themeGrid.value,
    },
  },
}));

// ─── Asset Dialog ───
const showAssetDialog = ref(false);
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
  showAssetDialog.value = true;
}

const assetValid = computed(() => assetForm.value.name.trim() && assetForm.value.type);
const assetCategory = computed(() => getAssetCategory(assetForm.value.type));

async function handleSaveAsset() {
  if (!assetValid.value) return;
  assetSaving.value = true;
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
  } finally {
    liabilitySaving.value = false;
  }
}

// ─── Delete confirmations ───
const deletingAsset = ref<{ id: number; name: string } | null>(null);
const deletingLiability = ref<{ id: number; name: string } | null>(null);

async function handleDeleteAsset() {
  const target = deletingAsset.value;
  if (!target) return;
  deletingAsset.value = null;
  try {
    await deleteAsset(target.id);
    refreshAll();
  } catch {
    /* toast/error handling could go here */
  }
}

async function handleDeleteLiability() {
  const target = deletingLiability.value;
  if (!target) return;
  deletingLiability.value = null;
  try {
    await deleteLiability(target.id);
    refreshAll();
  } catch {
    /* toast/error handling could go here */
  }
}

// ─── Helpers ───
function paidOffPct(original: number, current: number): number {
  if (original <= 0) return 0;
  return Math.max(0, Math.min(100, ((original - current) / original) * 100));
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₪${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₪${(value / 1_000).toFixed(1)}K`;
  return formatCurrency(value);
}

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
  <div class="space-y-5 animate-fade-in-up">
    <Teleport to="#toolbar-actions">
      <div class="flex items-center gap-2">
        <Button size="sm" variant="outline" @click="openAddLiability">
          <Plus class="h-4 w-4 mr-1" />
          Add Liability
        </Button>
        <Button size="sm" @click="openAddAsset">
          <Plus class="h-4 w-4 mr-1" />
          Add Asset
        </Button>
      </div>
    </Teleport>

    <!-- Stale rates warning -->
    <div
      v-if="nw?.ratesStale"
      class="flex items-center gap-2 px-3 py-2 mb-5 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/20 text-[12px] text-[var(--warning)]"
    >
      <AlertCircle class="h-3.5 w-3.5 flex-shrink-0" />
      <span>Exchange rates unavailable — some values may be inaccurate</span>
    </div>

    <!-- Hero Card -->
    <Card class="border-separator animate-fade-in-up stagger-1">
      <CardContent class="pt-6">
        <div v-if="netWorth.loading.value && !nw" class="grid grid-cols-[1fr_auto] gap-6">
          <Skeleton class="h-12 w-48" />
          <div class="space-y-2">
            <Skeleton class="h-6 w-32" />
            <Skeleton class="h-5 w-28" />
          </div>
        </div>
        <div v-else-if="nw" class="grid grid-cols-[1fr_auto] gap-6 items-start max-md:grid-cols-1">
          <div>
            <p class="text-[11px] font-semibold text-text-secondary mb-1">Total Net Worth</p>
            <p class="text-4xl font-semibold tabular-nums text-text-primary">
              {{
                nw.total > 0 || nw.assets.length > 0 || nw.banks.length > 0
                  ? formatCurrency(nw.total)
                  : '₪0.00'
              }}
            </p>
            <p
              v-if="nw.total === 0 && nw.assets.length === 0"
              class="text-[13px] text-text-secondary mt-2"
            >
              Add your first asset to start tracking net worth
              <Button size="sm" class="ml-2" @click="openAddAsset">Add Asset</Button>
            </p>
          </div>
          <div class="space-y-2 text-right max-md:text-left">
            <div>
              <p class="text-[11px] text-text-secondary">Liquid Net Worth</p>
              <p class="text-[15px] font-semibold tabular-nums">
                {{ formatCurrency(nw.liquidTotal) }}
              </p>
            </div>
            <div v-if="lastMonthDelta">
              <p class="text-[11px] text-text-secondary">vs Last Month</p>
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
                {{ lastMonthDelta.diff >= 0 ? '+' : ''
                }}{{ formatCurrency(lastMonthDelta.diff) }} ({{ lastMonthDelta.pct >= 0 ? '+' : ''
                }}{{ lastMonthDelta.pct.toFixed(1) }}%)
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Charts Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-in-up stagger-2">
      <Card>
        <CardHeader>
          <CardTitle class="text-[15px]">Allocation by Type</CardTitle>
        </CardHeader>
        <CardContent>
          <Doughnut
            v-if="allocationData"
            :data="allocationData"
            :options="doughnutOptions"
            :plugins="[doughnutCenterTextPlugin]"
          />
          <Skeleton v-else-if="netWorth.loading.value" class="h-48 w-full rounded-lg" />
          <p v-else class="text-text-secondary text-[13px] text-center py-12">No data yet</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-[15px]">Net Worth Trend</CardTitle>
          <div class="flex gap-1 text-[11px]">
            <Button
              size="sm"
              :variant="showLiquidOnly ? 'ghost' : 'secondary'"
              class="h-7 px-2 text-[11px]"
              @click="showLiquidOnly = false"
              >Total</Button
            >
            <Button
              size="sm"
              :variant="showLiquidOnly ? 'secondary' : 'ghost'"
              class="h-7 px-2 text-[11px]"
              @click="showLiquidOnly = true"
              >Liquid</Button
            >
          </div>
        </CardHeader>
        <CardContent>
          <Line v-if="trendData" :data="trendData" :options="lineOptions" />
          <Skeleton v-else-if="history.loading.value" class="h-48 w-full rounded-lg" />
          <p v-else class="text-[13px] text-text-secondary text-center py-12">
            Start tracking your assets to see net worth history
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Lists section -->
    <div class="space-y-5">
      <!-- Enhanced Assets Section -->
      <div class="space-y-4 animate-fade-in-up stagger-3">
        <Card v-if="assetCategoryGroups.length > 0">
          <CardContent class="pt-5 pb-4">
            <!-- Header: Assets · ₪total -->
            <div class="flex items-baseline gap-2 mb-4">
              <h2 class="text-[17px] font-semibold">Assets</h2>
              <span class="text-[17px] text-text-secondary font-normal"
                >&middot; {{ formatCurrency(totalAssetsValue) }}</span
              >
            </div>

            <!-- Stacked allocation bar -->
            <div class="flex h-2.5 rounded-full overflow-hidden mb-3">
              <div
                v-for="group in assetCategoryGroups"
                :key="group.key"
                :style="{ width: group.weight + '%', backgroundColor: group.color }"
                class="transition-all duration-300"
              />
            </div>

            <!-- Legend -->
            <div class="flex flex-wrap gap-x-4 gap-y-1 mb-5">
              <div
                v-for="group in assetCategoryGroups"
                :key="group.key"
                class="flex items-center gap-1.5"
              >
                <div
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: group.color }"
                />
                <span class="text-[12px] text-text-secondary">{{ group.label }}</span>
                <span class="text-[12px] font-medium">{{ Math.round(group.weight) }}%</span>
              </div>
            </div>

            <!-- Table header -->
            <div
              class="flex items-center px-3 pb-2 text-[11px] font-semibold text-text-secondary uppercase tracking-wider"
            >
              <span class="flex-1">Name</span>
              <span class="w-[200px] text-center max-md:hidden">Weight</span>
              <span class="w-[120px] text-right">Value</span>
            </div>

            <!-- Category rows -->
            <Card class="divide-y divide-separator">
              <div v-for="group in assetCategoryGroups" :key="group.key">
                <!-- Category row -->
                <div
                  class="flex items-center gap-3 px-3 py-3.5 hover:bg-bg-tertiary/50 transition-colors duration-150 cursor-pointer"
                  @click="toggleCategory(group.key)"
                >
                  <ChevronRight
                    class="h-4 w-4 text-text-secondary transition-transform duration-150 flex-shrink-0"
                    :class="{ 'rotate-90': expandedCategories.has(group.key) }"
                  />
                  <span class="text-[14px] font-medium flex-1">{{ group.label }}</span>
                  <!-- Weight bar + percentage -->
                  <div class="w-[200px] flex items-center gap-2.5 max-md:hidden">
                    <div class="flex-1 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all duration-300"
                        :style="{
                          width: group.weight + '%',
                          backgroundColor: group.color,
                          opacity: 0.7,
                        }"
                      />
                    </div>
                    <span class="text-[13px] tabular-nums text-text-secondary w-12 text-right"
                      >{{ group.weight.toFixed(2) }}%</span
                    >
                  </div>
                  <span class="w-[120px] text-right text-[14px] font-semibold tabular-nums">{{
                    formatCurrency(group.value)
                  }}</span>
                </div>

                <!-- Expanded individual assets -->
                <div
                  class="overflow-hidden transition-all duration-200 ease-out"
                  :style="{ maxHeight: expandedCategories.has(group.key) ? '2000px' : '0px' }"
                >
                  <div class="bg-bg-secondary/30">
                    <div
                      v-for="(item, itemIdx) in group.items"
                      :key="item.id"
                      :class="[
                        'flex items-center gap-3 pl-10 pr-3 py-2.5 group/item',
                        itemIdx < group.items.length - 1 ? 'border-b border-separator/50' : '',
                      ]"
                    >
                      <div class="flex-1 min-w-0">
                        <p
                          v-if="item.type !== 'banks'"
                          class="text-[13px] font-medium hover:underline cursor-pointer"
                          @click.stop="router.push(`/net-worth/assets/${item.id}`)"
                        >
                          {{ item.name }}
                        </p>
                        <p v-else class="text-[13px] font-medium">{{ item.name }}</p>
                      </div>
                      <!-- Item weight bar -->
                      <div class="w-[200px] flex items-center gap-2.5 max-md:hidden">
                        <div class="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                          <div
                            class="h-full rounded-full transition-all duration-300"
                            :style="{
                              width:
                                (totalAssetsValue > 0
                                  ? (item.totalValueIls / totalAssetsValue) * 100
                                  : 0) + '%',
                              backgroundColor: group.color,
                              opacity: 0.5,
                            }"
                          />
                        </div>
                        <span class="text-[12px] tabular-nums text-text-secondary w-12 text-right">
                          {{
                            totalAssetsValue > 0
                              ? ((item.totalValueIls / totalAssetsValue) * 100).toFixed(2)
                              : '0.00'
                          }}%
                        </span>
                      </div>
                      <span class="w-[120px] text-right text-[13px] tabular-nums">{{
                        formatCurrency(item.totalValueIls)
                      }}</span>
                      <!-- Hover actions for non-bank assets -->
                      <div
                        v-if="item.type !== 'banks'"
                        class="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity flex-shrink-0"
                        @click.stop
                      >
                        <button
                          class="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-bg-secondary transition-colors"
                          @click="openEditAsset(getFullAsset(item.id)!)"
                        >
                          <Pencil class="h-3 w-3" />
                        </button>
                        <button
                          class="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-bg-secondary transition-colors"
                          @click="deletingAsset = { id: item.id, name: item.name }"
                        >
                          <Trash2 class="h-3 w-3 text-destructive" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </CardContent>
        </Card>

        <p
          v-else-if="!netWorth.loading.value"
          class="text-text-secondary text-[13px] text-center py-6"
        >
          No assets tracked yet.
        </p>
      </div>

      <!-- Liabilities Section -->
      <div class="space-y-5 animate-fade-in-up stagger-5">
        <h2 class="text-[15px] font-semibold">Liabilities</h2>

        <Card v-if="liabilities.length > 0">
          <template v-for="(liab, idx) in liabilities" :key="liab.id">
            <div
              :class="[
                'group px-4 py-3',
                idx < liabilities.length - 1 ? 'border-b border-separator' : '',
              ]"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1 min-w-0">
                  <p class="text-[13px] font-medium">{{ liab.name }}</p>
                  <p class="text-[11px] text-text-secondary">
                    {{ liab.full ? (LIABILITY_TYPE_LABELS[liab.full.type] ?? liab.full.type) : '' }}
                    <template v-if="liab.full?.currency">
                      &middot; {{ liab.full.currency }}
                    </template>
                  </p>
                </div>
                <div
                  class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  @click.stop
                >
                  <Button
                    v-if="liab.full"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    @click="openEditLiability(liab.full)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    @click="deletingLiability = { id: liab.id, name: liab.name }"
                  >
                    <Trash2 class="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <p class="text-[15px] font-semibold tabular-nums mt-1">
                {{ formatCurrency(liab.currentBalanceIls) }}
                <span v-if="liab.full" class="text-[11px] text-text-secondary font-normal">
                  remaining of {{ formatCurrency(liab.full.originalAmount) }}
                </span>
                <span v-else class="text-[11px] text-text-secondary font-normal">remaining</span>
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
                  <span class="text-[11px] text-text-secondary">
                    {{ paidOffPct(liab.full.originalAmount, liab.full.currentBalance).toFixed(0) }}%
                    paid off
                  </span>
                </div>
                <p
                  v-if="liab.full.interestRate || liab.full.startDate"
                  class="text-[11px] text-text-secondary mt-1"
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
        </Card>
        <p
          v-else-if="!netWorth.loading.value"
          class="text-text-secondary text-[13px] text-center py-6"
        >
          No liabilities tracked.
        </p>
      </div>
    </div>
    <!-- end scrollable lists -->

    <!-- ─── Asset Dialog ─── -->
    <Dialog v-model:open="showAssetDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ editingAsset ? 'Edit Asset' : 'Add Asset' }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Name</label>
            <Input v-model="assetForm.name" placeholder="e.g. OneZero Portfolio" />
          </div>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Type</label>
            <Select v-model="assetForm.type">
              <SelectTrigger>
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
            <label class="text-[13px] font-medium">Currency</label>
            <Select v-model="assetForm.currency">
              <SelectTrigger>
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
              <label class="text-[13px] font-medium"
                >Property Value ({{ assetForm.currency }})</label
              >
              <Input
                v-model.number="assetForm.initialValue"
                type="number"
                placeholder="e.g. 500000"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-[13px] font-medium">Purchase Price (ILS)</label>
              <Input
                v-model.number="assetForm.initialCostBasis"
                type="number"
                placeholder="e.g. 2000000"
              />
            </div>
          </template>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Institution</label>
            <Input v-model="assetForm.institution" placeholder="e.g. oneZero, excelence" />
          </div>
          <div v-if="assetCategory === 'brokerage'" class="space-y-1.5">
            <label class="text-[13px] font-medium">Liquidity</label>
            <Select v-model="assetForm.liquidity">
              <SelectTrigger>
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
            <label class="text-[13px] font-medium">Linked Bank Account</label>
            <Select v-model="assetForm.linkedAccountId">
              <SelectTrigger>
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
            <label class="text-[13px] font-medium">Notes</label>
            <Textarea v-model="assetForm.notes" placeholder="Optional notes..." :rows="2" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button :disabled="!assetValid || assetSaving" @click="handleSaveAsset">
            <Loader2 v-if="assetSaving" class="h-4 w-4 mr-2 animate-spin" />
            {{ editingAsset ? 'Save Changes' : 'Add Asset' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ─── Liability Dialog ─── -->
    <Dialog v-model:open="showLiabilityDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ editingLiability ? 'Edit Liability' : 'Add Liability' }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Name</label>
            <Input v-model="liabilityForm.name" placeholder="e.g. Poalim Loan" />
          </div>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Type</label>
            <Select v-model="liabilityForm.type">
              <SelectTrigger>
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
            <label class="text-[13px] font-medium">Currency</label>
            <Input v-model="liabilityForm.currency" placeholder="ILS" />
          </div>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Original Amount</label>
            <Input v-model="liabilityForm.originalAmount" type="number" step="any" />
          </div>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Current Balance</label>
            <Input v-model="liabilityForm.currentBalance" type="number" step="any" />
          </div>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Interest Rate (%)</label>
            <Input
              v-model="liabilityForm.interestRate"
              type="number"
              step="0.01"
              placeholder="Annual rate"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Start Date</label>
            <Input v-model="liabilityForm.startDate" type="date" />
          </div>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Notes</label>
            <Textarea v-model="liabilityForm.notes" placeholder="Optional notes..." :rows="2" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button :disabled="!liabilityValid || liabilitySaving" @click="handleSaveLiability">
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
          if (!v) deletingAsset = null;
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
        <AlertDialogFooter>
          <AlertDialogCancel @click="deletingAsset = null">Cancel</AlertDialogCancel>
          <Button
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            @click="handleDeleteAsset"
          >
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
          if (!v) deletingLiability = null;
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
        <AlertDialogFooter>
          <AlertDialogCancel @click="deletingLiability = null">Cancel</AlertDialogCancel>
          <Button
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            @click="handleDeleteLiability"
          >
            Hide Liability
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
