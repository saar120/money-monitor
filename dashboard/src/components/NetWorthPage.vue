<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Doughnut, Line } from 'vue-chartjs';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, LineElement, PointElement, Filler,
} from 'chart.js';
import {
  getNetWorth, getNetWorthHistory, getAccounts, getAssets, getLiabilities,
  createAsset, updateAsset, deleteAsset,
  createHolding, updateHolding, deleteHolding,
  createLiability, updateLiability, deleteLiability,
  type NetWorth, type NetWorthHistory, type Account, type Asset, type Holding, type Liability,
} from '../api/client';
import { useApi } from '../composables/useApi';
import { formatCurrency, formatAmount, CURRENCY_SYMBOLS } from '@/lib/format';
import {
  ASSET_TYPE_COLORS, ASSET_TYPE_LABELS, HOLDING_TYPE_LABELS,
  LIQUIDITY_LABELS, LIQUIDITY_STYLES, LIABILITY_TYPE_LABELS,
} from '@/lib/net-worth-constants';
import { getAssetCategory } from '@/lib/asset-categories';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus, ChevronDown, Pencil, Trash2, TrendingUp, TrendingDown,
  AlertCircle, Loader2, Check, X,
} from 'lucide-vue-next';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, LineElement, PointElement, Filler);

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
  (accountsApi.data.value?.accounts ?? []).filter(a => a.accountType === 'bank')
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
  nwLiabilities.value.map(l => ({
    ...l,
    full: fullLiabilityMap.value.get(l.id),
  }))
);

// Last month delta
const lastMonthDelta = computed(() => {
  const series = history.data.value?.series ?? [];
  if (series.length < 2) return null;
  const current = series[series.length - 1].total;
  const previous = series[series.length - 2].total;
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
    slices.push({ label: 'Banks', value: nwData.banksTotal, color: ASSET_TYPE_COLORS.banks });
  }
  return {
    labels: slices.map(s => s.label),
    datasets: [{
      data: slices.map(s => s.value),
      backgroundColor: slices.map(s => s.color),
    }],
  };
});

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
    ctx.fillStyle = '#f0f0f3';
    ctx.font = 'bold 16px Geist';
    ctx.fillText(formatCompact(total), cx, cy);
    ctx.restore();
  },
};

const doughnutOptions = {
  cutout: '65%',
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        color: '#71717a',
        font: { family: 'Geist' },
        usePointStyle: true,
        pointStyle: 'circle',
      },
    },
    tooltip: {
      backgroundColor: '#18181c',
      borderColor: 'rgba(139,92,246,0.2)',
      borderWidth: 1,
      titleColor: '#f0f0f3',
      bodyColor: '#f0f0f3',
      callbacks: {
        label(ctx: { label?: string; parsed: number; dataset: { data: number[] } }) {
          const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0);
          const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
          return ` ${formatCurrency(ctx.parsed)} (${pct}%)`;
        },
      },
    },
  },
};

// ─── Trend line chart ───
const showLiquidOnly = ref(false);

const trendData = computed(() => {
  const series = history.data.value?.series ?? [];
  if (series.length === 0) return null;
  const labels = series.map(p => {
    const d = new Date(p.date);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });

  if (showLiquidOnly.value) {
    return {
      labels,
      datasets: [{
        label: 'Liquid Net Worth',
        data: series.map(p => p.liquidTotal),
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34, 211, 238, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
        spanGaps: true,
      }],
    };
  }

  return {
    labels,
    datasets: [{
      label: 'Total Net Worth',
      data: series.map(p => p.total),
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139, 92, 246, 0.15)',
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true,
    }],
  };
});

const lineOptions = {
  responsive: true,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#18181c',
      borderColor: 'rgba(139,92,246,0.2)',
      borderWidth: 1,
      titleColor: '#f0f0f3',
      bodyColor: '#f0f0f3',
      callbacks: {
        label(ctx: { parsed: { y: number } }) {
          return ` ${formatCurrency(ctx.parsed.y)}`;
        },
      },
    },
  },
  scales: {
    x: {
      ticks: { color: '#71717a' },
      grid: { color: 'rgba(255,255,255,0.03)' },
    },
    y: {
      ticks: {
        color: '#71717a',
        callback(value: number | string) {
          const v = Number(value);
          if (v >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
          if (v >= 1_000) return `₪${(v / 1_000).toFixed(0)}K`;
          return `₪${v}`;
        },
      },
      grid: { color: 'rgba(255,255,255,0.03)' },
    },
  },
};

// ─── Asset expand/collapse ───
const expandedAssets = ref(new Set<number>());

function toggleExpand(assetId: number) {
  if (expandedAssets.value.has(assetId)) {
    expandedAssets.value.delete(assetId);
  } else {
    expandedAssets.value.add(assetId);
  }
}

// ─── Quick update (inline editing) ───
const editingAssetId = ref<number | null>(null);
const editedHoldings = ref(new Map<number, { quantity: number; lastPrice: number | null }>());
const savingHoldings = ref(new Set<number>());
const savedHoldings = ref(new Set<number>());
const failedHoldings = ref(new Map<number, string>());

function startQuickUpdate(asset: Asset) {
  editingAssetId.value = asset.id;
  expandedAssets.value.add(asset.id);
  editedHoldings.value.clear();
  savingHoldings.value.clear();
  savedHoldings.value.clear();
  failedHoldings.value.clear();
  for (const h of asset.holdings) {
    editedHoldings.value.set(h.id, {
      quantity: h.quantity,
      lastPrice: h.lastPrice,
    });
  }
}

function cancelQuickUpdate() {
  editingAssetId.value = null;
  editedHoldings.value.clear();
}

async function saveQuickUpdate(asset: Asset) {
  const promises: Promise<void>[] = [];
  for (const h of asset.holdings) {
    const edited = editedHoldings.value.get(h.id);
    if (!edited) continue;
    const dirty = edited.quantity !== h.quantity || edited.lastPrice !== h.lastPrice;
    if (!dirty) continue;
    savingHoldings.value.add(h.id);
    const data: { quantity?: number; lastPrice?: number | null } = {};
    if (edited.quantity !== h.quantity) data.quantity = edited.quantity;
    if (edited.lastPrice !== h.lastPrice) data.lastPrice = edited.lastPrice;
    promises.push(
      updateHolding(h.id, data)
        .then(() => {
          savedHoldings.value.add(h.id);
          savingHoldings.value.delete(h.id);
          setTimeout(() => savedHoldings.value.delete(h.id), 2000);
        })
        .catch((err) => {
          failedHoldings.value.set(h.id, err instanceof Error ? err.message : 'Failed');
          savingHoldings.value.delete(h.id);
        })
    );
  }
  await Promise.all(promises);
  if (failedHoldings.value.size === 0) {
    editingAssetId.value = null;
    editedHoldings.value.clear();
    refreshAll();
  }
}

// ─── Asset Dialog ───
const showAssetDialog = ref(false);
const editingAsset = ref<Asset | null>(null);
const assetForm = ref({ name: '', type: 'brokerage', currency: 'ILS', institution: '', liquidity: 'liquid', linkedAccountId: 'none', notes: '' });
const assetSaving = ref(false);

function openAddAsset() {
  editingAsset.value = null;
  assetForm.value = { name: '', type: 'brokerage', currency: 'ILS', institution: '', liquidity: 'liquid', linkedAccountId: 'none', notes: '' };
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
  };
  showAssetDialog.value = true;
}

const assetValid = computed(() => assetForm.value.name.trim() && assetForm.value.type);
const assetCategory = computed(() => getAssetCategory(assetForm.value.type));

async function handleSaveAsset() {
  if (!assetValid.value) return;
  assetSaving.value = true;
  try {
    const linked = assetForm.value.linkedAccountId === 'none' ? undefined : Number(assetForm.value.linkedAccountId);
    const data = {
      name: assetForm.value.name.trim(),
      type: assetForm.value.type,
      currency: assetForm.value.currency,
      institution: assetForm.value.institution.trim() || undefined,
      liquidity: assetForm.value.liquidity,
      linkedAccountId: linked ?? undefined,
      notes: assetForm.value.notes.trim() || undefined,
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

// ─── Holding Dialog ───
const showHoldingDialog = ref(false);
const holdingParentAssetId = ref<number | null>(null);
const holdingParentAsset = computed(() =>
  assetsApi.data.value?.find(a => a.id === holdingParentAssetId.value) ?? null
);
const editingHolding = ref<Holding | null>(null);
const holdingForm = ref({ name: '', type: 'stock', currency: 'ILS', quantity: 0, costBasis: 0, lastPrice: 0, notes: '' });
const holdingSaving = ref(false);

function openAddHolding(assetId: number) {
  holdingParentAssetId.value = assetId;
  editingHolding.value = null;
  holdingForm.value = { name: '', type: 'stock', currency: 'ILS', quantity: 0, costBasis: 0, lastPrice: 0, notes: '' };
  showHoldingDialog.value = true;
}

function openEditHolding(assetId: number, holding: Holding) {
  holdingParentAssetId.value = assetId;
  editingHolding.value = holding;
  holdingForm.value = {
    name: holding.name,
    type: holding.type,
    currency: holding.currency,
    quantity: holding.quantity,
    costBasis: holding.costBasis,
    lastPrice: holding.lastPrice ?? 0,
    notes: holding.notes ?? '',
  };
  showHoldingDialog.value = true;
}

const holdingShowPrice = computed(() => ['stock', 'etf', 'crypto'].includes(holdingForm.value.type));
const holdingValid = computed(() => holdingForm.value.name.trim() && holdingForm.value.type && holdingForm.value.currency.trim());
const holdingDoubleCount = computed(() => {
  if (!holdingParentAsset.value?.linkedAccountId) return false;
  return holdingForm.value.currency.toUpperCase() === 'ILS' && holdingForm.value.type === 'cash';
});

async function handleSaveHolding() {
  if (!holdingValid.value || !holdingParentAssetId.value || holdingDoubleCount.value) return;
  holdingSaving.value = true;
  try {
    const data: Record<string, unknown> = {
      name: holdingForm.value.name.trim(),
      type: holdingForm.value.type,
      currency: holdingForm.value.currency.trim(),
      quantity: Number(holdingForm.value.quantity),
      costBasis: Number(holdingForm.value.costBasis),
      notes: holdingForm.value.notes.trim() || undefined,
    };
    if (holdingShowPrice.value) {
      data.lastPrice = Number(holdingForm.value.lastPrice);
    }
    if (editingHolding.value) {
      await updateHolding(editingHolding.value.id, data as Parameters<typeof updateHolding>[1]);
    } else {
      await createHolding(holdingParentAssetId.value, data as Parameters<typeof createHolding>[1]);
    }
    showHoldingDialog.value = false;
    refreshAll();
  } finally {
    holdingSaving.value = false;
  }
}

// ─── Liability Dialog ───
const showLiabilityDialog = ref(false);
const editingLiability = ref<Liability | null>(null);
const liabilityForm = ref({ name: '', type: 'loan', currency: 'ILS', originalAmount: 0, currentBalance: 0, interestRate: 0, startDate: '', notes: '' });
const liabilitySaving = ref(false);

function openAddLiability() {
  editingLiability.value = null;
  liabilityForm.value = { name: '', type: 'loan', currency: 'ILS', originalAmount: 0, currentBalance: 0, interestRate: 0, startDate: '', notes: '' };
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

const liabilityValid = computed(() => liabilityForm.value.name.trim() && liabilityForm.value.type && liabilityForm.value.originalAmount > 0);

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
      interestRate: liabilityForm.value.interestRate ? Number(liabilityForm.value.interestRate) : undefined,
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
const deletingHolding = ref<{ id: number; name: string; assetName: string } | null>(null);
const deletingLiability = ref<{ id: number; name: string } | null>(null);

async function handleDeleteAsset() {
  const target = deletingAsset.value;
  if (!target) return;
  deletingAsset.value = null;
  try {
    await deleteAsset(target.id);
    refreshAll();
  } catch { /* toast/error handling could go here */ }
}

async function handleDeleteHolding() {
  const target = deletingHolding.value;
  if (!target) return;
  deletingHolding.value = null;
  try {
    await deleteHolding(target.id);
    refreshAll();
  } catch { /* toast/error handling could go here */ }
}

async function handleDeleteLiability() {
  const target = deletingLiability.value;
  if (!target) return;
  deletingLiability.value = null;
  try {
    await deleteLiability(target.id);
    refreshAll();
  } catch { /* toast/error handling could go here */ }
}

// ─── Helpers ───
function pctOfTotal(value: number): string {
  const total = nw.value?.total ?? 0;
  if (total <= 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

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
  <div class="space-y-6 animate-fade-in-up">
    <h1 class="text-2xl font-semibold tracking-tight heading-font">Net Worth</h1>

    <!-- Hero Card -->
    <Card class="border-border-accent glow-primary animate-fade-in-up stagger-1">
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
            <p class="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Total Net Worth</p>
            <p class="text-4xl font-bold tabular-nums heading-font">
              {{ nw.total > 0 || nw.assets.length > 0 || nw.banks.length > 0
                ? formatCurrency(nw.total)
                : '₪0.00' }}
            </p>
            <p v-if="nw.total === 0 && nw.assets.length === 0" class="text-sm text-muted-foreground mt-2">
              Add your first asset to start tracking net worth
              <Button size="sm" class="ml-2" @click="openAddAsset">Add Asset</Button>
            </p>
          </div>
          <div class="space-y-2 text-right max-md:text-left">
            <div>
              <p class="text-xs text-muted-foreground">Liquid Net Worth</p>
              <p class="text-lg font-semibold tabular-nums">{{ formatCurrency(nw.liquidTotal) }}</p>
            </div>
            <div v-if="lastMonthDelta">
              <p class="text-xs text-muted-foreground">vs Last Month</p>
              <Badge
                :class="lastMonthDelta.diff >= 0
                  ? 'bg-success/10 text-success border-0'
                  : 'bg-destructive/10 text-destructive border-0'"
              >
                <component :is="lastMonthDelta.diff >= 0 ? TrendingUp : TrendingDown" class="h-3.5 w-3.5 mr-1" />
                {{ lastMonthDelta.diff >= 0 ? '+' : '' }}{{ formatCurrency(lastMonthDelta.diff) }}
                ({{ lastMonthDelta.pct >= 0 ? '+' : '' }}{{ lastMonthDelta.pct.toFixed(1) }}%)
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
          <CardTitle class="text-base">Allocation by Type</CardTitle>
        </CardHeader>
        <CardContent>
          <Doughnut v-if="allocationData" :data="allocationData" :options="doughnutOptions" :plugins="[doughnutCenterTextPlugin]" />
          <Skeleton v-else-if="netWorth.loading.value" class="h-48 w-full rounded-md" />
          <p v-else class="text-muted-foreground text-sm text-center py-12">No data yet</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-base">Net Worth Trend</CardTitle>
          <div class="flex gap-1 text-xs">
            <Button
              size="sm"
              :variant="showLiquidOnly ? 'ghost' : 'secondary'"
              class="h-7 px-2 text-xs"
              @click="showLiquidOnly = false"
            >Total</Button>
            <Button
              size="sm"
              :variant="showLiquidOnly ? 'secondary' : 'ghost'"
              class="h-7 px-2 text-xs"
              @click="showLiquidOnly = true"
            >Liquid</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Line v-if="trendData" :data="trendData" :options="lineOptions" />
          <Skeleton v-else-if="history.loading.value" class="h-48 w-full rounded-md" />
          <p v-else class="text-sm text-muted-foreground text-center py-12">
            Start tracking your assets to see net worth history
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Assets Section -->
    <div class="space-y-3 animate-fade-in-up stagger-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold heading-font">Assets</h2>
        <Button size="sm" @click="openAddAsset">
          <Plus class="h-4 w-4 mr-1" />
          Add Asset
        </Button>
      </div>

      <Card v-if="assets.length > 0">
        <div
          v-for="(asset, idx) in assets"
          :key="asset.id"
          :class="['group', idx < assets.length - 1 ? 'border-b border-border' : '']"
        >
          <!-- Asset Row (collapsed) -->
          <div
            class="flex items-center gap-3 px-4 py-3 hover:bg-surface-3/50 transition-colors duration-150 cursor-pointer"
            @click="toggleExpand(asset.id)"
          >
            <div
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :style="{ backgroundColor: ASSET_TYPE_COLORS[asset.type] ?? '#71717a' }"
            />
            <div class="flex-1 min-w-0">
              <p
                class="text-sm font-medium hover:underline cursor-pointer"
                @click.stop="router.push(`/net-worth/assets/${asset.id}`)"
              >{{ asset.name }}</p>
              <p class="text-xs text-muted-foreground">
                {{ ASSET_TYPE_LABELS[asset.type] ?? asset.type }}
                <template v-if="getFullAsset(asset.id)?.institution"> &middot; {{ getFullAsset(asset.id)!.institution }}</template>
                <Badge
                  v-if="asset.liquidity"
                  :class="LIQUIDITY_STYLES[asset.liquidity] ?? ''"
                  class="ml-1.5 text-[10px] px-1.5 py-0 border-0"
                >
                  {{ LIQUIDITY_LABELS[asset.liquidity] ?? asset.liquidity }}
                </Badge>
              </p>
            </div>
            <div class="text-right flex-shrink-0">
              <p class="text-lg font-semibold tabular-nums">{{ assetNativeDisplay(asset) }}</p>
              <p class="text-xs text-muted-foreground">{{ pctOfTotal(asset.totalValueIls) }} of total</p>
            </div>
            <!-- Hover actions -->
            <div class="flex items-center gap-0.5 invisible group-hover:visible flex-shrink-0" @click.stop>
              <button class="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-surface-2 transition-colors" @click="openEditAsset(getFullAsset(asset.id)!)">
                <Pencil class="h-3 w-3" />
              </button>
              <button class="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-surface-2 transition-colors" @click="deletingAsset = { id: asset.id, name: asset.name }">
                <Trash2 class="h-3 w-3 text-destructive" />
              </button>
            </div>
            <ChevronDown
              class="h-4 w-4 text-muted-foreground transition-transform duration-150 flex-shrink-0"
              :class="{ 'rotate-180': expandedAssets.has(asset.id) }"
            />
          </div>

          <!-- Expanded Holdings -->
          <div
            class="overflow-hidden transition-all duration-200 ease-out"
            :style="{ maxHeight: expandedAssets.has(asset.id) ? '1000px' : '0px' }"
          >
            <div class="pl-8 pr-4 pb-3" v-if="getFullAsset(asset.id)">
              <!-- Quick Update Mode -->
              <template v-if="editingAssetId === asset.id">
                <div class="flex items-center justify-between mb-2">
                  <p class="text-xs font-medium text-muted-foreground">Holdings (editing):</p>
                  <div class="flex gap-1.5">
                    <Button variant="outline" size="sm" class="h-7 text-xs" @click="cancelQuickUpdate">Cancel</Button>
                    <Button size="sm" class="h-7 text-xs" @click="saveQuickUpdate(getFullAsset(asset.id)!)">Save Changes</Button>
                  </div>
                </div>
                <div class="space-y-1.5">
                  <div
                    v-for="h in getFullAsset(asset.id)!.holdings"
                    :key="h.id"
                    class="flex items-center gap-2 text-xs"
                  >
                    <span class="w-24 truncate font-medium">{{ h.name }}</span>
                    <Input
                      type="number"
                      step="any"
                      class="h-7 text-xs w-24"
                      :model-value="editedHoldings.get(h.id)?.quantity"
                      @update:model-value="(v: string | number) => {
                        const e = editedHoldings.get(h.id);
                        if (e) e.quantity = Number(v);
                      }"
                    />
                    <template v-if="['stock', 'etf', 'crypto'].includes(h.type)">
                      <Input
                        type="number"
                        step="any"
                        class="h-7 text-xs w-24"
                        :model-value="editedHoldings.get(h.id)?.lastPrice ?? undefined"
                        @update:model-value="(v: string | number) => {
                          const e = editedHoldings.get(h.id);
                          if (e) e.lastPrice = Number(v);
                        }"
                      />
                    </template>
                    <span v-else class="w-24 text-center">-</span>
                    <span class="w-20 text-right tabular-nums">{{ formatCompact(h.currentValueIls) }}</span>
                    <span class="w-6 flex justify-center">
                      <Loader2 v-if="savingHoldings.has(h.id)" class="h-3.5 w-3.5 animate-spin" />
                      <Check v-else-if="savedHoldings.has(h.id)" class="h-3.5 w-3.5 text-success" />
                      <X v-else-if="failedHoldings.has(h.id)" class="h-3.5 w-3.5 text-destructive" :title="failedHoldings.get(h.id)" />
                    </span>
                  </div>
                </div>
              </template>

              <!-- View Mode -->
              <template v-else>
                <p class="text-xs font-medium text-muted-foreground mb-2">Holdings:</p>
                <div v-if="getFullAsset(asset.id)!.holdings.length === 0" class="text-xs text-muted-foreground py-2">
                  <template v-if="getAssetCategory(asset.type) === 'crypto' || getAssetCategory(asset.type) === 'brokerage'">
                    No holdings yet.
                    <Button variant="outline" size="sm" class="h-6 text-xs ml-2" @click.stop="openAddHolding(asset.id)">
                      <Plus class="h-3 w-3 mr-1" /> Add
                    </Button>
                  </template>
                  <template v-else>
                    Click to view and update value.
                  </template>
                </div>
                <div v-else class="space-y-1">
                  <div
                    v-for="h in getFullAsset(asset.id)!.holdings"
                    :key="h.id"
                    class="flex items-center gap-2 text-xs group/holding"
                  >
                    <span class="w-24 truncate font-medium">{{ h.name }}</span>
                    <span class="w-20 text-muted-foreground tabular-nums">
                      <template v-if="h.quantity !== 1 || ['stock', 'etf', 'crypto'].includes(h.type)">
                        {{ h.quantity }} {{ h.type === 'stock' || h.type === 'etf' ? 'shares' : h.currency }}
                      </template>
                      <template v-else>-</template>
                    </span>
                    <span class="w-16 text-muted-foreground tabular-nums">
                      {{ h.lastPrice != null ? `${h.currency === 'ILS' ? '₪' : '$'}${h.lastPrice}` : '-' }}
                    </span>
                    <span class="w-20 text-right tabular-nums font-medium" :class="h.stale ? 'text-muted-foreground' : ''">
                      {{ formatCompact(h.currentValueIls) }}
                      <AlertCircle v-if="h.stale" class="h-3 w-3 inline ml-0.5 text-muted-foreground" />
                    </span>
                    <span
                      v-if="h.gainLossPercent != null"
                      class="w-14 text-right tabular-nums"
                      :class="h.gainLossPercent >= 0 ? 'text-success' : 'text-destructive'"
                    >
                      {{ h.gainLossPercent >= 0 ? '+' : '' }}{{ h.gainLossPercent.toFixed(1) }}%
                    </span>
                    <span v-else class="w-14" />
                    <div class="flex items-center gap-1 opacity-0 group-hover/holding:opacity-100 transition-opacity ml-auto" @click.stop>
                      <Button variant="ghost" size="icon" class="h-6 w-6" @click="openEditHolding(asset.id, h)">
                        <Pencil class="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" class="h-6 w-6" @click="deletingHolding = { id: h.id, name: h.name, assetName: asset.name }">
                        <Trash2 class="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div v-if="getAssetCategory(asset.type) === 'crypto' || getAssetCategory(asset.type) === 'brokerage'" class="flex gap-1.5 mt-1">
                    <Button variant="outline" size="sm" class="h-6 text-xs" @click.stop="openAddHolding(asset.id)">
                      <Plus class="h-3 w-3 mr-1" /> Add Holding
                    </Button>
                    <Button variant="outline" size="sm" class="h-6 text-xs" @click.stop="startQuickUpdate(getFullAsset(asset.id)!)">
                      Update Values
                    </Button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </Card>

      <p v-else-if="!netWorth.loading.value" class="text-muted-foreground text-sm text-center py-6">
        No assets tracked yet.
      </p>
    </div>

    <!-- Bank Balances -->
    <div v-if="banks.length > 0" class="space-y-3 animate-fade-in-up stagger-4">
      <h2 class="text-lg font-semibold heading-font">Bank Balances</h2>
      <div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
        <Card v-for="bank in banks" :key="bank.id">
          <CardHeader class="pb-1">
            <CardTitle class="text-sm font-medium truncate">{{ bank.name }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-xl font-bold tabular-nums">{{ formatCurrency(bank.balanceIls) }}</div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Liabilities Section -->
    <div class="space-y-3 animate-fade-in-up stagger-5">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold heading-font">Liabilities</h2>
        <Button size="sm" @click="openAddLiability">
          <Plus class="h-4 w-4 mr-1" />
          Add Liability
        </Button>
      </div>

      <Card v-if="liabilities.length > 0">
        <template v-for="(liab, idx) in liabilities" :key="liab.id">
          <div
            :class="['group px-4 py-3', idx < liabilities.length - 1 ? 'border-b border-border' : '']"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium">{{ liab.name }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ liab.full ? (LIABILITY_TYPE_LABELS[liab.full.type] ?? liab.full.type) : '' }}
                  <template v-if="liab.full?.currency">
                    &middot; {{ liab.full.currency }}
                  </template>
                </p>
              </div>
              <div class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" @click.stop>
                <Button v-if="liab.full" variant="ghost" size="icon" class="h-7 w-7" @click="openEditLiability(liab.full)">
                  <Pencil class="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" class="h-7 w-7" @click="deletingLiability = { id: liab.id, name: liab.name }">
                  <Trash2 class="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
            <p class="text-lg font-semibold tabular-nums mt-1">
              {{ formatCurrency(liab.currentBalanceIls) }}
              <span v-if="liab.full" class="text-xs text-muted-foreground font-normal">
                remaining of {{ formatCurrency(liab.full.originalAmount) }}
              </span>
              <span v-else class="text-xs text-muted-foreground font-normal">remaining</span>
            </p>
            <!-- Progress bar -->
            <div v-if="liab.full" class="mt-2">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 rounded-full bg-surface-3">
                  <div
                    class="h-1.5 rounded-full bg-success"
                    :style="{ width: paidOffPct(liab.full.originalAmount, liab.full.currentBalance) + '%' }"
                  />
                </div>
                <span class="text-xs text-muted-foreground">
                  {{ paidOffPct(liab.full.originalAmount, liab.full.currentBalance).toFixed(0) }}% paid off
                </span>
              </div>
              <p v-if="liab.full.interestRate || liab.full.startDate" class="text-xs text-muted-foreground mt-1">
                <template v-if="liab.full.interestRate">
                  {{ liab.full.interestRate }}% interest
                </template>
                <template v-if="liab.full.interestRate && liab.full.startDate"> &middot; </template>
                <template v-if="liab.full.startDate">
                  Started {{ new Date(liab.full.startDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }}
                </template>
              </p>
            </div>
          </div>
        </template>
      </Card>
      <p v-else-if="!netWorth.loading.value" class="text-muted-foreground text-sm text-center py-6">
        No liabilities tracked.
      </p>
    </div>

    <!-- ─── Asset Dialog ─── -->
    <Dialog v-model:open="showAssetDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ editingAsset ? 'Edit Asset' : 'Add Asset' }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Name</label>
            <Input v-model="assetForm.name" placeholder="e.g. OneZero Portfolio" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Type</label>
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
          <div v-if="assetCategory === 'brokerage'" class="space-y-1.5">
            <label class="text-sm font-medium">Currency</label>
            <Select v-model="assetForm.currency">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(symbol, code) in CURRENCY_SYMBOLS" :key="code" :value="code">{{ code }} ({{ symbol }})</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Institution</label>
            <Input v-model="assetForm.institution" placeholder="e.g. oneZero, excelence" />
          </div>
          <div v-if="assetCategory === 'brokerage'" class="space-y-1.5">
            <label class="text-sm font-medium">Liquidity</label>
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
            <label class="text-sm font-medium">Linked Bank Account</label>
            <Select v-model="assetForm.linkedAccountId">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (no linked account)</SelectItem>
                <SelectItem
                  v-for="acc in bankAccounts"
                  :key="acc.id"
                  :value="String(acc.id)"
                >
                  {{ acc.displayName }}{{ acc.balance != null ? ` (${formatCurrency(acc.balance)})` : '' }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Notes</label>
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

    <!-- ─── Holding Dialog ─── -->
    <Dialog v-model:open="showHoldingDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {{ editingHolding ? 'Edit Holding' : `Add Holding${holdingParentAsset ? ` to ${holdingParentAsset.name}` : ''}` }}
          </DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Name</label>
            <Input v-model="holdingForm.name" placeholder="e.g. TSLA, kaspit shkalit" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Type</label>
            <Select v-model="holdingForm.type">
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, key) in HOLDING_TYPE_LABELS" :key="key" :value="key">
                  {{ label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Currency</label>
            <Input v-model="holdingForm.currency" placeholder="USD" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Quantity</label>
            <Input type="number" step="any" v-model="holdingForm.quantity" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Cost Basis</label>
            <Input type="number" step="any" v-model="holdingForm.costBasis" />
          </div>
          <div v-if="holdingShowPrice" class="space-y-1.5">
            <label class="text-sm font-medium">Last Price (per unit)</label>
            <Input type="number" step="any" v-model="holdingForm.lastPrice" />
          </div>
          <div v-if="holdingDoubleCount" class="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            ILS cash for this institution is already tracked via the linked bank account.
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Notes</label>
            <Textarea v-model="holdingForm.notes" placeholder="Optional notes..." :rows="2" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button :disabled="!holdingValid || holdingSaving || holdingDoubleCount" @click="handleSaveHolding">
            <Loader2 v-if="holdingSaving" class="h-4 w-4 mr-2 animate-spin" />
            {{ editingHolding ? 'Save Changes' : 'Add Holding' }}
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
            <label class="text-sm font-medium">Name</label>
            <Input v-model="liabilityForm.name" placeholder="e.g. Poalim Loan" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Type</label>
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
            <label class="text-sm font-medium">Currency</label>
            <Input v-model="liabilityForm.currency" placeholder="ILS" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Original Amount</label>
            <Input type="number" step="any" v-model="liabilityForm.originalAmount" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Current Balance</label>
            <Input type="number" step="any" v-model="liabilityForm.currentBalance" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Interest Rate (%)</label>
            <Input type="number" step="0.01" v-model="liabilityForm.interestRate" placeholder="Annual rate" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Start Date</label>
            <Input type="date" v-model="liabilityForm.startDate" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Notes</label>
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
    <AlertDialog :open="!!deletingAsset" @update:open="(v) => { if (!v) deletingAsset = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hide "{{ deletingAsset?.name }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This will hide {{ deletingAsset?.name }} from your net worth.
            Holdings and history will be preserved.
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

    <!-- Delete Holding -->
    <AlertDialog :open="!!deletingHolding" @update:open="(v) => { if (!v) deletingHolding = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{{ deletingHolding?.name }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove this holding from {{ deletingHolding?.assetName }}.
            Related movement records will be preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="deletingHolding = null">Cancel</AlertDialogCancel>
          <Button
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            @click="handleDeleteHolding"
          >
            Delete Holding
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Delete Liability -->
    <AlertDialog :open="!!deletingLiability" @update:open="(v) => { if (!v) deletingLiability = null }">
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
