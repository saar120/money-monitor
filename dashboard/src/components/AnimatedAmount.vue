<script setup lang="ts">
import { computed } from 'vue';
import { formatCurrency } from '@/lib/format';
const props = defineProps<{ value: number; animate?: boolean }>();
const characters = computed(() =>
  `${props.value < 0 ? '−' : ''}${formatCurrency(props.value)}`.split(''),
);
</script>
<template>
  <span
    class="rolling-amount"
    dir="ltr"
    :aria-label="`${value < 0 ? '−' : ''}${formatCurrency(value)}`"
  >
    <span
      v-for="(character, index) in characters"
      :key="characters.length - index"
      class="rolling-digit"
      aria-hidden="true"
    >
      <Transition name="digit-roll" :css="animate !== false"
        ><span :key="character">{{ character }}</span></Transition
      >
    </span>
  </span>
</template>
<style scoped>
.rolling-amount,
.rolling-digit,
.rolling-digit > span {
  font: inherit;
  color: inherit;
  line-height: inherit;
}
.rolling-amount {
  display: inline-flex;
  font-variant-numeric: tabular-nums;
}
.rolling-digit {
  position: relative;
  display: inline-grid;
  overflow: hidden;
}
.rolling-digit > span {
  grid-area: 1 / 1;
}
.digit-roll-enter-active,
.digit-roll-leave-active {
  transition:
    transform 460ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 300ms;
}
.digit-roll-leave-active {
  position: absolute;
  inset: 0;
}
.digit-roll-enter-from {
  transform: translateY(110%);
  opacity: 0;
}
.digit-roll-leave-to {
  transform: translateY(-110%);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .digit-roll-enter-active,
  .digit-roll-leave-active {
    transition: none;
  }
}
</style>
