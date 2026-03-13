<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip,
} from 'chart.js';
import {
  getAsset, getMovements, getAssetSnapshots,
  createHolding, updateHolding, deleteHolding,
  createMovement, deleteMovement,
  type Asset, type Holding, type Movement, type AssetSnapshot,
} from '@/api/client';
import { useApi } from '@/composables/useApi';
import { useChartTheme } from '@/composables/useChartTheme';
import { formatCurrency } from '@/lib/format';
import { HOLDING_TYPE_LABELS } from '@/lib/net-worth-constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, Trash2, TrendingUp, TrendingDown,
  AlertCircle, Loader2, RefreshCw,
} from 'lucide-vue-next';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip);

const { tooltip: themeTooltip, axisTicks, grid: themeGrid } = useChartTheme();

const props = defineProps<{ assetId: number; initialAsset: Asset }>();

// ── Data fetching ──
const assetApi = useApi<Asset>(() => getAsset(props.assetId));
const movementsApi = useApi<{ movements: Movement[]; total: number }>(() =>
  getMovements(props.assetId, { limit: 50 })
);
const snapshotsApi = useApi<{ snapshots: AssetSnapshot[] }>(() =>
  getAssetSnapshots(props.assetId)
);

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
  movements.value.filter(m => m.type === 'buy' || m.type === 'sell')
);

function formatMovementDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
const holdingForm = ref({ name: '', currency: 'BTC', quantity: 0, costBasis: 0, lastPrice: null as number | null });
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
  } catch { /* noop */ } finally {
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
  } catch { /* noop */ } finally {
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

watch(() => movementForm.value.holdingId, (val) => {
  if (val !== 'none') {
    const h = holdings.value.find(x => x.id === Number(val));
    if (h) movementForm.value.currency = h.currency;
  }
});

async function saveMovement() {
  movementSaving.value = true;
  movementError.value = null;
  try {
    const isSell = movementForm.value.type === 'sell';
    const quantity = isSell ? -Math.abs(movementForm.value.quantity) : Math.abs(movementForm.value.quantity);

    await createMovement(props.assetId, {
      holdingId: movementForm.value.holdingId !== 'none' ? Number(movementForm.value.holdingId) : undefined,
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
  } catch { /* noop */ } finally {
    deletingMovement.value = false;
  }
}

// ── Chart ──
const chartData = computed(() => {
  if (snapshots.value.length === 0) return null;
  return {
    labels: snapshots.value.map(s => {
      const d = new Date(s.date);
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    }),
    datasets: [{
      label: 'Value (ILS)',
      data: snapshots.value.map(s => s.totalValueIls),
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
    }],
  };
});

const chartOptions = computed(() => ({
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
          if (v >= 1_000_000) return `\u20AA${(v / 1_000_000).toFixed(1)}M`;
          if (v >= 1_000) return `\u20AA${(v / 1_000).toFixed(0)}K`;
          return `\u20AA${v}`;
        },
      },
      grid: themeGrid.value,
    },
  },
}));
</script>

<template>
  <div class="animate-fade-in-up space-y-6">
    <!-- Loading skeleton -->
    <div v-if="assetApi.loading.value && !asset">
      <Skeleton class="h-8 w-64 mb-2" />
      <Skeleton class="h-5 w-32" />
    </div>

    <!-- Error state -->
    <div v-else-if="assetApi.error.value" class="text-center py-12">
      <p class="text-destructive text-[13px]">{{ assetApi.error.value }}</p>
      <Button variant="outline" size="sm" class="mt-4" @click="assetApi.execute()">Retry</Button>
    </div>

    <template v-else-if="asset">
      <!-- Header -->
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">{{ asset.name }}</h1>
        <div class="flex items-center gap-2 mt-1">
          <span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--warning)]/10 text-[var(--warning)]">Crypto</span>
          <span v-if="asset.institution" class="text-[13px] text-text-secondary">{{ asset.institution }}</span>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-[13px] font-medium text-text-secondary">Total Value (ILS)</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-[22px] font-semibold tabular-nums">{{ formatCurrency(asset.totalValueIls) }}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-[13px] font-medium text-text-secondary">Total Invested</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="asset.totalInvestedIls != null" class="text-[22px] font-semibold tabular-nums">{{ formatCurrency(asset.totalInvestedIls) }}</div>
            <div v-else class="text-[13px] text-text-secondary">No data</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-[13px] font-medium text-text-secondary">Total Return</CardTitle>
          </CardHeader>
          <CardContent>
            <template v-if="totalReturn">
              <div :class="totalReturn.amount >= 0 ? 'text-success' : 'text-destructive'" class="text-[22px] font-semibold tabular-nums">
                {{ totalReturn.amount >= 0 ? '+' : '-' }}{{ formatCurrency(Math.abs(totalReturn.amount)) }}
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                <component :is="totalReturn.amount >= 0 ? TrendingUp : TrendingDown" class="h-3.5 w-3.5" :class="totalReturn.amount >= 0 ? 'text-success' : 'text-destructive'" />
                <span :class="totalReturn.amount >= 0 ? 'text-success' : 'text-destructive'" class="text-[13px]">
                  {{ totalReturn.pct >= 0 ? '+' : '' }}{{ totalReturn.pct.toFixed(1) }}%
                </span>
              </div>
            </template>
            <div v-else class="text-[22px] font-semibold tabular-nums">{{ formatCurrency(asset.totalValueIls) }}</div>
          </CardContent>
        </Card>
      </div>

      <!-- Coin holdings table -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <CardTitle class="text-[15px]">Coin Holdings</CardTitle>
            <div class="flex items-center gap-2">
              <template v-if="quickUpdateMode">
                <Button variant="outline" size="sm" @click="cancelQuickUpdate">Cancel</Button>
                <Button size="sm" :disabled="savingQuick" @click="saveQuickUpdate">
                  <Loader2 v-if="savingQuick" class="h-3.5 w-3.5 mr-1 animate-spin" />
                  Save
                </Button>
              </template>
              <template v-else>
                <Button v-if="holdings.length > 0" variant="outline" size="sm" @click="startQuickUpdate">
                  <RefreshCw class="h-3.5 w-3.5 mr-1" />
                  Update Values
                </Button>
                <Button size="sm" @click="openAddHolding">
                  <Plus class="h-4 w-4 mr-1" />
                  Add Coin
                </Button>
              </template>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="assetApi.loading.value && holdings.length === 0" class="space-y-3">
            <Skeleton class="h-10 w-full" />
            <Skeleton class="h-10 w-full" />
          </div>

          <div v-else-if="holdings.length === 0" class="text-center py-8">
            <p class="text-text-secondary text-[13px]">No coins yet</p>
            <Button size="sm" class="mt-2" @click="openAddHolding">
              <Plus class="h-4 w-4 mr-1" />
              Add First Coin
            </Button>
          </div>

          <!-- Desktop table -->
          <div v-else class="hidden md:block">
            <Table>
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
                  <TableCell class="font-medium text-[13px]">
                    {{ h.name }}
                    <div v-if="h.stale" class="flex items-center gap-1 text-text-secondary mt-0.5">
                      <AlertCircle class="h-3.5 w-3.5 text-[var(--warning)]" />
                      <span class="text-[11px]">No price data</span>
                    </div>
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-[13px]">
                    <template v-if="quickUpdateMode">
                      <Input
                        type="number"
                        class="w-24 text-right ml-auto"
                        :model-value="editedHoldings.get(h.id)?.quantity"
                        @update:model-value="(v: string | number) => { const m = editedHoldings.get(h.id); if (m) m.quantity = Number(v); }"
                      />
                    </template>
                    <template v-else>{{ h.quantity.toLocaleString() }}</template>
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-[13px] text-text-secondary">
                    <template v-if="quickUpdateMode">
                      <Input
                        type="number"
                        class="w-24 text-right ml-auto"
                        :model-value="editedHoldings.get(h.id)?.lastPrice ?? ''"
                        @update:model-value="(v: string | number) => { const m = editedHoldings.get(h.id); if (m) m.lastPrice = v === '' ? null : Number(v); }"
                      />
                    </template>
                    <template v-else>
                      <span v-if="h.lastPrice != null">{{ formatCurrency(h.lastPrice) }}</span>
                      <span v-else>-</span>
                    </template>
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-[13px] font-medium">{{ formatCurrency(h.currentValueIls) }}</TableCell>
                  <TableCell class="text-right tabular-nums text-[13px] text-text-secondary hidden lg:table-cell">{{ formatCurrency(h.costBasis) }}</TableCell>
                  <TableCell class="text-right">
                    <div v-if="h.gainLoss != null">
                      <span :class="h.gainLoss >= 0 ? 'text-success' : 'text-destructive'" class="text-[13px] tabular-nums font-medium">
                        {{ h.gainLoss >= 0 ? '+' : '' }}{{ formatCurrency(h.gainLoss) }}
                      </span>
                      <span v-if="h.gainLossPercent != null" :class="h.gainLossPercent >= 0 ? 'text-success' : 'text-destructive'" class="text-[11px] block">
                        {{ h.gainLossPercent >= 0 ? '+' : '' }}{{ h.gainLossPercent.toFixed(1) }}%
                      </span>
                    </div>
                    <span v-else class="text-text-secondary text-[13px]">-</span>
                  </TableCell>
                  <TableCell>
                    <div v-if="!quickUpdateMode" class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" class="h-7 w-7" @click="holdingToDelete = h">
                        <Trash2 class="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <!-- Mobile cards -->
          <div v-if="holdings.length > 0" class="md:hidden space-y-2">
            <div v-for="h in holdings" :key="h.id" class="p-3 border border-separator rounded-lg">
              <div class="flex items-center justify-between">
                <span class="font-medium text-[13px]">{{ h.name }}</span>
                <Badge variant="outline" class="text-[11px]">{{ HOLDING_TYPE_LABELS[h.type] ?? h.type }}</Badge>
              </div>
              <div class="text-[11px] text-text-secondary mt-1">
                {{ h.quantity.toLocaleString() }} units
                <span v-if="h.lastPrice != null"> @ {{ formatCurrency(h.lastPrice) }}</span>
              </div>
              <div class="flex items-center justify-between mt-1">
                <span class="text-[13px] font-medium">{{ formatCurrency(h.currentValueIls) }}</span>
                <span v-if="h.gainLossPercent != null" :class="h.gainLossPercent >= 0 ? 'text-success' : 'text-destructive'" class="text-[11px]">
                  {{ h.gainLossPercent >= 0 ? '+' : '' }}{{ h.gainLossPercent.toFixed(1) }}%
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Value over time chart -->
      <Card>
        <CardHeader>
          <CardTitle class="text-[15px]">Value Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="snapshotsApi.loading.value && !chartData">
            <Skeleton class="h-48 w-full rounded-md" />
          </div>
          <div v-else-if="chartData">
            <Line :data="chartData" :options="chartOptions" />
          </div>
          <div v-else class="text-[13px] text-text-secondary text-center py-12">
            Update holdings to start building value history
          </div>
        </CardContent>
      </Card>

      <!-- Movement history -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-[15px] font-semibold">Buy / Sell History</h2>
          <Button size="sm" @click="openAddMovement">
            <Plus class="h-4 w-4 mr-1" />
            Add Movement
          </Button>
        </div>

        <div v-if="movementsApi.loading.value && movements.length === 0" class="space-y-3">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>

        <div v-else-if="buySellMovements.length === 0" class="text-center py-8">
          <p class="text-text-secondary text-[13px]">No buy/sell movements recorded yet.</p>
        </div>

        <div v-else class="space-y-0 border border-separator rounded-lg divide-y divide-separator">
          <div v-for="m in buySellMovements" :key="m.id" class="px-4 py-3 group">
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <Badge :class="MOVEMENT_BADGE_CLASSES[m.type] ?? 'bg-muted text-text-secondary'">{{ m.type }}</Badge>
                  <span class="text-[13px] text-text-secondary">{{ m.holdingName ?? 'General' }}</span>
                </div>
                <div class="text-[13px] font-medium mt-1 tabular-nums">
                  {{ m.quantity > 0 ? '+' : '' }}{{ m.quantity.toLocaleString() }} {{ m.currency }}
                  <span v-if="m.pricePerUnit" class="text-text-secondary">
                    @ {{ m.pricePerUnit.toLocaleString() }}/unit
                  </span>
                </div>
                <p v-if="m.notes" class="text-[11px] text-text-secondary mt-0.5 italic">{{ m.notes }}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[11px] text-text-secondary">{{ formatMovementDate(m.date) }}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Coin</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label class="text-[13px] font-medium">Name</label>
            <Input v-model="holdingForm.name" placeholder="e.g. Bitcoin, Ethereum" />
          </div>
          <div>
            <label class="text-[13px] font-medium">Currency / Ticker</label>
            <Input v-model="holdingForm.currency" placeholder="BTC" />
          </div>
          <div>
            <label class="text-[13px] font-medium">Quantity</label>
            <Input v-model.number="holdingForm.quantity" type="number" />
          </div>
          <div>
            <label class="text-[13px] font-medium">Cost Basis (ILS)</label>
            <Input v-model.number="holdingForm.costBasis" type="number" />
          </div>
          <div>
            <label class="text-[13px] font-medium">Last Price (ILS)</label>
            <Input :model-value="holdingForm.lastPrice ?? ''" @update:model-value="(v: string | number) => holdingForm.lastPrice = v === '' ? null : Number(v)" type="number" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button :disabled="holdingSaving || !holdingForm.name" @click="saveHolding">
            <Loader2 v-if="holdingSaving" class="h-4 w-4 mr-1 animate-spin" />
            Add Coin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Holding Confirm -->
    <AlertDialog :open="!!holdingToDelete" @update:open="(v: boolean) => { if (!v) holdingToDelete = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete coin?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove "{{ holdingToDelete?.name }}" from this wallet.
            Related movement records will be preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="holdingToDelete = null">Cancel</AlertDialogCancel>
          <Button
            :disabled="deletingHolding"
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Buy / Sell</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label class="text-[13px] font-medium">Date</label>
            <Input v-model="movementForm.date" type="date" />
          </div>
          <div>
            <label class="text-[13px] font-medium">Type</label>
            <Select v-model="movementForm.type">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="t in CRYPTO_MOVEMENT_TYPES" :key="t" :value="t">{{ t }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label class="text-[13px] font-medium">Coin</label>
            <Select v-model="movementForm.holdingId">
              <SelectTrigger><SelectValue placeholder="Select coin" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">General (no coin)</SelectItem>
                <SelectItem v-for="h in holdings" :key="h.id" :value="String(h.id)">{{ h.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label class="text-[13px] font-medium">Quantity</label>
            <Input v-model.number="movementForm.quantity" type="number" />
          </div>
          <div>
            <label class="text-[13px] font-medium">Price per Unit (ILS)</label>
            <Input :model-value="movementForm.pricePerUnit ?? ''" @update:model-value="(v: string | number) => movementForm.pricePerUnit = v === '' ? null : Number(v)" type="number" />
          </div>
          <div>
            <label class="text-[13px] font-medium">Notes</label>
            <Textarea v-model="movementForm.notes" maxlength="500" />
          </div>
          <p v-if="movementError" class="text-[13px] text-destructive">{{ movementError }}</p>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button :disabled="movementSaving || !movementForm.quantity" @click="saveMovement">
            <Loader2 v-if="movementSaving" class="h-4 w-4 mr-1 animate-spin" />
            Record Movement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Movement Confirm -->
    <AlertDialog :open="!!movementToDelete" @update:open="(v: boolean) => { if (!v) movementToDelete = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete movement?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove the {{ movementToDelete?.type }} movement from {{ formatMovementDate(movementToDelete?.date ?? '') }}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="movementToDelete = null">Cancel</AlertDialogCancel>
          <Button
            :disabled="deletingMovement"
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
