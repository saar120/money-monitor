<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { language, t } from '@/lib/language';
import { isValidMonth } from '@/lib/month';

const props = defineProps<{ modelValue: string; maxMonth?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const label = computed(() =>
  new Date(`${props.modelValue}-01T12:00:00`).toLocaleDateString(
    language.value === 'he' ? 'he-IL' : 'en-US',
    { month: 'long', year: 'numeric' },
  ),
);
function shift(delta: number) {
  const [year, month] = props.modelValue.split('-').map(Number) as [number, number];
  const value = new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
  if (!props.maxMonth || value <= props.maxMonth) emit('update:modelValue', value);
}
function choose(event: Event) {
  const input = event.target as HTMLInputElement;
  if (isValidMonth(input.value) && (!props.maxMonth || input.value <= props.maxMonth))
    emit('update:modelValue', input.value);
}
</script>

<template>
  <div class="month-stepper" role="group" :aria-label="t('month')">
    <button type="button" :aria-label="t('previous')" @click="shift(-1)">
      <ChevronRight v-if="language === 'he'" :size="17" /><ChevronLeft v-else :size="17" />
    </button>
    <label class="month-stepper-current">
      <span>{{ label }}</span>
      <input
        type="month"
        :value="modelValue"
        :max="maxMonth"
        :aria-label="t('month')"
        @change="choose"
      />
    </label>
    <button
      type="button"
      :aria-label="t('next')"
      :disabled="maxMonth != null && modelValue >= maxMonth"
      @click="shift(1)"
    >
      <ChevronLeft v-if="language === 'he'" :size="17" /><ChevronRight v-else :size="17" />
    </button>
  </div>
</template>

<style scoped>
.month-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 190px;
  height: 39px;
  padding: 4px 6px;
  border: 1px solid var(--separator);
  border-radius: 11px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}
button {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 7px;
  color: var(--text-secondary);
}
button:hover {
  background: var(--bg-tertiary);
}
button:disabled {
  opacity: 0.4;
}
.month-stepper-current {
  position: relative;
  display: grid;
  place-items: center;
  flex: 1;
  height: 100%;
}
.month-stepper-current:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  border-radius: 5px;
}
input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
</style>
