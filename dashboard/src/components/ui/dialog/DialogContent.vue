<script setup lang="ts">
import { ref, watch, inject, onBeforeUnmount, type HTMLAttributes } from 'vue';
import { X } from 'lucide-vue-next';
import { cn } from '@/lib/utils';
import { DIALOG_INJECTION_KEY } from './dialogContext';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();

const ctx = inject(DIALOG_INJECTION_KEY)!;
const dialogRef = ref<HTMLDialogElement | null>(null);

watch(
  () => ctx.open.value,
  (isOpen) => {
    const el = dialogRef.value;
    if (!el) return;
    if (isOpen && !el.open) {
      el.showModal();
    } else if (!isOpen && el.open) {
      el.close();
    }
  },
  { flush: 'post' },
);

function onCancel(e: Event) {
  e.preventDefault();
  ctx.close();
}

function onClickBackdrop(e: MouseEvent) {
  if (e.target === dialogRef.value) {
    ctx.close();
  }
}

onBeforeUnmount(() => {
  const el = dialogRef.value;
  if (el?.open) el.close();
});
</script>

<template>
  <Teleport to="body">
    <dialog
      v-if="ctx.open.value"
      ref="dialogRef"
      :class="
        cn(
          'fixed inset-0 m-auto w-full max-w-lg gap-4 bg-bg-primary p-6 shadow-[var(--shadow-xl)] rounded-2xl border border-separator/30 backdrop:bg-black/40 open:animate-in open:fade-in-0 open:zoom-in-95',
          props.class,
        )
      "
      @cancel="onCancel"
      @click="onClickBackdrop"
    >
      <div @click.stop>
        <slot />
      </div>

      <button
        class="absolute right-4 top-4 rounded-md opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/30"
        @click="ctx.close()"
      >
        <X class="w-4 h-4" />
        <span class="sr-only">Close</span>
      </button>
    </dialog>
  </Teleport>
</template>
