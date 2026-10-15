<script setup lang="ts">
import { useChartTheme } from '@/composables/useChartTheme';
import { ref, computed, onMounted, watch } from 'vue';
import EChartsLineChart from '@/components/EChartsLineChart.vue';
import {
  getAsset,
  getMovements,
  getAssetSnapshots,
  createMovement,
  deleteMovement,
  createHolding,
  updateHolding,
  deleteHolding,
  type Asset,
  type Holding,
  type Movement,
  type AssetSnapshot,
} from '@/api/client';
import { useApi } from '@/composables/useApi';
import { formatCurrency, formatAmount, CURRENCY_SYMBOLS } from '@/lib/format';
import { language, t } from '@/lib/language';
import {
  ASSET_TYPE_COLORS,
  ASSET_TYPE_LABELS,
  HOLDING_TYPE_LABELS,
  LIQUIDITY_LABELS,
  LIQUIDITY_STYLES,
} from '@/lib/net-worth-constants';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Loader2,
  Pencil,
  RefreshCw,
} from 'lucide-vue-next';

const { chartPrimary } = useChartTheme();

const props = defineProps<{ assetId: number; initialAsset: Asset }>();
const copy = computed(() =>
  language.value === 'he'
    ? {
        current: 'שווי נוכחי',
        invested: 'סך השקעה (₪)',
        return: 'תשואה כוללת (₪)',
        noData: 'אין נתונים',
        holdings: 'החזקות',
        cancel: 'ביטול',
        save: 'שמירה',
        update: 'עדכון ערכים',
        add: 'הוספת החזקה',
        noHoldings: 'עדיין אין החזקות',
        addFirst: 'הוספת החזקה ראשונה',
        name: 'שם',
        type: 'סוג',
        quantity: 'כמות',
        price: 'מחיר',
        value: 'שווי',
        cost: 'עלות רכישה',
        pnl: 'רווח והפסד',
        noPrice: 'אין נתוני מחיר',
        history: 'שווי לאורך זמן',
        movements: 'היסטוריית תנועות',
        addMovement: 'הוספת תנועה',
        noHistory: 'עדכנו החזקות כדי להתחיל לבנות היסטוריית שווי',
      }
    : {
        current: 'Current value',
        invested: 'Total invested (ILS)',
        return: 'Total return (ILS)',
        noData: 'No data',
        holdings: 'Holdings',
        cancel: 'Cancel',
        save: 'Save',
        update: 'Update values',
        add: 'Add holding',
        noHoldings: 'No holdings yet',
        addFirst: 'Add first holding',
        name: 'Name',
        type: 'Type',
        quantity: 'Quantity',
        price: 'Price',
        value: 'Value',
        cost: 'Cost basis',
        pnl: 'P&L',
        noPrice: 'No price data',
        history: 'Value over time',
        movements: 'Movement history',
        addMovement: 'Add movement',
        noHistory: 'Update holdings to start building value history',
      },
);

// ─── Data fetching ───
const assetApi = useApi<Asset>(() => getAsset(props.assetId));
const movementsApi = useApi<{ movements: Movement[]; total: number }>(() =>
  getMovements(props.assetId, { limit: 50 }),
);
const snapshotsApi = useApi<{ snapshots: AssetSnapshot[] }>(() => getAssetSnapshots(props.assetId));

onMounted(() => {
  movementsApi.execute();
  snapshotsApi.execute();
});

async function refreshAll() {
  await Promise.all([assetApi.execute(), movementsApi.execute(), snapshotsApi.execute()]);
}

// ─── Currency toggle ───
const CURRENCY_PREF_KEY = 'asset_display_currency';
const displayCurrency = ref<'native' | 'ILS'>(
  (localStorage.getItem(CURRENCY_PREF_KEY) as 'native' | 'ILS') ?? 'native',
);
watch(displayCurrency, (val) => {
  localStorage.setItem(CURRENCY_PREF_KEY, val);
});
const assetCurrency = computed(() => asset.value?.currency ?? 'ILS');
const isNonIls = computed(() => assetCurrency.value !== 'ILS');
const showingIls = computed(() => displayCurrency.value === 'ILS' || !isNonIls.value);

const asset = computed(() => assetApi.data.value ?? props.initialAsset);
const holdings = computed(() => asset.value?.holdings ?? []);
const movementsList = ref<Movement[]>([]);
const movementsTotal = ref(0);
const movementOffset = ref(0);
const hasMoreMovements = computed(() => movementsList.value.length < movementsTotal.value);

watch(
  () => movementsApi.data.value,
  (data) => {
    if (data) {
      movementsList.value = data.movements;
      movementsTotal.value = data.total;
      movementOffset.value = data.movements.length;
    }
  },
);

async function loadMoreMovements() {
  try {
    const data = await getMovements(props.assetId, { limit: 50, offset: movementOffset.value });
    movementsList.value = [...movementsList.value, ...data.movements];
    movementOffset.value = movementsList.value.length;
  } catch {
    /* noop */
  }
}

const snapshots = computed(() => snapshotsApi.data.value?.snapshots ?? []);

// ─── Performance calculations ───
const currentValueNative = computed(() =>
  holdings.value.reduce((sum, h) => sum + h.currentValue, 0),
);

const displayCurrentValue = computed(() =>
  showingIls.value ? (asset.value?.totalValueIls ?? 0) : currentValueNative.value,
);

// Account-level P&L from backend (always ILS)
const totalReturnIls = computed(() => asset.value?.totalReturnIls);
const totalInvestedIls = computed(() => asset.value?.totalInvestedIls);
const returnPct = computed(() => {
  if (
    totalInvestedIls.value == null ||
    totalInvestedIls.value === 0 ||
    totalReturnIls.value == null
  )
    return null;
  return (totalReturnIls.value / totalInvestedIls.value) * 100;
});

// ─── Asset type styling ───
const typeColor = computed(() => ASSET_TYPE_COLORS[asset.value?.type ?? ''] ?? '#71717a');
const typeLabel = computed(
  () => ASSET_TYPE_LABELS[asset.value?.type ?? ''] ?? asset.value?.type ?? '',
);
const typeBadgeStyle = computed(() => ({
  backgroundColor: typeColor.value + '1a',
  color: typeColor.value,
}));
const liquidityClass = computed(() => LIQUIDITY_STYLES[asset.value?.liquidity ?? ''] ?? '');
const liquidityLabel = computed(
  () => LIQUIDITY_LABELS[asset.value?.liquidity ?? ''] ?? asset.value?.liquidity ?? '',
);

// ─── Movement type badge classes ───
const MOVEMENT_BADGE_CLASSES: Record<string, string> = {
  deposit: 'bg-success/10 text-success',
  withdrawal: 'bg-destructive/10 text-destructive',
  buy: 'bg-primary/10 text-primary',
  sell: 'bg-[var(--warning)]/10 text-[var(--warning)]',
  dividend: 'bg-cyan-500/10 text-cyan-500',
};

const BROKERAGE_MOVEMENT_TYPES = ['deposit', 'withdrawal', 'buy', 'sell', 'dividend'];

function movementBadgeClass(type: string) {
  return MOVEMENT_BADGE_CLASSES[type] ?? 'bg-muted text-text-secondary';
}

function formatMovementDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Chart ───
const chartLabels = computed(() =>
  snapshots.value.map((s) => {
    const d = new Date(s.date);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }),
);

const chartDatasets = computed(() => {
  if (snapshots.value.length === 0) return null;
  return [
    {
      label: showingIls.value ? 'Value (ILS)' : `Value (${assetCurrency.value})`,
      data: snapshots.value.map((s) =>
        showingIls.value ? s.totalValueIls : (s.totalValue ?? s.totalValueIls),
      ),
      color: chartPrimary.value,
    },
  ];
});

const yAxisFormatter = computed(() => {
  const cur = showingIls.value ? 'ILS' : assetCurrency.value;
  const sym = CURRENCY_SYMBOLS[cur] ?? cur + ' ';
  return (v: number) => {
    if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}K`;
    return `${sym}${v}`;
  };
});

const tooltipFmt = computed(() => {
  const currency = showingIls.value ? 'ILS' : assetCurrency.value;
  return (v: number) => formatAmount(v, currency);
});

// ─── Holding Dialog ───
const showHoldingDialog = ref(false);
const editingHolding = ref<Holding | null>(null);
const holdingForm = ref({
  name: '',
  type: 'stock',
  currency: 'ILS',
  quantity: 0,
  costBasis: 0,
  lastPrice: null as number | null,
  notes: '',
});
const holdingSaving = ref(false);

function openAddHolding() {
  editingHolding.value = null;
  holdingForm.value = {
    name: '',
    type: 'stock',
    currency: 'ILS',
    quantity: 0,
    costBasis: 0,
    lastPrice: null,
    notes: '',
  };
  showHoldingDialog.value = true;
}

function openEditHolding(h: Holding) {
  editingHolding.value = h;
  holdingForm.value = {
    name: h.name,
    type: h.type,
    currency: h.currency,
    quantity: h.quantity,
    costBasis: h.costBasis,
    lastPrice: h.lastPrice,
    notes: h.notes ?? '',
  };
  showHoldingDialog.value = true;
}

async function saveHolding() {
  holdingSaving.value = true;
  try {
    if (editingHolding.value) {
      await updateHolding(editingHolding.value.id, {
        quantity: holdingForm.value.quantity,
        costBasis: holdingForm.value.costBasis,
        lastPrice: holdingForm.value.lastPrice,
        notes: holdingForm.value.notes || null,
      });
    } else {
      await createHolding(props.assetId, {
        name: holdingForm.value.name,
        type: holdingForm.value.type,
        currency: holdingForm.value.currency,
        quantity: holdingForm.value.quantity,
        costBasis: holdingForm.value.costBasis,
        lastPrice: holdingForm.value.lastPrice ?? undefined,
        notes: holdingForm.value.notes || undefined,
      });
    }
    showHoldingDialog.value = false;
    await refreshAll();
  } catch {
    /* noop */
  } finally {
    holdingSaving.value = false;
  }
}

// ─── Delete Holding ───
const holdingToDelete = ref<Holding | null>(null);
const deletingHolding = ref(false);

async function confirmDeleteHolding() {
  const target = holdingToDelete.value;
  if (!target) return;
  holdingToDelete.value = null;
  deletingHolding.value = true;
  try {
    await deleteHolding(target.id);
    await refreshAll();
  } catch {
    /* noop */
  } finally {
    deletingHolding.value = false;
  }
}

// ─── Quick Update ───
const quickUpdateMode = ref(false);
const editedHoldings = ref(new Map<number, { quantity: number; lastPrice: number | null }>());
const savingQuick = ref(false);

function startQuickUpdate() {
  quickUpdateMode.value = true;
  editedHoldings.value.clear();
  for (const h of holdings.value) {
    editedHoldings.value.set(h.id, { quantity: h.quantity, lastPrice: h.lastPrice });
  }
}

function cancelQuickUpdate() {
  quickUpdateMode.value = false;
  editedHoldings.value.clear();
}

async function saveQuickUpdate() {
  savingQuick.value = true;
  try {
    const promises: Promise<void>[] = [];
    for (const h of holdings.value) {
      const edited = editedHoldings.value.get(h.id);
      if (!edited) continue;
      const dirty = edited.quantity !== h.quantity || edited.lastPrice !== h.lastPrice;
      if (!dirty) continue;
      const data: { quantity?: number; lastPrice?: number | null } = {};
      if (edited.quantity !== h.quantity) data.quantity = edited.quantity;
      if (edited.lastPrice !== h.lastPrice) data.lastPrice = edited.lastPrice;
      promises.push(updateHolding(h.id, data).then(() => {}));
    }
    await Promise.all(promises);
    quickUpdateMode.value = false;
    editedHoldings.value.clear();
    await refreshAll();
  } finally {
    savingQuick.value = false;
  }
}

// ─── Movement Dialog ───
const showMovementDialog = ref(false);
const movementForm = ref({
  date: new Date().toISOString().slice(0, 10),
  type: 'buy',
  holdingId: 'none',
  quantity: 0,
  currency: 'ILS',
  pricePerUnit: null as number | null,
  sourceAmount: null as number | null,
  sourceCurrency: 'ILS',
  notes: '',
});
const movementSaving = ref(false);
const movementError = ref<string | null>(null);

function openAddMovement() {
  movementForm.value = {
    date: new Date().toISOString().slice(0, 10),
    type: 'buy',
    holdingId: 'none',
    quantity: 0,
    currency: assetCurrency.value,
    pricePerUnit: null,
    sourceAmount: null,
    sourceCurrency: isNonIls.value ? 'ILS' : '',
    notes: '',
  };
  movementError.value = null;
  showMovementDialog.value = true;
}

const selectedHolding = computed(() => {
  if (movementForm.value.holdingId === 'none') return null;
  return holdings.value.find((h) => h.id === Number(movementForm.value.holdingId)) ?? null;
});

const showPricePerUnit = computed(() => {
  const h = selectedHolding.value;
  if (!h) return false;
  return (
    (movementForm.value.type === 'buy' || movementForm.value.type === 'sell') &&
    ['stock', 'etf', 'crypto'].includes(h.type)
  );
});

const quantityLabel = computed(() => {
  const t = movementForm.value.type;
  if (t === 'buy' || t === 'deposit' || t === 'dividend') return 'Quantity (positive)';
  if (t === 'sell' || t === 'withdrawal') return 'Quantity (how much to remove)';
  return 'Quantity (+/-)';
});

const sellMaxWarning = computed(() => {
  if (movementForm.value.type !== 'sell') return null;
  const h = selectedHolding.value;
  if (!h) return null;
  if (movementForm.value.quantity > h.quantity) {
    return `Max available: ${h.quantity}`;
  }
  return null;
});

// Auto-fill currency when holding changes
watch(
  () => movementForm.value.holdingId,
  (val) => {
    if (val !== 'none') {
      const h = holdings.value.find((x) => x.id === Number(val));
      if (h) movementForm.value.currency = h.currency;
    }
  },
);

async function saveMovement() {
  movementSaving.value = true;
  movementError.value = null;
  try {
    const isNegativeType =
      movementForm.value.type === 'sell' || movementForm.value.type === 'withdrawal';
    const quantity = isNegativeType
      ? -Math.abs(movementForm.value.quantity)
      : Math.abs(movementForm.value.quantity);

    let sourceAmount = movementForm.value.sourceAmount ?? undefined;
    let sourceCurrency = movementForm.value.sourceCurrency || undefined;
    if (isNonIls.value && sourceAmount != null) {
      sourceCurrency = 'ILS';
    }

    await createMovement(props.assetId, {
      holdingId:
        movementForm.value.holdingId !== 'none' ? Number(movementForm.value.holdingId) : undefined,
      date: movementForm.value.date,
      type: movementForm.value.type,
      quantity,
      currency: movementForm.value.currency,
      pricePerUnit:
        showPricePerUnit.value && movementForm.value.pricePerUnit != null
          ? movementForm.value.pricePerUnit
          : undefined,
      sourceAmount,
      sourceCurrency,
      notes: movementForm.value.notes || undefined,
    });
    showMovementDialog.value = false;
    await refreshAll();
  } catch (err) {
    movementError.value = err instanceof Error ? err.message : 'Failed to save';
  } finally {
    movementSaving.value = false;
  }
}

// ─── Delete Movement ───
const movementToDelete = ref<Movement | null>(null);
const deletingMovement = ref(false);
const deleteMovementError = ref<string | null>(null);

async function confirmDeleteMovement() {
  const target = movementToDelete.value;
  if (!target) return;
  movementToDelete.value = null;
  deletingMovement.value = true;
  deleteMovementError.value = null;
  try {
    await deleteMovement(target.id);
    await refreshAll();
  } catch (err) {
    deleteMovementError.value = err instanceof Error ? err.message : 'Failed to delete';
  } finally {
    deletingMovement.value = false;
  }
}
</script>

<template>
  <div class="asset-view min-w-0 animate-fade-in-up">
    <!-- Loading skeleton for header -->
    <div v-if="assetApi.loading.value && !asset">
      <Skeleton class="h-8 w-64 mb-2" />
      <Skeleton class="h-5 w-32" />
    </div>

    <!-- Error state -->
    <div v-else-if="assetApi.error.value" class="text-center py-12">
      <p class="text-destructive text-[14px]">{{ assetApi.error.value }}</p>
      <Button variant="secondary" size="sm" class="mt-4" @click="assetApi.execute()">{{
        t('retry')
      }}</Button>
    </div>

    <template v-else-if="asset">
      <!-- Asset header -->
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-[28px] font-semibold tracking-tight break-words">{{ asset.name }}</h1>
          <div class="flex flex-wrap items-center gap-2 mt-1">
            <Badge :style="typeBadgeStyle">{{ typeLabel }}</Badge>
            <span v-if="asset.institution" class="text-[14px] text-text-secondary">{{
              asset.institution
            }}</span>
            <Badge :class="liquidityClass">{{ liquidityLabel }}</Badge>
          </div>
        </div>
        <Button
          v-if="isNonIls"
          variant="secondary"
          size="sm"
          @click="displayCurrency = displayCurrency === 'native' ? 'ILS' : 'native'"
        >
          {{ showingIls ? assetCurrency : 'ILS' }}
        </Button>
      </div>

      <!-- Performance summary -->
      <div class="asset-metrics grid grid-cols-1 md:grid-cols-3 gap-4">
        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.current }}</h2>
          </header>
          <div class="asset-metric-value">
            <div class="text-[22px] font-semibold tabular-nums">
              {{ formatAmount(displayCurrentValue, showingIls ? 'ILS' : assetCurrency) }}
            </div>
          </div>
        </section>

        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.invested }}</h2>
          </header>
          <div class="asset-metric-value">
            <div v-if="totalInvestedIls != null" class="text-[22px] font-semibold tabular-nums">
              {{ formatAmount(totalInvestedIls, 'ILS') }}
            </div>
            <div v-else class="text-[14px] text-text-secondary">{{ copy.noData }}</div>
          </div>
        </section>

        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.return }}</h2>
          </header>
          <div class="asset-metric-value">
            <template v-if="totalReturnIls != null">
              <div
                :class="totalReturnIls >= 0 ? 'text-success' : 'text-destructive'"
                class="text-[22px] font-semibold tabular-nums"
                dir="ltr"
              >
                {{ totalReturnIls >= 0 ? '+' : '−' }}{{ formatAmount(totalReturnIls, 'ILS') }}
              </div>
              <div v-if="returnPct != null" class="flex items-center gap-1 mt-0.5">
                <component
                  :is="totalReturnIls >= 0 ? TrendingUp : TrendingDown"
                  class="h-3.5 w-3.5"
                  :class="totalReturnIls >= 0 ? 'text-success' : 'text-destructive'"
                />
                <span
                  :class="totalReturnIls >= 0 ? 'text-success' : 'text-destructive'"
                  class="text-[14px]"
                >
                  {{ returnPct >= 0 ? '+' : '' }}{{ returnPct.toFixed(1) }}%
                </span>
              </div>
            </template>
            <div v-else class="text-[14px] text-text-secondary">{{ copy.noData }}</div>
          </div>
        </section>
      </div>

      <!-- Holdings table -->
      <section class="finance-section">
        <header class="finance-section-heading">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-[20px]">{{ copy.holdings }}</h2>
            <div class="flex flex-wrap items-center gap-2">
              <template v-if="quickUpdateMode">
                <Button variant="secondary" size="sm" @click="cancelQuickUpdate">{{
                  copy.cancel
                }}</Button>
                <Button size="sm" :disabled="savingQuick" @click="saveQuickUpdate">
                  <Loader2 v-if="savingQuick" class="h-3.5 w-3.5 mr-1 animate-spin" />
                  {{ copy.save }}
                </Button>
              </template>
              <template v-else>
                <Button
                  v-if="holdings.length > 0"
                  variant="secondary"
                  size="sm"
                  @click="startQuickUpdate"
                >
                  <RefreshCw class="h-3.5 w-3.5 mr-1" />
                  {{ copy.update }}
                </Button>
                <Button size="sm" @click="openAddHolding">
                  <Plus class="h-4 w-4 mr-1" />
                  {{ copy.add }}
                </Button>
              </template>
            </div>
          </div>
        </header>
        <div class="finance-section-content finance-section-ledger">
          <!-- Loading -->
          <div v-if="assetApi.loading.value && holdings.length === 0" class="space-y-3">
            <Skeleton class="h-10 w-full" />
            <Skeleton class="h-10 w-full" />
            <Skeleton class="h-10 w-full" />
          </div>

          <!-- Empty -->
          <div v-else-if="holdings.length === 0" class="text-center py-8">
            <p class="text-text-secondary text-[14px]">{{ copy.noHoldings }}</p>
            <Button size="sm" class="mt-2" @click="openAddHolding">
              <Plus class="h-4 w-4 mr-1" />
              {{ copy.addFirst }}
            </Button>
          </div>

          <!-- Table (desktop) -->
          <div
            v-else
            :class="quickUpdateMode ? 'block overflow-x-auto' : 'hidden md:block overflow-x-auto'"
          >
            <Table class="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{{ copy.name }}</TableHead>
                  <TableHead class="hidden md:table-cell">{{ copy.type }}</TableHead>
                  <TableHead class="text-right">{{ copy.quantity }}</TableHead>
                  <TableHead class="text-right">{{ copy.price }}</TableHead>
                  <TableHead class="text-right">{{ copy.value }}</TableHead>
                  <TableHead class="text-right hidden lg:table-cell">{{ copy.cost }}</TableHead>
                  <TableHead class="text-right">{{ copy.pnl }}</TableHead>
                  <TableHead class="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="h in holdings" :key="h.id" class="group">
                  <TableCell class="font-medium text-[14px]">
                    {{ h.name }}
                    <div v-if="h.stale" class="flex items-center gap-1 text-text-secondary mt-0.5">
                      <AlertCircle class="h-3.5 w-3.5 text-[var(--warning)]" />
                      <span class="text-[12px]">{{ copy.noPrice }}</span>
                    </div>
                  </TableCell>
                  <TableCell class="hidden md:table-cell">
                    <Badge variant="outline" class="text-[12px]">{{
                      HOLDING_TYPE_LABELS[h.type] ?? h.type
                    }}</Badge>
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-[14px]">
                    <template v-if="quickUpdateMode">
                      <Input
                        :aria-label="`${language === 'he' ? 'כמות' : 'Quantity'}: ${h.name}`"
                        type="number"
                        class="w-24 text-right ml-auto"
                        :model-value="editedHoldings.get(h.id)?.quantity"
                        @update:model-value="
                          (v: string | number) => {
                            const m = editedHoldings.get(h.id);
                            if (m) m.quantity = Number(v);
                          }
                        "
                      />
                    </template>
                    <template v-else>{{ h.quantity.toLocaleString() }}</template>
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-[14px] text-text-secondary">
                    <template v-if="quickUpdateMode">
                      <Input
                        :aria-label="`${language === 'he' ? 'מחיר ליחידה' : 'Price per unit'}: ${h.name}`"
                        type="number"
                        class="w-24 text-right ml-auto"
                        :model-value="editedHoldings.get(h.id)?.lastPrice ?? ''"
                        @update:model-value="
                          (v: string | number) => {
                            const m = editedHoldings.get(h.id);
                            if (m) m.lastPrice = v === '' ? null : Number(v);
                          }
                        "
                      />
                    </template>
                    <template v-else>
                      <span v-if="h.type === 'cash' || h.type === 'balance'">-</span>
                      <span v-else-if="h.lastPrice != null"
                        >{{ h.currency }} {{ h.lastPrice.toLocaleString() }}</span
                      >
                      <span v-else>-</span>
                    </template>
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-[14px] font-medium">
                    {{
                      showingIls
                        ? formatCurrency(h.currentValueIls)
                        : formatAmount(h.currentValue, h.currency)
                    }}
                  </TableCell>
                  <!-- Cost basis — always native currency -->
                  <TableCell
                    class="text-right tabular-nums text-[14px] text-text-secondary hidden lg:table-cell"
                  >
                    {{ formatAmount(h.costBasis, h.currency) }}
                  </TableCell>
                  <!-- P&L — always native currency, never ILS -->
                  <TableCell class="text-right">
                    <div v-if="h.gainLoss != null">
                      <span
                        :class="h.gainLoss >= 0 ? 'text-success' : 'text-destructive'"
                        class="text-[14px] tabular-nums font-medium"
                        dir="ltr"
                      >
                        {{ h.gainLoss >= 0 ? '+' : '−' }}{{ formatAmount(h.gainLoss, h.currency) }}
                      </span>
                      <span
                        v-if="h.gainLossPercent != null"
                        :class="h.gainLossPercent >= 0 ? 'text-success' : 'text-destructive'"
                        class="text-[12px] block"
                      >
                        {{ h.gainLossPercent >= 0 ? '+' : '' }}{{ h.gainLossPercent.toFixed(1) }}%
                      </span>
                    </div>
                    <span v-else class="text-text-secondary text-[14px]">-</span>
                  </TableCell>
                  <TableCell>
                    <div v-if="!quickUpdateMode" class="flex gap-1 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="w-7"
                        :aria-label="language === 'he' ? 'עריכה' : 'Edit'"
                        @click="openEditHolding(h)"
                      >
                        <Pencil class="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="w-7"
                        :aria-label="language === 'he' ? 'מחיקה' : 'Delete'"
                        @click="holdingToDelete = h"
                      >
                        <Trash2 class="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <!-- Mobile holdings ledger -->
          <div
            v-if="holdings.length > 0 && !quickUpdateMode"
            class="finance-ledger md:hidden divide-y divide-separator"
          >
            <div v-for="h in holdings" :key="h.id" class="finance-ledger-row">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="font-medium text-[14px]">{{ h.name }}</span>
                <Badge variant="outline" class="text-[12px]">{{
                  HOLDING_TYPE_LABELS[h.type] ?? h.type
                }}</Badge>
              </div>
              <div v-if="h.quantity" class="text-[12px] text-text-secondary mt-1">
                {{ h.quantity.toLocaleString() }}
                {{ h.type === 'stock' || h.type === 'etf' ? 'shares' : 'units' }}
                <span v-if="h.lastPrice">
                  @ {{ h.currency }} {{ h.lastPrice.toLocaleString() }}</span
                >
              </div>
              <div class="flex items-center justify-between mt-1">
                <span class="text-[14px] font-medium">{{
                  showingIls
                    ? formatCurrency(h.currentValueIls)
                    : formatAmount(h.currentValue, h.currency)
                }}</span>
                <span
                  v-if="h.gainLossPercent != null"
                  :class="h.gainLossPercent >= 0 ? 'text-success' : 'text-destructive'"
                  class="text-[12px]"
                >
                  {{ h.gainLossPercent >= 0 ? '+' : '' }}{{ h.gainLossPercent.toFixed(1) }}%
                </span>
              </div>
              <div class="flex gap-2 mt-3">
                <Button variant="secondary" size="sm" @click="openEditHolding(h)"
                  ><Pencil class="h-3.5 w-3.5" />{{ language === 'he' ? 'עריכה' : 'Edit' }}</Button
                >
                <Button variant="ghost" size="sm" @click="holdingToDelete = h"
                  ><Trash2 class="h-3.5 w-3.5 text-destructive" />{{
                    language === 'he' ? 'מחיקה' : 'Delete'
                  }}</Button
                >
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Value over time chart -->
      <section class="finance-section">
        <header class="finance-section-heading">
          <h2 class="text-[20px]">{{ copy.history }}</h2>
        </header>
        <div class="finance-section-content">
          <div v-if="snapshotsApi.loading.value && !chartDatasets">
            <Skeleton class="h-48 w-full rounded-md" />
          </div>
          <div v-else-if="chartDatasets" class="h-48">
            <EChartsLineChart
              :labels="chartLabels"
              :datasets="chartDatasets"
              :y-axis-formatter="yAxisFormatter"
              :tooltip-formatter="tooltipFmt"
            />
          </div>
          <div v-else class="text-[14px] text-text-secondary text-center py-12">
            {{ copy.noHistory }}
          </div>
        </div>
      </section>

      <!-- Movement history -->
      <div class="finance-section space-y-4">
        <div class="finance-movement-heading flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-[20px] font-semibold">{{ copy.movements }}</h2>
          <Button size="sm" @click="openAddMovement">
            <Plus class="h-4 w-4 mr-1" />
            {{ copy.addMovement }}
          </Button>
        </div>

        <div v-if="movementsApi.loading.value && movementsList.length === 0" class="space-y-3">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>

        <div v-else-if="movementsList.length === 0" class="text-center py-8">
          <p class="text-text-secondary text-[14px]">
            No movements recorded yet. Add a movement to track your investment history.
          </p>
          <Button size="sm" class="mt-2" @click="openAddMovement">
            <Plus class="h-4 w-4 mr-1" />
            Add Movement
          </Button>
        </div>

        <div v-else class="finance-ledger divide-y divide-separator">
          <div v-for="m in movementsList" :key="m.id" class="finance-ledger-row group">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <Badge :class="movementBadgeClass(m.type)">{{ m.type }}</Badge>
                  <span class="text-[14px] text-text-secondary">{{
                    m.holdingName ?? 'General'
                  }}</span>
                </div>
                <div class="text-[14px] font-medium mt-1 tabular-nums">
                  {{ m.quantity > 0 ? '+' : '' }}{{ m.quantity.toLocaleString() }} {{ m.currency }}
                  <span v-if="m.pricePerUnit" class="text-text-secondary">
                    @ {{ m.pricePerUnit.toLocaleString() }}/unit
                  </span>
                </div>
                <div v-if="m.sourceAmount" class="text-[12px] text-text-secondary mt-0.5">
                  Source: {{ formatCurrency(m.sourceAmount) }} {{ m.sourceCurrency }}
                </div>
                <p v-if="m.notes" class="text-[12px] text-text-secondary mt-0.5 italic">
                  {{ m.notes }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[12px] text-text-secondary">{{
                  formatMovementDate(m.date)
                }}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  class="w-7 transition-opacity"
                  :aria-label="language === 'he' ? 'מחיקה' : 'Delete'"
                  @click="movementToDelete = m"
                >
                  <Trash2 class="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Button
          v-if="hasMoreMovements"
          variant="secondary"
          class="w-full"
          @click="loadMoreMovements"
        >
          Load More
        </Button>
      </div>
    </template>

    <!-- Holding Dialog -->
    <Dialog v-model:open="showHoldingDialog">
      <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingHolding ? 'Edit Holding' : 'Add Holding' }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div v-if="!editingHolding">
            <label for="brokerage-detail-field-1" class="text-[14px] font-medium">Name</label>
            <Input
              id="brokerage-detail-field-1"
              v-model="holdingForm.name"
              placeholder="e.g. TSLA, kaspit"
            />
          </div>
          <div v-if="!editingHolding">
            <label for="brokerage-detail-field-2" class="text-[14px] font-medium">Type</label>
            <Select v-model="holdingForm.type">
              <SelectTrigger id="brokerage-detail-field-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, key) in HOLDING_TYPE_LABELS" :key="key" :value="key">{{
                  label
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="!editingHolding">
            <label for="brokerage-detail-field-3" class="text-[14px] font-medium">Currency</label>
            <Input id="brokerage-detail-field-3" v-model="holdingForm.currency" placeholder="USD" />
          </div>
          <div>
            <label for="brokerage-detail-field-4" class="text-[14px] font-medium">Quantity</label>
            <Input
              id="brokerage-detail-field-4"
              v-model.number="holdingForm.quantity"
              type="number"
            />
          </div>
          <div>
            <label for="brokerage-detail-field-5" class="text-[14px] font-medium">Cost Basis</label>
            <Input
              id="brokerage-detail-field-5"
              v-model.number="holdingForm.costBasis"
              type="number"
            />
          </div>
          <div>
            <label for="brokerage-detail-field-6" class="text-[14px] font-medium">Last Price</label>
            <Input
              id="brokerage-detail-field-6"
              :model-value="holdingForm.lastPrice ?? ''"
              type="number"
              @update:model-value="
                (v: string | number) => (holdingForm.lastPrice = v === '' ? null : Number(v))
              "
            />
          </div>
          <div>
            <label for="brokerage-detail-field-7" class="text-[14px] font-medium">Notes</label>
            <Textarea id="brokerage-detail-field-7" v-model="holdingForm.notes" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="filled"
            :disabled="holdingSaving || (!editingHolding && !holdingForm.name)"
            @click="saveHolding"
          >
            <Loader2 v-if="holdingSaving" class="h-4 w-4 mr-1 animate-spin" />
            {{ editingHolding ? 'Save' : 'Add Holding' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Holding Confirm -->
    <AlertDialog
      :open="!!holdingToDelete"
      @update:open="
        (v: boolean) => {
          if (!v) holdingToDelete = null;
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete holding?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove "{{ holdingToDelete?.name }}" from this asset. Related
            movement records will be preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="holdingToDelete = null">Cancel</AlertDialogCancel>
          <Button
            variant="destructive-filled"
            :disabled="deletingHolding"
            @click="confirmDeleteHolding"
          >
            <Loader2 v-if="deletingHolding" class="h-4 w-4 mr-1 animate-spin" />
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Movement Dialog -->
    <Dialog v-model:open="showMovementDialog">
      <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Movement</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label for="brokerage-detail-field-8" class="text-[14px] font-medium">Date</label>
            <Input id="brokerage-detail-field-8" v-model="movementForm.date" type="date" />
          </div>
          <div>
            <label for="brokerage-detail-field-9" class="text-[14px] font-medium">Type</label>
            <Select v-model="movementForm.type">
              <SelectTrigger id="brokerage-detail-field-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="t in BROKERAGE_MOVEMENT_TYPES" :key="t" :value="t">{{
                  t
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label for="brokerage-detail-field-10" class="text-[14px] font-medium"
              >Holding (optional)</label
            >
            <Select v-model="movementForm.holdingId">
              <SelectTrigger id="brokerage-detail-field-10"
                ><SelectValue placeholder="General (no holding)"
              /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">General (no holding)</SelectItem>
                <SelectItem v-for="h in holdings" :key="h.id" :value="String(h.id)">{{
                  h.name
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label for="brokerage-detail-field-11" class="text-[14px] font-medium">{{
              quantityLabel
            }}</label>
            <Input
              id="brokerage-detail-field-11"
              v-model.number="movementForm.quantity"
              type="number"
            />
            <p v-if="sellMaxWarning" class="text-[12px] text-[var(--warning)] mt-1">
              {{ sellMaxWarning }}
            </p>
          </div>
          <div>
            <label for="brokerage-detail-field-12" class="text-[14px] font-medium">Currency</label>
            <Input id="brokerage-detail-field-12" v-model="movementForm.currency" />
          </div>
          <div v-if="showPricePerUnit">
            <label for="brokerage-detail-field-13" class="text-[14px] font-medium"
              >Price per Unit</label
            >
            <Input
              id="brokerage-detail-field-13"
              :model-value="movementForm.pricePerUnit ?? ''"
              type="number"
              @update:model-value="
                (v: string | number) => (movementForm.pricePerUnit = v === '' ? null : Number(v))
              "
            />
          </div>
          <template v-if="isNonIls">
            <div>
              <label for="brokerage-detail-field-14" class="text-[14px] font-medium"
                >ILS Cost Basis (optional)</label
              >
              <Input
                id="brokerage-detail-field-14"
                :model-value="movementForm.sourceAmount ?? ''"
                type="number"
                placeholder="What you paid in ILS"
                @update:model-value="
                  (v: string | number) => (movementForm.sourceAmount = v === '' ? null : Number(v))
                "
              />
              <p class="text-[12px] text-text-secondary mt-1">
                Leave empty if unknown or paid in {{ assetCurrency }}
              </p>
            </div>
          </template>
          <template v-else>
            <div>
              <label for="brokerage-detail-field-15" class="text-[14px] font-medium"
                >Source Amount (what you paid)</label
              >
              <Input
                id="brokerage-detail-field-15"
                :model-value="movementForm.sourceAmount ?? ''"
                type="number"
                @update:model-value="
                  (v: string | number) => (movementForm.sourceAmount = v === '' ? null : Number(v))
                "
              />
            </div>
            <div>
              <label for="brokerage-detail-field-16" class="text-[14px] font-medium"
                >Source Currency</label
              >
              <Input id="brokerage-detail-field-16" v-model="movementForm.sourceCurrency" />
            </div>
          </template>
          <div>
            <label for="brokerage-detail-field-17" class="text-[14px] font-medium">Notes</label>
            <Textarea id="brokerage-detail-field-17" v-model="movementForm.notes" maxlength="500" />
          </div>
          <p v-if="movementError" class="text-[14px] text-destructive">{{ movementError }}</p>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="filled"
            :disabled="movementSaving || !movementForm.quantity"
            @click="saveMovement"
          >
            <Loader2 v-if="movementSaving" class="h-4 w-4 mr-1 animate-spin" />
            Record Movement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Movement Confirm -->
    <AlertDialog
      :open="!!movementToDelete"
      @update:open="
        (v: boolean) => {
          if (!v) {
            movementToDelete = null;
            deleteMovementError = null;
          }
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete movement?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove the {{ movementToDelete?.type }} movement from
            {{ formatMovementDate(movementToDelete?.date ?? '') }}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="deleteMovementError" class="text-[14px] text-destructive px-6">
          {{ deleteMovementError }}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel
            @click="
              movementToDelete = null;
              deleteMovementError = null;
            "
            >Cancel</AlertDialogCancel
          >
          <Button
            variant="destructive-filled"
            :disabled="deletingMovement"
            @click="confirmDeleteMovement"
          >
            <Loader2 v-if="deletingMovement" class="h-4 w-4 mr-1 animate-spin" />
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
