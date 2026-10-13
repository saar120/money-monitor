<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <th
    :class="
      cn(
        'h-12 px-4 text-start align-middle text-xs font-semibold text-text-secondary border-b border-separator/60',
        props.class,
      )
    "
  >
    <slot />
  </th>
</template>
