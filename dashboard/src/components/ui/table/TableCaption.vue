<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <caption :class="cn('mt-4 text-[13px] text-text-secondary', props.class)">
    <slot />
  </caption>
</template>
