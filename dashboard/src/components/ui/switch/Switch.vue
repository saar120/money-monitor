<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { SwitchRoot, SwitchThumb } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<{
  defaultValue?: boolean
  modelValue?: boolean
  disabled?: boolean
  class?: HTMLAttributes["class"]
}>()

const emit = defineEmits<{
  "update:modelValue": [value: boolean]
}>()
</script>

<template>
  <SwitchRoot
    :model-value="props.modelValue"
    :default-value="props.defaultValue"
    :disabled="props.disabled"
    :class="cn(
      'peer inline-flex h-[22px] w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-bg-tertiary',
      props.class,
    )"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <SwitchThumb
      :class="cn(
        'pointer-events-none block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-0',
      )"
    />
  </SwitchRoot>
</template>
