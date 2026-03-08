<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <tr :class="cn('h-8 border-b border-separator transition-colors duration-100 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] data-[state=selected]:bg-primary/10', props.class)">
    <slot />
  </tr>
</template>
