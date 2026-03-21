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
      class="fixed inset-0 m-0 h-full w-full max-w-none max-h-none bg-transparent p-0 overflow-y-auto grid place-items-center backdrop:bg-black/40"
      @cancel="onCancel"
      @click="onClickBackdrop"
    >
      <div
        :class="
          cn(
            'relative z-50 w-full max-w-lg my-8 gap-4 bg-bg-primary p-6 shadow-[0_16px_48px_rgba(0,0,0,0.2)] rounded-xl md:w-full',
            props.class,
          )
        "
        @click.stop
      >
        <slot />

        <button
          class="absolute top-3 right-3 p-0.5 transition-colors rounded-md hover:bg-secondary"
          @click="ctx.close()"
        >
          <X class="w-4 h-4" />
          <span class="sr-only">Close</span>
        </button>
      </div>
    </dialog>
  </Teleport>
</template>
