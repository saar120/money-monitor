<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    :class="
      cn(
        'rounded-xl border border-separator/60 bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
