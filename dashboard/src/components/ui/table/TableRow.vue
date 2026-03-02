<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <tr :class="cn('border-b border-border transition-colors duration-150 hover:bg-surface-3 data-[state=selected]:bg-surface-3', props.class)">
    <slot />
  </tr>
</template>
