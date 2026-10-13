<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <td :class="cn('px-4 py-3 align-middle text-sm', props.class)">
    <slot />
  </td>
</template>
