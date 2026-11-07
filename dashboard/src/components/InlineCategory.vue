<script setup lang="ts">
import SelectField from '@/components/ui/select/SelectField.vue';

defineProps<{
  modelValue: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <span class="inline-category" @click.stop @keydown.stop>
    <SelectField
      :model-value="modelValue"
      :options="options"
      :aria-label="label"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </span>
</template>
