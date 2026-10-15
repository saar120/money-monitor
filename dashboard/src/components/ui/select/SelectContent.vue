<script setup lang="ts">
import type { SelectContentEmits, SelectContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { SelectContent, SelectPortal, SelectViewport, useForwardPropsEmits } from 'reka-ui';
import { cn } from '@/lib/utils';
import { SelectScrollDownButton, SelectScrollUpButton } from '.';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<SelectContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    position: 'popper',
    sideOffset: 6,
    collisionPadding: 8,
    align: 'start',
  },
);
const emits = defineEmits<SelectContentEmits>();

const delegatedProps = reactiveOmit(props, 'class');

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <SelectPortal>
    <SelectContent
      v-bind="{ ...forwarded, ...$attrs }"
      :class="
        cn(
          'ui-select-content relative z-50 max-h-[min(24rem,var(--reka-select-content-available-height))] max-w-[calc(100vw-16px)] min-w-32 overflow-hidden rounded-lg border border-separator bg-bg-primary text-text-primary shadow-[0_6px_24px_rgba(0,0,0,0.12)]',
          props.class,
        )
      "
    >
      <SelectScrollUpButton />
      <SelectViewport
        :class="
          cn('p-1', position === 'popper' && 'w-full min-w-[var(--reka-select-trigger-width)]')
        "
      >
        <slot />
      </SelectViewport>
      <SelectScrollDownButton />
    </SelectContent>
  </SelectPortal>
</template>
