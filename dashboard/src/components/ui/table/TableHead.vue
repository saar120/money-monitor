<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <th :class="cn('h-8 px-2 text-left align-middle text-[11px] uppercase tracking-wider font-semibold text-text-secondary border-b border-separator [&:has([role=checkbox])]:pr-0', props.class)">
    <slot />
  </th>
</template>
