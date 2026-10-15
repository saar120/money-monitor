<script setup lang="ts">
import { useSettingsField } from '@/components/ui/settings-group/field';
import type { SelectTriggerProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ChevronDown } from 'lucide-vue-next';
import { SelectIcon, SelectTrigger, useForwardProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<SelectTriggerProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');

const forwardedProps = useForwardProps(delegatedProps);
const settingsField = useSettingsField();
</script>

<template>
  <SelectTrigger
    v-bind="{ ...settingsField, ...forwardedProps }"
    :class="
      cn(
        'ui-field ui-select-trigger flex h-9 w-full items-center justify-between gap-3 rounded-md bg-bg-primary border border-separator px-3 text-sm text-text-primary data-[placeholder]:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate font-normal text-start transition-colors duration-150 hover:bg-bg-secondary',
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
