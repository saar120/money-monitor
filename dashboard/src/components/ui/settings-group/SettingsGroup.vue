<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  title?: string;
  description?: string;
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <div :class="cn('', props.class)">
    <div v-if="title" class="px-1 mb-2">
      <h3 class="text-[13px] font-semibold text-text-primary">{{ title }}</h3>
      <p v-if="description" class="text-[12px] text-text-secondary mt-0.5">{{ description }}</p>
    </div>
    <div
      class="rounded-xl border border-separator/60 bg-bg-primary shadow-[var(--shadow-sm)] divide-y divide-separator/40"
    >
      <slot />
    </div>
  </div>
</template>
