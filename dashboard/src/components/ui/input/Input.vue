<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { useVModel } from '@vueuse/core';
import { cn } from '@/lib/utils';

const props = defineProps<{
  defaultValue?: string | number;
  modelValue?: string | number;
  class?: HTMLAttributes['class'];
}>();

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void;
}>();

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
});
</script>

<template>
  <input
    v-model="modelValue"
    :class="
      cn(
        'flex h-9 w-full rounded-md border border-separator/70 bg-bg-primary px-3 py-2 text-sm text-text-primary file:border-0 file:bg-transparent file:text-text-primary file:text-[13px] file:font-medium placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 transition-shadow duration-150',
        props.class,
      )
    "
  />
</template>
