<script setup lang="ts">
import { useChartTheme } from '@/composables/useChartTheme';
import { ref, computed, onMounted, watch } from 'vue';
import EChartsLineChart from '@/components/EChartsLineChart.vue';
import {
  getAsset,
  getMovements,
  getAssetSnapshots,
  createHolding,
  updateHolding,
  deleteHolding,
  createMovement,
  deleteMovement,
  type Asset,
  type Holding,
  type Movement,
  type AssetSnapshot,
} from '@/api/client';
import { useApi } from '@/composables/useApi';
import { formatCurrency } from '@/lib/format';
import { language, t } from '@/lib/language';
import { HOLDING_TYPE_LABELS } from '@/lib/net-worth-constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-vue-next';

const { chartPrimary } = useChartTheme();

const props = defineProps<{ assetId: number; initialAsset: Asset }>();
const copy = computed(() =>
  language.value === 'he'
    ? {
        type: 'קריפטו',
        value: 'שווי כולל (₪)',
        invested: 'סך השקעה',
        return: 'תשואה כוללת',
        noData: 'אין נתונים',
        holdings: 'החזקות מטבעות',
        cancel: 'ביטול',
        save: 'שמירה',
        update: 'עדכון ערכים',
        history: 'שווי לאורך זמן',
        historyHint: 'עדכנו החזקות כדי להתחיל לבנות היסטוריית שווי',
        movements: 'היסטוריית קנייה ומכירה',
        addMovement: 'הוספת תנועה',
      }
    : {
        type: 'Crypto',
        value: 'Total value (ILS)',
        invested: 'Total invested',
        return: 'Total return',
        noData: 'No data',
        holdings: 'Coin holdings',
        cancel: 'Cancel',
        save: 'Save',
        update: 'Update values',
        history: 'Value over time',
        historyHint: 'Update holdings to start building value history',
        movements: 'Buy / sell history',
        addMovement: 'Add movement',
      },
);

// ── Data fetching ──
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

const asset = computed(() => assetApi.data.value ?? props.initialAsset);
const holdings = computed(() => asset.value?.holdings ?? []);
const movements = computed(() => movementsApi.data.value?.movements ?? []);
const snapshots = computed(() => snapshotsApi.data.value?.snapshots ?? []);

// ── Performance ──
const totalReturn = computed(() => {
  const ret = asset.value?.totalReturnIls;
  if (ret == null || !asset.value?.totalInvestedIls) return null;
  const pct = (ret / asset.value.totalInvestedIls) * 100;
  return { amount: ret, pct };
});

// ── Movement helpers ──
const CRYPTO_MOVEMENT_TYPES = ['buy', 'sell'];

const MOVEMENT_BADGE_CLASSES: Record<string, string> = {
  buy: 'bg-primary/10 text-primary',
  sell: 'bg-[var(--warning)]/10 text-[var(--warning)]',
};

const buySellMovements = computed(() =>
  movements.value.filter((m) => m.type === 'buy' || m.type === 'sell'),
);

function formatMovementDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Quick Update ──
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

// ── Holding Dialog ──
const showHoldingDialog = ref(false);
const holdingForm = ref({
  name: '',
  currency: 'BTC',
  quantity: 0,
  costBasis: 0,
  lastPrice: null as number | null,
});
const holdingSaving = ref(false);

function openAddHolding() {
  holdingForm.value = { name: '', currency: 'BTC', quantity: 0, costBasis: 0, lastPrice: null };
  showHoldingDialog.value = true;
}

async function saveHolding() {
  holdingSaving.value = true;
  try {
    await createHolding(props.assetId, {
      name: holdingForm.value.name,
      type: 'crypto',
      currency: holdingForm.value.currency,
      quantity: holdingForm.value.quantity,
      costBasis: holdingForm.value.costBasis,
      lastPrice: holdingForm.value.lastPrice ?? undefined,
    });
    showHoldingDialog.value = false;
    await refreshAll();
  } catch {
    /* noop */
  } finally {
    holdingSaving.value = false;
  }
}

// ── Delete Holding ──
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

// ── Movement Dialog ──
const showMovementDialog = ref(false);
const movementForm = ref({
  date: new Date().toISOString().slice(0, 10),
  type: 'buy',
  holdingId: 'none',
  quantity: 0,
  currency: 'ILS',
  pricePerUnit: null as number | null,
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
    currency: 'ILS',
    pricePerUnit: null,
    notes: '',
  };
  movementError.value = null;
  showMovementDialog.value = true;
}

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
    const isSell = movementForm.value.type === 'sell';
    const quantity = isSell
      ? -Math.abs(movementForm.value.quantity)
      : Math.abs(movementForm.value.quantity);

    await createMovement(props.assetId, {
      holdingId:
        movementForm.value.holdingId !== 'none' ? Number(movementForm.value.holdingId) : undefined,
      date: movementForm.value.date,
      type: movementForm.value.type,
      quantity,
      currency: movementForm.value.currency,
      pricePerUnit: movementForm.value.pricePerUnit ?? undefined,
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

// ── Delete Movement ──
const movementToDelete = ref<Movement | null>(null);
const deletingMovement = ref(false);

async function confirmDeleteMovement() {
  const target = movementToDelete.value;
  if (!target) return;
  movementToDelete.value = null;
  deletingMovement.value = true;
  try {
    await deleteMovement(target.id);
    await refreshAll();
  } catch {
    /* noop */
  } finally {
    deletingMovement.value = false;
  }
}

// ── Chart ──
const chartLabels = computed(() =>
  snapshots.value.map((s) => {
    const d = new Date(s.date);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }),
);

const chartDatasets = computed(() =>
  snapshots.value.length === 0
    ? null
    : [
        {
          label: 'Value (ILS)',
          data: snapshots.value.map((s) => s.totalValueIls),
          color: chartPrimary.value,
        },
      ],
);
</script>

<template>
  <div class="asset-view min-w-0 animate-fade-in-up">
    <!-- Loading skeleton -->
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
      <!-- Header -->
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight break-words">{{ asset.name }}</h1>
        <div class="flex flex-wrap items-center gap-2 mt-1">
          <span
            class="text-[12px] font-medium px-2 py-0.5 rounded-full bg-[var(--warning)]/10 text-[var(--warning)]"
            >{{ copy.type }}</span
          >
          <span v-if="asset.institution" class="text-[14px] text-text-secondary">{{
            asset.institution
          }}</span>
        </div>
      </div>

      <!-- Asset summary -->
      <div class="asset-metrics grid grid-cols-1 md:grid-cols-3 gap-4">
        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.value }}</h2>
          </header>
          <div class="asset-metric-value">
            <div class="text-[22px] font-semibold tabular-nums">
              {{ formatCurrency(asset.totalValueIls) }}
            </div>
          </div>
        </section>

        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.invested }}</h2>
          </header>
          <div class="asset-metric-value">
            <div
              v-if="asset.totalInvestedIls != null"
              class="text-[22px] font-semibold tabular-nums"
            >
              {{ formatCurrency(asset.totalInvestedIls) }}
            </div>
            <div v-else class="text-[14px] text-text-secondary">{{ copy.noData }}</div>
          </div>
        </section>

        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.return }}</h2>
          </header>
          <div class="asset-metric-value">
            <template v-if="totalReturn">
              <div
                :class="totalReturn.amount >= 0 ? 'text-success' : 'text-destructive'"
                class="text-[22px] font-semibold tabular-nums"
              >
                {{ totalReturn.amount >= 0 ? '+' : '-'
                }}{{ formatCurrency(Math.abs(totalReturn.amount)) }}
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                <component
                  :is="totalReturn.amount >= 0 ? TrendingUp : TrendingDown"
                  class="h-3.5 w-3.5"
                  :class="totalReturn.amount >= 0 ? 'text-success' : 'text-destructive'"
                />
                <span
                  :class="totalReturn.amount >= 0 ? 'text-success' : 'text-destructive'"
                  class="text-[14px]"
                >
                  {{ totalReturn.pct >= 0 ? '+' : '' }}{{ totalReturn.pct.toFixed(1) }}%
                </span>
              </div>
            </template>
            <div v-else class="text-[22px] font-semibold tabular-nums">
              {{ formatCurrency(asset.totalValueIls) }}
            </div>
          </div>
        </section>
      </div>

      <!-- Coin holdings table -->
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
                  Add Coin
                </Button>
              </template>
            </div>
          </div>
        </header>
        <div class="finance-section-content finance-section-ledger">
          <div v-if="assetApi.loading.value && holdings.length === 0" class="space-y-3">
            <Skeleton class="h-10 w-full" />
            <Skeleton class="h-10 w-full" />
          </div>

          <div v-else-if="holdings.length === 0" class="text-center py-8">
            <p class="text-text-secondary text-[14px]">No coins yet</p>
            <Button size="sm" class="mt-2" @click="openAddHolding">
              <Plus class="h-4 w-4 mr-1" />
              Add First Coin
            </Button>
          </div>

          <!-- Desktop table -->
          <div
            v-else
            :class="quickUpdateMode ? 'block overflow-x-auto' : 'hidden md:block overflow-x-auto'"
          >
            <Table class="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead class="text-right">Quantity</TableHead>
                  <TableHead class="text-right">Current Price (ILS)</TableHead>
                  <TableHead class="text-right">Value (ILS)</TableHead>
                  <TableHead class="text-right hidden lg:table-cell">Cost Basis</TableHead>
                  <TableHead class="text-right">P&amp;L</TableHead>
                  <TableHead class="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="h in holdings" :key="h.id" class="group">
                  <TableCell class="font-medium text-[14px]">
                    {{ h.name }}
                    <div v-if="h.stale" class="flex items-center gap-1 text-text-secondary mt-0.5">
                      <AlertCircle class="h-3.5 w-3.5 text-[var(--warning)]" />
                      <span class="text-[12px]">No price data</span>
                    </div>
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
                      <span v-if="h.quantity > 0">{{
                        formatCurrency(h.currentValueIls / h.quantity)
                      }}</span>
                      <span v-else>-</span>
                    </template>
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-[14px] font-medium">{{
                    formatCurrency(h.currentValueIls)
                  }}</TableCell>
                  <TableCell
                    class="text-right tabular-nums text-[14px] text-text-secondary hidden lg:table-cell"
                    >{{ formatCurrency(h.costBasis) }}</TableCell
                  >
                  <TableCell class="text-right">
                    <div v-if="h.gainLoss != null">
                      <span
                        :class="h.gainLoss >= 0 ? 'text-success' : 'text-destructive'"
                        class="text-[14px] tabular-nums font-medium"
                      >
                        {{ h.gainLoss >= 0 ? '+' : '' }}{{ formatCurrency(h.gainLoss) }}
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
                        class="h-7 w-7"
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
              <div class="text-[12px] text-text-secondary mt-1">
                {{ h.quantity.toLocaleString() }} units
                <span v-if="h.lastPrice != null"> @ {{ formatCurrency(h.lastPrice) }}</span>
              </div>
              <div class="flex items-center justify-between mt-1">
                <span class="text-[14px] font-medium">{{ formatCurrency(h.currentValueIls) }}</span>
                <span
                  v-if="h.gainLossPercent != null"
                  :class="h.gainLossPercent >= 0 ? 'text-success' : 'text-destructive'"
                  class="text-[12px]"
                >
                  {{ h.gainLossPercent >= 0 ? '+' : '' }}{{ h.gainLossPercent.toFixed(1) }}%
                </span>
              </div>
              <div class="flex gap-2 mt-3">
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
            <EChartsLineChart :labels="chartLabels" :datasets="chartDatasets" />
          </div>
          <div v-else class="text-[14px] text-text-secondary text-center py-12">
            {{ copy.historyHint }}
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

        <div v-if="movementsApi.loading.value && movements.length === 0" class="space-y-3">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>

        <div v-else-if="buySellMovements.length === 0" class="text-center py-8">
          <p class="text-text-secondary text-[14px]">No buy/sell movements recorded yet.</p>
        </div>

        <div v-else class="finance-ledger divide-y divide-separator">
          <div v-for="m in buySellMovements" :key="m.id" class="finance-ledger-row group">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <Badge
                    :class="MOVEMENT_BADGE_CLASSES[m.type] ?? 'bg-muted text-text-secondary'"
                    >{{ m.type }}</Badge
                  >
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
                  class="h-7 w-7 transition-opacity"
                  :aria-label="language === 'he' ? 'מחיקה' : 'Delete'"
                  @click="movementToDelete = m"
                >
                  <Trash2 class="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Add Coin Dialog -->
    <Dialog v-model:open="showHoldingDialog">
      <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Coin</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label for="crypto-detail-field-1" class="text-[14px] font-medium">Name</label>
            <Input
              id="crypto-detail-field-1"
              v-model="holdingForm.name"
              placeholder="e.g. Bitcoin, Ethereum"
            />
          </div>
          <div>
            <label for="crypto-detail-field-2" class="text-[14px] font-medium"
              >Currency / Ticker</label
            >
            <Input id="crypto-detail-field-2" v-model="holdingForm.currency" placeholder="BTC" />
          </div>
          <div>
            <label for="crypto-detail-field-3" class="text-[14px] font-medium">Quantity</label>
            <Input id="crypto-detail-field-3" v-model.number="holdingForm.quantity" type="number" />
          </div>
          <div>
            <label for="crypto-detail-field-4" class="text-[14px] font-medium"
              >Cost Basis (ILS)</label
            >
            <Input
              id="crypto-detail-field-4"
              v-model.number="holdingForm.costBasis"
              type="number"
            />
          </div>
          <div>
            <label for="crypto-detail-field-5" class="text-[14px] font-medium"
              >Last Price (ILS)</label
            >
            <Input
              id="crypto-detail-field-5"
              :model-value="holdingForm.lastPrice ?? ''"
              type="number"
              @update:model-value="
                (v: string | number) => (holdingForm.lastPrice = v === '' ? null : Number(v))
              "
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="filled"
            :disabled="holdingSaving || !holdingForm.name"
            @click="saveHolding"
          >
            <Loader2 v-if="holdingSaving" class="h-4 w-4 mr-1 animate-spin" />
            Add Coin
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
          <AlertDialogTitle>Delete coin?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove "{{ holdingToDelete?.name }}" from this wallet. Related
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

    <!-- Buy / Sell Movement Dialog -->
    <Dialog v-model:open="showMovementDialog">
      <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Buy / Sell</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label for="crypto-detail-field-6" class="text-[14px] font-medium">Date</label>
            <Input id="crypto-detail-field-6" v-model="movementForm.date" type="date" />
          </div>
          <div>
            <label for="crypto-detail-field-7" class="text-[14px] font-medium">Type</label>
            <Select v-model="movementForm.type">
              <SelectTrigger id="crypto-detail-field-7"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="t in CRYPTO_MOVEMENT_TYPES" :key="t" :value="t">{{
                  t
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label for="crypto-detail-field-8" class="text-[14px] font-medium">Coin</label>
            <Select v-model="movementForm.holdingId">
              <SelectTrigger id="crypto-detail-field-8"
                ><SelectValue placeholder="Select coin"
              /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">General (no coin)</SelectItem>
                <SelectItem v-for="h in holdings" :key="h.id" :value="String(h.id)">{{
                  h.name
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label for="crypto-detail-field-9" class="text-[14px] font-medium">Quantity</label>
            <Input
              id="crypto-detail-field-9"
              v-model.number="movementForm.quantity"
              type="number"
            />
          </div>
          <div>
            <label for="crypto-detail-field-10" class="text-[14px] font-medium"
              >Price per Unit (ILS)</label
            >
            <Input
              id="crypto-detail-field-10"
              :model-value="movementForm.pricePerUnit ?? ''"
              type="number"
              @update:model-value="
                (v: string | number) => (movementForm.pricePerUnit = v === '' ? null : Number(v))
              "
            />
          </div>
          <div>
            <label for="crypto-detail-field-11" class="text-[14px] font-medium">Notes</label>
            <Textarea id="crypto-detail-field-11" v-model="movementForm.notes" maxlength="500" />
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
          if (!v) movementToDelete = null;
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
        <AlertDialogFooter>
          <AlertDialogCancel @click="movementToDelete = null">Cancel</AlertDialogCancel>
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
