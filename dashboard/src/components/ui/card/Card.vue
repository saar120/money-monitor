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
        'rounded-[10px] border border-separator bg-bg-primary text-text-primary',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
