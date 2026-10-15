<script setup lang="ts">
import { computed, provide, useId, type HTMLAttributes } from 'vue';
import { settingsFieldKey } from './field';
import { cn } from '@/lib/utils';

const props = defineProps<{
  label?: string;
  description?: string;
  class?: HTMLAttributes['class'];
  vertical?: boolean;
}>();
const id = useId();
const labelId = computed(() => (props.label ? `${id}-label` : undefined));
const descriptionId = computed(() => (props.description ? `${id}-description` : undefined));
provide(settingsFieldKey, { labelId, descriptionId });
</script>

<template>
  <div
    :class="
      cn(
        'py-5 flex gap-6',
        vertical
          ? 'flex-col'
          : 'flex-col items-start sm:flex-row sm:items-center sm:justify-between',
        props.class,
      )
    "
  >
    <div v-if="label" class="min-w-0 flex-1" :class="{ 'min-w-0': !vertical }">
      <div :id="labelId" class="text-sm font-medium text-text-primary">{{ label }}</div>
      <div
        v-if="description"
        :id="descriptionId"
        class="text-xs leading-relaxed text-text-secondary mt-1"
      >
        {{ description }}
      </div>
    </div>
    <div
      :class="
        vertical
          ? ''
          : 'flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:ms-auto [&>*]:max-w-full'
      "
    >
      <slot />
    </div>
  </div>
</template>
