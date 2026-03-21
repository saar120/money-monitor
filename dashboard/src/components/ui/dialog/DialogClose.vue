<script setup lang="ts">
import { inject } from 'vue';
import { DIALOG_INJECTION_KEY } from './dialogContext';

const ctx = inject(DIALOG_INJECTION_KEY)!;
</script>

<template>
  <button type="button" @click="ctx.close()">
    <slot />
  </button>
</template>
