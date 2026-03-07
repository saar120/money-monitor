<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip,
} from 'chart.js';
import {
  getAsset, getMovements, getAssetSnapshots, updateAssetValue,
  type Asset, type Movement, type AssetSnapshot,
} from '@/api/client';
import { useApi } from '@/composables/useApi';
import { formatCurrency } from '@/lib/format';
import { ASSET_TYPE_LABELS } from '@/lib/net-worth-constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { TrendingUp, TrendingDown, Loader2, Plus } from 'lucide-vue-next';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip);

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
const movements = computed(() => movementsApi.data.value?.movements ?? []);
const snapshots = computed(() => snapshotsApi.data.value?.snapshots ?? []);

// ── Performance calculations ──
const currentValue = computed(() => asset.value?.totalValueIls ?? 0);
const totalContributed = computed(() => asset.value?.totalInvestedIls ?? 0);
const pnl = computed(() => {
  if (totalContributed.value === 0) return null;
  const amount = currentValue.value - totalContributed.value;
  const pct = (amount / totalContributed.value) * 100;
  return { amount, pct };
});

const contributionMovements = computed(() => movements.value.filter(m => m.type === 'contribution'));

// ── Update Value Dialog ──
const showUpdateDialog = ref(false);
const updateForm = ref({ currentValue: 0, contribution: 0 });
const saving = ref(false);

function openUpdateDialog() {
  updateForm.value = {
    currentValue: asset.value?.holdings?.[0]?.quantity ?? 0,
    contribution: 0,
  };
  showUpdateDialog.value = true;
}

async function handleUpdate() {
  saving.value = true;
  try {
    await updateAssetValue(props.assetId, {
      currentValue: updateForm.value.currentValue,
      contribution: updateForm.value.contribution > 0 ? updateForm.value.contribution : undefined,
    });
    showUpdateDialog.value = false;
    await refreshAll();
  } catch { /* noop */ } finally {
    saving.value = false;
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
      borderColor: '#06b6d4',
      backgroundColor: '#06b6d420',
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
          return ` ${formatCurrency(ctx.parsed.y)}`;
        },
      },
    },
  },
  scales: {
    x: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.03)' } },
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

function formatMovementDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
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
          <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">
            {{ ASSET_TYPE_LABELS[asset.type] ?? asset.type }}
          </span>
          <span v-if="asset.institution" class="text-sm text-muted-foreground">{{ asset.institution }}</span>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Current Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold tabular-nums">{{ formatCurrency(currentValue) }}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Total Contributed</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="totalContributed > 0" class="text-2xl font-bold tabular-nums">{{ formatCurrency(totalContributed) }}</div>
            <div v-else class="text-sm text-muted-foreground">No data</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Return</CardTitle>
          </CardHeader>
          <CardContent>
            <template v-if="pnl">
              <div :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" class="text-2xl font-bold tabular-nums">
                {{ pnl.amount >= 0 ? '+' : '-' }}{{ formatCurrency(Math.abs(pnl.amount)) }}
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                <component :is="pnl.amount >= 0 ? TrendingUp : TrendingDown" class="h-3.5 w-3.5" :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" />
                <span :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" class="text-sm">
                  {{ pnl.pct >= 0 ? '+' : '' }}{{ pnl.pct.toFixed(1) }}%
                </span>
              </div>
            </template>
            <div v-else class="text-2xl font-bold tabular-nums">{{ formatCurrency(currentValue) }}</div>
          </CardContent>
        </Card>
      </div>

      <!-- Update value button -->
      <div>
        <Button @click="openUpdateDialog">
          <Plus class="h-4 w-4 mr-1" />
          Update Value
        </Button>
      </div>

      <!-- Value over time chart -->
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
            Update the value to start building history
          </div>
        </CardContent>
      </Card>

      <!-- Contribution history -->
      <div class="space-y-4">
        <h2 class="text-lg font-semibold heading-font">Contribution History</h2>

        <div v-if="movementsApi.loading.value && movements.length === 0" class="space-y-3">
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
        </div>

        <div v-else-if="contributionMovements.length === 0" class="text-center py-8">
          <p class="text-muted-foreground text-sm">No contributions recorded yet.</p>
        </div>

        <div v-else class="border border-border rounded-md divide-y divide-border">
          <div v-for="m in contributionMovements" :key="m.id" class="px-4 py-3 flex items-center justify-between">
            <span class="text-sm text-muted-foreground">{{ formatMovementDate(m.date) }}</span>
            <span class="text-sm font-medium tabular-nums">{{ formatCurrency(Math.abs(m.quantity)) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Update Value Dialog -->
    <Dialog v-model:open="showUpdateDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Value</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label class="text-sm font-medium">Current Value (ILS)</label>
            <Input v-model.number="updateForm.currentValue" type="number" />
          </div>
          <div>
            <label class="text-sm font-medium">New Contribution (optional)</label>
            <Input v-model.number="updateForm.contribution" type="number" />
            <p class="text-xs text-muted-foreground mt-1">Amount contributed since last update</p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button :disabled="saving" @click="handleUpdate">
            <Loader2 v-if="saving" class="h-4 w-4 mr-1 animate-spin" />
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
