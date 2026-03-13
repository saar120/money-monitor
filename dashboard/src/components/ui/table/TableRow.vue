<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <tr :class="cn('h-9 border-b border-separator/40 transition-colors duration-150 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] data-[state=selected]:bg-primary/10', props.class)">
    <slot />
  </tr>
</template>
