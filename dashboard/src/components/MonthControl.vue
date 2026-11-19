<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-vue-next';
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
const picker = useTemplateRef<globalThis.HTMLInputElement>('picker');
const current = useTemplateRef<globalThis.HTMLButtonElement>('current');
// Typing a digit on the month button moves into the real month/year field, shown over the label.
function typeIntoPicker(event: KeyboardEvent) {
  if (!/^\d$/.test(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  // Exposed to assistive technology only while it is the field being edited.
  picker.value?.removeAttribute('aria-hidden');
  picker.value?.focus();
}
function endEditing(input: globalThis.HTMLInputElement) {
  commit(input);
  input.setAttribute('aria-hidden', 'true');
}
function leavePicker(event: KeyboardEvent) {
  const input = event.target as globalThis.HTMLInputElement;
  if (event.key === 'Enter') commit(input);
  else if (event.key === 'Escape') input.value = props.modelValue;
  else return;
  event.preventDefault();
  current.value?.focus();
}
// The label stays localized; the native month picker opens on demand instead of as an invisible field.
function openPicker() {
  const input = picker.value;
  if (!input) return;
  try {
    input.showPicker();
  } catch {
    input.focus();
    input.click();
  }
}
function commit(input: globalThis.HTMLInputElement) {
  if (isValidMonth(input.value) && (!props.maxMonth || input.value <= props.maxMonth)) {
    if (input.value !== props.modelValue) emit('update:modelValue', input.value);
  }
  // A cleared or rejected picker must not drift from the month the label shows.
  else input.value = props.modelValue;
}
function choose(event: Event) {
  const input = event.target as globalThis.HTMLInputElement;
  // While typing, each completed segment fires change; wait for Enter or blur to commit.
  if (document.activeElement !== input) commit(input);
}
</script>

<template>
  <div class="month-stepper" role="group" :aria-label="t('month')">
    <button type="button" :aria-label="t('previous')" @click="shift(-1)">
      <ChevronRight v-if="language === 'he'" :size="17" /><ChevronLeft v-else :size="17" />
    </button>
    <button
      ref="current"
      type="button"
      class="month-stepper-current"
      :aria-label="`${t('month')}: ${label}`"
      aria-haspopup="dialog"
      @click="openPicker"
      @keydown="typeIntoPicker"
    >
      <Transition name="month-label">
        <span :key="modelValue">{{ label }}</span>
      </Transition>
      <CalendarDays class="month-stepper-icon" :size="14" aria-hidden="true" />
    </button>
    <input
      ref="picker"
      class="month-stepper-input"
      type="month"
      tabindex="-1"
      aria-hidden="true"
      :aria-label="t('month')"
      :value="modelValue"
      :max="maxMonth"
      @change="choose"
      @keydown="leavePicker"
      @blur="endEditing($event.target as HTMLInputElement)"
    />
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 220px;
  height: var(--control-height);
  padding: 0;
  border: 0;
  border-radius: var(--control-radius);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
button {
  display: grid;
  place-items: center;
  width: var(--control-height);
  height: var(--control-height);
  border-radius: 7px;
  color: var(--text-secondary);
}
button {
  transition:
    transform 120ms ease-out,
    background-color 120ms ease-out;
}
button:active:not(:disabled) {
  transform: scale(0.9);
}
.month-stepper-current > span {
  grid-area: 1 / 1;
}
.month-label-enter-active,
.month-label-leave-active {
  transition:
    opacity 140ms ease-out,
    transform 360ms cubic-bezier(0.16, 1, 0.3, 1);
}
.month-label-enter-from {
  opacity: 0;
  transform: translateY(24px);
}
.month-label-leave-to {
  opacity: 0;
  transform: translateY(-24px);
}
button:hover {
  background: var(--bg-tertiary);
}
button:disabled {
  opacity: 0.4;
}
.month-stepper-current {
  overflow: hidden;
  display: grid;
  grid-template-columns: auto auto;
  justify-content: center;
  align-items: center;
  column-gap: 6px;
  flex: 1;
  width: auto;
  height: 100%;
  color: inherit;
  font: inherit;
}
.month-stepper-current:active:not(:disabled) {
  transform: none;
}
.month-stepper-current:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.month-stepper-icon {
  grid-area: 1 / 2;
  color: var(--text-secondary);
}
/* Anchors the native picker; visible only while a keyboard user types a month/year into it. */
.month-stepper-input {
  position: absolute;
  inset-block: 0;
  inset-inline: var(--control-height);
  opacity: 0;
  pointer-events: none;
}
.month-stepper-input:focus {
  opacity: 1;
  pointer-events: auto;
  padding-inline: 4px;
  border: 0;
  border-radius: 5px;
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--surface);
  color: var(--text-primary);
  font: inherit;
  text-align: center;
}
</style>
