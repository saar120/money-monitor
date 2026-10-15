<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { Check } from 'lucide-vue-next';
import { language, t } from '@/lib/language';

const props = defineProps<{ modelValue: string; valid: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:valid': [value: boolean];
}>();
const palette = [
  '#64748b',
  '#285f9b',
  '#4689a3',
  '#52796f',
  '#72945b',
  '#b49948',
  '#c58048',
  '#bb6660',
  '#b57391',
  '#8968a8',
  '#6573ae',
  '#8a786c',
];
const draft = ref(props.modelValue);
watch(
  () => props.modelValue,
  (value) => {
    draft.value = value;
    emit('update:valid', true);
  },
);
onMounted(() => emit('update:valid', true));
function choose(value: string) {
  draft.value = value;
  emit('update:valid', true);
  emit('update:modelValue', value);
}
function edit(event: Event) {
  draft.value = (event.target as globalThis.HTMLInputElement).value;
  const value = draft.value.trim();
  const valid = /^#[\da-f]{6}$/i.test(value);
  emit('update:valid', valid);
  if (valid) emit('update:modelValue', value.toLowerCase());
}
</script>

<template>
  <div class="category-color-picker">
    <div class="color-palette" role="group" :aria-label="t('color')">
      <button
        v-for="swatch in palette"
        :key="swatch"
        type="button"
        :aria-label="`${t('color')} ${swatch}`"
        :aria-pressed="modelValue.toLowerCase() === swatch"
        :title="swatch"
        @click="choose(swatch)"
      >
        <span :style="{ backgroundColor: swatch }">
          <Check v-if="modelValue.toLowerCase() === swatch" :size="14" />
        </span>
      </button>
    </div>
    <label class="color-custom">
      <span>{{ language === 'he' ? 'צבע מותאם אישית' : 'Custom color' }}</span>
      <span class="color-hex-field">
        <span class="color-preview" :style="{ backgroundColor: modelValue }" aria-hidden="true" />
        <input
          :value="draft"
          type="text"
          dir="ltr"
          spellcheck="false"
          autocomplete="off"
          placeholder="#285f9b"
          maxlength="7"
          :aria-invalid="!valid"
          @input="edit"
        />
      </span>
      <small v-if="!valid" role="status">{{
        language === 'he'
          ? 'יש להזין # ושש ספרות הקסדצימליות.'
          : 'Use # followed by six hex digits.'
      }}</small>
    </label>
  </div>
</template>

<style scoped>
.category-color-picker {
  display: grid;
  gap: 12px;
}
.color-palette {
  display: grid;
  grid-template-columns: repeat(6, 36px);
  gap: 6px;
}
.color-palette button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid transparent;
  border-radius: 8px;
}
.color-palette button:hover {
  background: var(--bg-tertiary);
}
.color-palette button[aria-pressed='true'] {
  border-color: var(--text-tertiary);
  background: var(--bg-secondary);
}
.color-palette button span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: white;
}
.color-hex-field {
  position: relative;
  display: block;
}
.color-preview {
  position: absolute;
  inset-inline-end: 10px;
  top: 10px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--separator);
}
.color-hex-field input {
  padding-inline-end: 36px !important;
  font-variant-numeric: tabular-nums;
}
.color-hex-field input[aria-invalid='true'] {
  border-color: var(--destructive);
}
.color-custom small {
  color: var(--destructive);
}
</style>
