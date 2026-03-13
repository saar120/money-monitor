<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <th :class="cn('h-9 px-3 text-left align-middle text-[12px] font-medium text-text-secondary border-b border-separator/60 [&:has([role=checkbox])]:pr-0', props.class)">
    <slot />
  </th>
</template>
