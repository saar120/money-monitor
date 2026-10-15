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
    <div v-if="title" class="mb-4 text-start">
      <h3 class="text-base font-semibold text-text-primary">{{ title }}</h3>
      <p v-if="description" class="text-[13px] leading-relaxed text-text-secondary mt-1">
        {{ description }}
      </p>
    </div>
    <div class="border-y border-separator/60 bg-bg-primary divide-y divide-separator/40">
      <slot />
    </div>
  </div>
</template>
