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
        'rounded-xl border border-border bg-card text-card-foreground transition-all duration-200 hover:border-border-accent hover:-translate-y-0.5',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
