<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  label?: string;
  description?: string;
  class?: HTMLAttributes['class'];
  vertical?: boolean;
}>();
</script>

<template>
  <div
    :class="
      cn(
        'px-5 py-4 flex gap-4',
        vertical
          ? 'flex-col'
          : 'flex-col items-start sm:flex-row sm:items-center sm:justify-between',
        props.class,
      )
    "
  >
    <div v-if="label" class="min-w-0 flex-1" :class="{ 'min-w-0': !vertical }">
      <div class="text-sm text-text-primary">{{ label }}</div>
      <div v-if="description" class="text-xs leading-relaxed text-text-secondary mt-1">
        {{ description }}
      </div>
    </div>
    <div
      :class="
        vertical
          ? ''
          : 'flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:ms-auto [&>*]:max-w-full'
      "
    >
      <slot />
    </div>
  </div>
</template>
