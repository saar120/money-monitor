<script setup lang="ts">
import { computed } from 'vue';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '.';
import { language } from '@/lib/language';

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  modelValue: string;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
// Reka reserves the empty string for placeholders; forms also need an explicit “unassigned” choice.
const emptyValue = '__empty_selection__';
const selection = computed({
  get: () => props.modelValue || emptyValue,
  set: (value: string) => emit('update:modelValue', value === emptyValue ? '' : value),
});
</script>

<template>
  <Select v-model="selection" :dir="language === 'he' ? 'rtl' : 'ltr'">
    <SelectTrigger v-bind="$attrs"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem
        v-for="option in options"
        :key="option.value"
        :value="option.value || emptyValue"
        :disabled="option.disabled"
        >{{ option.label }}</SelectItem
      >
    </SelectContent>
  </Select>
</template>
