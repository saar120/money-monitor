<script setup lang="ts">
import { provide, toRef } from 'vue';
import { DIALOG_INJECTION_KEY } from './dialogContext';

const props = defineProps<{ open?: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const openRef = toRef(props, 'open');

function close() {
  emit('update:open', false);
}

provide(DIALOG_INJECTION_KEY, { open: openRef, close });
</script>

<template>
  <slot />
</template>
