<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  getAsset, getMovements, getAssetSnapshots, updateAssetValue,
  type Asset, type Movement, type AssetSnapshot,
} from '@/api/client';
import { useApi } from '@/composables/useApi';
import { formatCurrency } from '@/lib/format';
import EChartsLineChart from '@/components/EChartsLineChart.vue';
import { ASSET_TYPE_LABELS } from '@/lib/net-worth-constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { TrendingUp, TrendingDown, Loader2, Plus } from 'lucide-vue-next';

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
const chartLabels = computed(() =>
  snapshots.value.map(s => {
    const d = new Date(s.date);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }),
);

const chartDatasets = computed(() =>
  snapshots.value.length === 0
    ? null
    : [{ label: 'Value (ILS)', data: snapshots.value.map(s => s.totalValueIls), color: '#007AFF', areaColor: 'rgba(0, 122, 255, 0.15)' }],
);

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
      <p class="text-destructive text-[13px]">{{ assetApi.error.value }}</p>
      <Button variant="outline" size="sm" class="mt-4" @click="assetApi.execute()">Retry</Button>
    </div>

    <template v-else-if="asset">
      <!-- Asset header -->
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">{{ asset.name }}</h1>
        <div class="flex items-center gap-2 mt-1">
          <span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">
            {{ ASSET_TYPE_LABELS[asset.type] ?? asset.type }}
          </span>
          <span v-if="asset.institution" class="text-[13px] text-text-secondary">{{ asset.institution }}</span>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-[13px] font-medium text-text-secondary">Current Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-[22px] font-semibold tabular-nums">{{ formatCurrency(currentValue) }}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-[13px] font-medium text-text-secondary">Total Contributed</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="totalContributed > 0" class="text-[22px] font-semibold tabular-nums">{{ formatCurrency(totalContributed) }}</div>
            <div v-else class="text-[13px] text-text-secondary">No data</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-[13px] font-medium text-text-secondary">Return</CardTitle>
          </CardHeader>
          <CardContent>
            <template v-if="pnl">
              <div :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" class="text-[22px] font-semibold tabular-nums">
                {{ pnl.amount >= 0 ? '+' : '-' }}{{ formatCurrency(Math.abs(pnl.amount)) }}
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                <component :is="pnl.amount >= 0 ? TrendingUp : TrendingDown" class="h-3.5 w-3.5" :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" />
                <span :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'" class="text-[13px]">
                  {{ pnl.pct >= 0 ? '+' : '' }}{{ pnl.pct.toFixed(1) }}%
                </span>
              </div>
            </template>
            <div v-else class="text-[22px] font-semibold tabular-nums">{{ formatCurrency(currentValue) }}</div>
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
          <CardTitle class="text-[15px]">Value Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="snapshotsApi.loading.value && !chartDatasets">
            <Skeleton class="h-48 w-full rounded-md" />
          </div>
          <div v-else-if="chartDatasets" class="h-48">
            <EChartsLineChart :labels="chartLabels" :datasets="chartDatasets" />
          </div>
          <div v-else class="text-[13px] text-text-secondary text-center py-12">
            Update the value to start building history
          </div>
        </CardContent>
      </Card>

      <!-- Contribution history -->
      <div class="space-y-4">
        <h2 class="text-[15px] font-semibold">Contribution History</h2>

        <div v-if="movementsApi.loading.value && movements.length === 0" class="space-y-3">
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
        </div>

        <div v-else-if="contributionMovements.length === 0" class="text-center py-8">
          <p class="text-text-secondary text-[13px]">No contributions recorded yet.</p>
        </div>

        <div v-else class="border border-separator rounded-lg divide-y divide-separator">
          <div v-for="m in contributionMovements" :key="m.id" class="px-4 py-3 flex items-center justify-between">
            <span class="text-[13px] text-text-secondary">{{ formatMovementDate(m.date) }}</span>
            <span class="text-[13px] font-medium tabular-nums">{{ formatCurrency(Math.abs(m.quantity)) }}</span>
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
            <label class="text-[13px] font-medium">Current Value (ILS)</label>
            <Input v-model.number="updateForm.currentValue" type="number" />
          </div>
          <div>
            <label class="text-[13px] font-medium">New Contribution (optional)</label>
            <Input v-model.number="updateForm.contribution" type="number" />
            <p class="text-[11px] text-text-secondary mt-1">Amount contributed since last update</p>
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
