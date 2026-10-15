<script setup lang="ts">
import type { SelectItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { Check } from 'lucide-vue-next';
import { SelectItem, SelectItemIndicator, SelectItemText, useForwardProps } from 'reka-ui';
import { cn } from '@/lib/utils';
import { language } from '@/lib/language';

const props = defineProps<SelectItemProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectItem
    :key="language"
    v-bind="forwardedProps"
    :data-value="props.value"
    :class="
      cn(
        'relative flex w-full cursor-default select-none items-center rounded-md min-h-9 py-2 ps-8 pe-3 text-[13px] leading-5 outline-none focus:bg-bg-tertiary data-[highlighted]:bg-bg-tertiary data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        props.class,
      )
    "
  >
    <span class="absolute start-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectItemIndicator>
        <Check class="h-4 w-4" />
      </SelectItemIndicator>
    </span>

    <SelectItemText>
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
