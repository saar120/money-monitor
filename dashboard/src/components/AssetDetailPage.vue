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
  <div class="animate-fade-in-up space-y-6">
    <button
      class="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary transition-colors"
      @click="router.push('/net-worth')"
    >
      <ArrowLeft class="h-4 w-4" />
      Back to Net Worth
    </button>

    <div v-if="loading">
      <Skeleton class="h-8 w-64 mb-2" />
      <Skeleton class="h-5 w-32" />
    </div>

    <div v-else-if="error" class="text-center py-12">
      <p class="text-destructive text-[13px]">{{ error }}</p>
      <Button variant="secondary" size="sm" class="mt-4" @click="$router.go(0)">Retry</Button>
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
