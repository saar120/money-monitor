<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getAsset, type Asset } from '@/api/client';
import { getAssetCategory } from '@/lib/asset-categories';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-vue-next';
import SimpleValueDetail from './assets/SimpleValueDetail.vue';
import RealEstateDetail from './assets/RealEstateDetail.vue';
import CryptoDetail from './assets/CryptoDetail.vue';
import BrokerageDetail from './assets/BrokerageDetail.vue';
import { t } from '@/lib/language';

const route = useRoute();
const router = useRouter();
const assetId = computed(() => Number(route.params.id));

const asset = ref<Asset | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    asset.value = await getAsset(assetId.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
});

const category = computed(() => (asset.value ? getAssetCategory(asset.value.type) : null));
</script>

<template>
  <div class="asset-detail-page min-w-0 animate-fade-in-up space-y-8">
    <button
      type="button"
      class="inline-flex min-h-8 items-center gap-2 text-[14px] text-text-secondary hover:text-text-primary transition-colors"
      @click="router.push('/net-worth')"
    >
      <ArrowLeft class="h-4 w-4" />
      {{ t('netWorth') }}
    </button>

    <div v-if="loading">
      <Skeleton class="h-8 w-64 mb-2" />
      <Skeleton class="h-5 w-32" />
    </div>

    <div v-else-if="error" class="text-center py-12">
      <p class="text-destructive text-[14px]">{{ error }}</p>
      <Button variant="secondary" size="sm" class="mt-4" @click="$router.go(0)">{{
        t('retry')
      }}</Button>
    </div>

    <template v-else-if="asset">
      <SimpleValueDetail
        v-if="category === 'simple_value'"
        :asset-id="assetId"
        :initial-asset="asset"
      />
      <RealEstateDetail
        v-else-if="category === 'real_estate'"
        :asset-id="assetId"
        :initial-asset="asset"
      />
      <CryptoDetail v-else-if="category === 'crypto'" :asset-id="assetId" :initial-asset="asset" />
      <BrokerageDetail v-else :asset-id="assetId" :initial-asset="asset" />
    </template>
  </div>
</template>

<style scoped>
.asset-detail-page :deep(.asset-view) {
  display: grid;
  gap: 32px;
}
.asset-detail-page :deep(.finance-section) {
  min-width: 0;
  padding-block: 24px;
  border-block-start: 1px solid var(--separator);
}
.asset-detail-page :deep(.finance-section-heading) {
  padding: 0 24px 20px;
}
.asset-detail-page :deep(.finance-section-heading h2),
.asset-detail-page :deep(.finance-section > h2) {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
}
.asset-detail-page :deep(.finance-section > h2),
.asset-detail-page :deep(.finance-section > .finance-movement-heading) {
  padding-inline: 24px;
}
.asset-detail-page :deep(.finance-section-content) {
  min-width: 0;
  padding-inline: 24px;
}
.asset-detail-page :deep(.finance-section-ledger) {
  padding-inline: 0;
}
.asset-detail-page :deep(.asset-metrics) {
  gap: 24px;
  padding: 24px;
  border-block: 1px solid var(--separator);
}
.asset-detail-page :deep(.asset-metric) {
  min-width: 0;
}
.asset-detail-page :deep(.asset-metric-label) {
  margin-block-end: 8px;
}
.asset-detail-page :deep(.asset-metric-label h2) {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}
.asset-detail-page :deep(.asset-metric-value) {
  overflow-wrap: anywhere;
}
.asset-detail-page :deep(.finance-ledger-row) {
  padding: 16px;
}
.asset-detail-page :deep(.finance-ledger) {
  border-block: 1px solid var(--separator);
}
@media (max-width: 640px) {
  .asset-detail-page :deep(.finance-section-heading),
  .asset-detail-page :deep(.finance-section-content),
  .asset-detail-page :deep(.finance-section > h2),
  .asset-detail-page :deep(.finance-section > .finance-movement-heading),
  .asset-detail-page :deep(.asset-metrics) {
    padding-inline: 16px;
  }
  .asset-detail-page :deep(.finance-section-ledger) {
    padding-inline: 0;
  }
}
</style>
