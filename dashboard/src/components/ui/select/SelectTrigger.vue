<script setup lang="ts">
import type { SelectTriggerProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ChevronDown } from 'lucide-vue-next';
import { SelectIcon, SelectTrigger, useForwardProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<SelectTriggerProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectTrigger
    v-bind="forwardedProps"
    :class="
      cn(
        'flex h-[30px] w-full items-center justify-between rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] backdrop-blur-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] px-2.5 text-[13px] text-text-primary data-[placeholder]:text-text-tertiary focus:outline-none focus:ring-[3px] focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate text-start transition-all duration-150 hover:bg-[var(--glass-bg-heavy)]',
        props.class,
      )
    "
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown class="w-4 h-4 opacity-50 shrink-0" />
    </SelectIcon>
  </SelectTrigger>
</template>
