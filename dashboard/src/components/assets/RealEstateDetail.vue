<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  getAsset, getMovements, getAssetSnapshots,
  updateAssetValue, recordRentIncome,
  type Asset, type Movement, type AssetSnapshot,
} from '@/api/client';
import { useApi } from '@/composables/useApi';
import { formatCurrency, formatAmount, CURRENCY_SYMBOLS } from '@/lib/format';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip,
} from 'chart.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { TrendingUp, TrendingDown, Loader2, Plus, Home } from 'lucide-vue-next';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip);

const props = defineProps<{ assetId: number; initialAsset: Asset }>();

// ─── Data fetching ───
const assetApi = useApi<Asset>(() => getAsset(props.assetId));
const movementsApi = useApi<{ movements: Movement[]; total: number }>(() =>
  getMovements(props.assetId, { limit: 50 }),
);
const snapshotsApi = useApi<{ snapshots: AssetSnapshot[] }>(() =>
  getAssetSnapshots(props.assetId),
);

const asset = computed(() => assetApi.data.value ?? props.initialAsset);
const movements = computed(() => movementsApi.data.value?.movements ?? []);
const snapshots = computed(() => snapshotsApi.data.value?.snapshots ?? []);

onMounted(() => {
  movementsApi.execute();
  snapshotsApi.execute();
});

async function refreshAll() {
  await Promise.all([assetApi.execute(), movementsApi.execute(), snapshotsApi.execute()]);
}

// ─── Computed values ───
const nativeCurrency = computed(() => asset.value?.currency ?? 'ILS');
const isMultiCurrency = computed(() => nativeCurrency.value !== 'ILS');
const balanceHolding = computed(() => asset.value?.holdings.find(h => h.type === 'balance'));
const nativeValue = computed(() => balanceHolding.value?.currentValue ?? 0);

const currentValue = computed(() => asset.value?.totalValueIls ?? 0);
const purchasePrice = computed(() => asset.value?.totalInvestedIls ?? 0);
const totalRent = computed(() => asset.value?.totalRentEarned ?? 0);

const pnl = computed(() => {
  if (purchasePrice.value === 0) return null;
  const amount = (currentValue.value + totalRent.value) - purchasePrice.value;
  const pct = (amount / purchasePrice.value) * 100;
  return { amount, pct };
});

const rentMovements = computed(() => movements.value.filter(m => m.type === 'rent_income'));

function formatMovementDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Update Value Dialog ───
const showUpdateDialog = ref(false);
const updateForm = ref({ currentValue: 0 });
const updatingSaving = ref(false);

function openUpdateDialog() {
  updateForm.value.currentValue = isMultiCurrency.value ? nativeValue.value : currentValue.value;
  showUpdateDialog.value = true;
}

async function saveUpdate() {
  updatingSaving.value = true;
  try {
    await updateAssetValue(props.assetId, { currentValue: updateForm.value.currentValue });
    showUpdateDialog.value = false;
    await refreshAll();
  } catch { /* noop */ } finally {
    updatingSaving.value = false;
  }
}

// ─── Record Rent Dialog ───
const showRentDialog = ref(false);
const rentForm = ref({ amount: 0, date: new Date().toISOString().slice(0, 10), notes: '' });
const rentSaving = ref(false);

function openRentDialog() {
  rentForm.value = { amount: 0, date: new Date().toISOString().slice(0, 10), notes: '' };
  showRentDialog.value = true;
}

async function saveRent() {
  rentSaving.value = true;
  try {
    await recordRentIncome(props.assetId, {
      amount: rentForm.value.amount,
      date: rentForm.value.date,
      notes: rentForm.value.notes || undefined,
    });
    showRentDialog.value = false;
    await refreshAll();
  } catch { /* noop */ } finally {
    rentSaving.value = false;
  }
}

// ─── Chart ───
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
      borderColor: '#ec4899',
      backgroundColor: '#ec489920',
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true,
    }],
  };
});

const chartOptions = {
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
          return ` ${formatAmount(ctx.parsed.y, 'ILS')}`;
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
          const sym = CURRENCY_SYMBOLS['ILS'] ?? 'ILS ';
          if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
          if (v >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}K`;
          return `${sym}${v}`;
        },
      },
      grid: { color: 'rgba(255,255,255,0.03)' },
    },
  },
};
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
      <p class="text-destructive text-sm">{{ assetApi.error.value }}</p>
      <Button variant="outline" size="sm" class="mt-4" @click="assetApi.execute()">Retry</Button>
    </div>

    <template v-else-if="asset">
      <!-- Asset header -->
      <div>
        <h1 class="text-2xl font-semibold tracking-tight heading-font">{{ asset.name }}</h1>
        <div class="flex items-center gap-2 mt-1">
          <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-pink-500/10 text-pink-500">
            <Home class="h-3 w-3" />
            Real Estate
          </span>
          <span v-if="asset.institution" class="text-sm text-muted-foreground">{{ asset.institution }}</span>
        </div>
      </div>

      <!-- Summary cards (2x2) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Property Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold tabular-nums">{{ formatCurrency(currentValue) }}</div>
            <div v-if="isMultiCurrency" class="text-sm text-muted-foreground mt-0.5">
              {{ formatAmount(nativeValue, nativeCurrency) }}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Purchase Price</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="purchasePrice" class="text-2xl font-bold tabular-nums">{{ formatCurrency(purchasePrice) }}</div>
            <div v-else class="text-sm text-muted-foreground">Not set</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Total Rent Earned</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold tabular-nums">{{ formatCurrency(totalRent) }}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Total Return</CardTitle>
          </CardHeader>
          <CardContent>
            <template v-if="pnl">
              <div :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" class="text-2xl font-bold tabular-nums">
                {{ pnl.amount >= 0 ? '+' : '' }}{{ formatCurrency(pnl.amount) }}
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                <component :is="pnl.amount >= 0 ? TrendingUp : TrendingDown" class="h-3.5 w-3.5" :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" />
                <span :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" class="text-sm">
                  {{ pnl.pct >= 0 ? '+' : '' }}{{ pnl.pct.toFixed(1) }}%
                </span>
              </div>
            </template>
            <div v-else class="text-sm text-muted-foreground">No purchase price recorded</div>
          </CardContent>
        </Card>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-3">
        <Button @click="openUpdateDialog">Update Value</Button>
        <Button variant="outline" @click="openRentDialog">
          <Plus class="h-4 w-4 mr-1" />
          Record Rent Income
        </Button>
      </div>

      <!-- Value Over Time chart -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Value Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="snapshotsApi.loading.value && !chartData">
            <Skeleton class="h-48 w-full rounded-md" />
          </div>
          <div v-else-if="chartData">
            <Line :data="chartData" :options="chartOptions" />
          </div>
          <div v-else class="text-sm text-muted-foreground text-center py-12">
            Update the property value to start building history
          </div>
        </CardContent>
      </Card>

      <!-- Rent Income History -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Rent Income History</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="movementsApi.loading.value && rentMovements.length === 0" class="space-y-3">
            <Skeleton class="h-12 w-full" />
            <Skeleton class="h-12 w-full" />
          </div>
          <div v-else-if="rentMovements.length === 0" class="text-center py-8">
            <p class="text-muted-foreground text-sm">No rent income recorded yet</p>
          </div>
          <div v-else class="space-y-0 border border-border rounded-md divide-y divide-border">
            <div v-for="m in rentMovements" :key="m.id" class="px-4 py-3 flex items-center justify-between">
              <div>
                <div class="text-sm font-medium tabular-nums">
                  {{ isMultiCurrency ? formatAmount(Math.abs(m.quantity), nativeCurrency) : formatCurrency(Math.abs(m.quantity)) }}
                  <span v-if="isMultiCurrency && m.sourceAmount" class="text-muted-foreground text-xs ml-1">
                    ({{ formatCurrency(Math.abs(m.sourceAmount)) }})
                  </span>
                </div>
                <p v-if="m.notes" class="text-xs text-muted-foreground mt-0.5 italic">{{ m.notes }}</p>
              </div>
              <span class="text-xs text-muted-foreground">{{ formatMovementDate(m.date) }}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </template>

    <!-- Update Value Dialog -->
    <Dialog v-model:open="showUpdateDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Property Value</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label class="text-sm font-medium">Property Value ({{ nativeCurrency }})</label>
            <Input v-model.number="updateForm.currentValue" type="number" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button :disabled="updatingSaving || !updateForm.currentValue" @click="saveUpdate">
            <Loader2 v-if="updatingSaving" class="h-4 w-4 mr-1 animate-spin" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Record Rent Dialog -->
    <Dialog v-model:open="showRentDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Rent Income</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label class="text-sm font-medium">Amount ({{ nativeCurrency }})</label>
            <Input v-model.number="rentForm.amount" type="number" />
          </div>
          <div>
            <label class="text-sm font-medium">Date</label>
            <Input v-model="rentForm.date" type="date" />
          </div>
          <div>
            <label class="text-sm font-medium">Notes (optional)</label>
            <Input v-model="rentForm.notes" placeholder="e.g. January rent" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button :disabled="rentSaving || !rentForm.amount" @click="saveRent">
            <Loader2 v-if="rentSaving" class="h-4 w-4 mr-1 animate-spin" />
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
