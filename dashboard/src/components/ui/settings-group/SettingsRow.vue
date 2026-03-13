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
        'px-4 py-3 flex gap-4',
        vertical ? 'flex-col' : 'items-center justify-between',
        props.class,
      )
    "
  >
    <div v-if="label" class="flex-shrink-0" :class="{ 'min-w-0': !vertical }">
      <div class="text-[13px] text-text-primary">{{ label }}</div>
      <div v-if="description" class="text-[11px] text-text-secondary mt-0.5">{{ description }}</div>
    </div>
    <div :class="vertical ? '' : 'flex items-center gap-2 ml-auto'">
      <slot />
    </div>
  </div>
</template>
