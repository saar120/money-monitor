<script setup lang="ts">
import { useChartTheme } from '@/composables/useChartTheme';
import { ref, computed, onMounted } from 'vue';
import {
  getAsset,
  getMovements,
  getAssetSnapshots,
  updateAssetValue,
  type Asset,
  type Movement,
  type AssetSnapshot,
} from '@/api/client';
import { useApi } from '@/composables/useApi';
import { formatCurrency } from '@/lib/format';
import { language, t } from '@/lib/language';
import EChartsLineChart from '@/components/EChartsLineChart.vue';
import { ASSET_TYPE_LABELS } from '@/lib/net-worth-constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { TrendingUp, TrendingDown, Loader2, Plus } from 'lucide-vue-next';

const { chartPrimary } = useChartTheme();

const props = defineProps<{ assetId: number; initialAsset: Asset }>();
const copy = computed(() =>
  language.value === 'he'
    ? {
        current: 'שווי נוכחי',
        contributed: 'סך הפקדות',
        return: 'תשואה',
        noData: 'אין נתונים',
        update: 'עדכון שווי',
        history: 'שווי לאורך זמן',
        historyHint: 'עדכנו את השווי כדי להתחיל לבנות היסטוריה',
        contributions: 'היסטוריית הפקדות',
        noContributions: 'עדיין אין הפקדות.',
      }
    : {
        current: 'Current value',
        contributed: 'Total contributed',
        return: 'Return',
        noData: 'No data',
        update: 'Update value',
        history: 'Value over time',
        historyHint: 'Update the value to start building history',
        contributions: 'Contribution history',
        noContributions: 'No contributions recorded yet.',
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

const contributionMovements = computed(() =>
  movements.value.filter((m) => m.type === 'contribution'),
);

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
  } catch {
    /* noop */
  } finally {
    saving.value = false;
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

function formatMovementDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
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
      <!-- Asset header -->
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight break-words">{{ asset.name }}</h1>
        <div class="flex flex-wrap items-center gap-2 mt-1">
          <span
            class="text-[12px] font-medium px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary"
          >
            {{ ASSET_TYPE_LABELS[asset.type] ?? asset.type }}
          </span>
          <span v-if="asset.institution" class="text-[14px] text-text-secondary">{{
            asset.institution
          }}</span>
        </div>
      </div>

      <!-- Asset summary -->
      <div class="asset-metrics grid grid-cols-1 md:grid-cols-3 gap-4">
        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.current }}</h2>
          </header>
          <div class="asset-metric-value">
            <div class="text-[22px] font-semibold tabular-nums">
              {{ formatCurrency(currentValue) }}
            </div>
          </div>
        </section>

        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.contributed }}</h2>
          </header>
          <div class="asset-metric-value">
            <div v-if="totalContributed > 0" class="text-[22px] font-semibold tabular-nums">
              {{ formatCurrency(totalContributed) }}
            </div>
            <div v-else class="text-[14px] text-text-secondary">{{ copy.noData }}</div>
          </div>
        </section>

        <section class="asset-metric">
          <header class="asset-metric-label">
            <h2 class="text-[12px] font-medium text-text-secondary">{{ copy.return }}</h2>
          </header>
          <div class="asset-metric-value">
            <template v-if="pnl">
              <div
                :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'"
                class="text-[22px] font-semibold tabular-nums"
              >
                {{ pnl.amount >= 0 ? '+' : '-' }}{{ formatCurrency(Math.abs(pnl.amount)) }}
              </div>
              <div class="flex items-center gap-1 mt-0.5">
                <component
                  :is="pnl.amount >= 0 ? TrendingUp : TrendingDown"
                  class="h-3.5 w-3.5"
                  :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'"
                />
                <span
                  :class="pnl.amount >= 0 ? 'text-success' : 'text-destructive'"
                  class="text-[14px]"
                >
                  {{ pnl.pct >= 0 ? '+' : '' }}{{ pnl.pct.toFixed(1) }}%
                </span>
              </div>
            </template>
            <div v-else class="text-[22px] font-semibold tabular-nums">
              {{ formatCurrency(currentValue) }}
            </div>
          </div>
        </section>
      </div>

      <!-- Update value button -->
      <div>
        <Button @click="openUpdateDialog">
          <Plus class="h-4 w-4 mr-1" />
          {{ copy.update }}
        </Button>
      </div>

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

      <!-- Contribution history -->
      <div class="finance-section space-y-4">
        <h2 class="text-[20px] font-semibold">{{ copy.contributions }}</h2>

        <div v-if="movementsApi.loading.value && movements.length === 0" class="space-y-3">
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
        </div>

        <div v-else-if="contributionMovements.length === 0" class="text-center py-8">
          <p class="text-text-secondary text-[14px]">{{ copy.noContributions }}</p>
        </div>

        <div v-else class="finance-ledger divide-y divide-separator">
          <div
            v-for="m in contributionMovements"
            :key="m.id"
            class="finance-ledger-row flex flex-wrap items-center justify-between gap-3"
          >
            <span class="text-[14px] text-text-secondary">{{ formatMovementDate(m.date) }}</span>
            <span class="text-[14px] font-medium tabular-nums">{{
              formatCurrency(Math.abs(m.quantity))
            }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Update Value Dialog -->
    <Dialog v-model:open="showUpdateDialog">
      <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update Value</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <label for="simple-value-detail-field-1" class="text-[14px] font-medium"
              >Current Value (ILS)</label
            >
            <Input
              id="simple-value-detail-field-1"
              v-model.number="updateForm.currentValue"
              type="number"
            />
          </div>
          <div>
            <label for="simple-value-detail-field-2" class="text-[14px] font-medium"
              >New Contribution (optional)</label
            >
            <Input
              id="simple-value-detail-field-2"
              v-model.number="updateForm.contribution"
              type="number"
            />
            <p class="text-[12px] text-text-secondary mt-1">Amount contributed since last update</p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant="filled" :disabled="saving" @click="handleUpdate">
            <Loader2 v-if="saving" class="h-4 w-4 mr-1 animate-spin" />
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
