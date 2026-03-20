<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { X } from 'lucide-vue-next';
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<DialogContentProps & { class?: HTMLAttributes['class'] }>();
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = reactiveOmit(props, 'class');

const forwarded = useForwardPropsEmits(delegatedProps, emits);

// Reka UI's FocusScope races with nextTick; setTimeout(0) defers past its synchronous mount logic.
function handleOpenAutoFocus(event: Event) {
  const container = event.target as HTMLElement | null;
  const input = container?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea');
  if (input) {
    event.preventDefault();
    setTimeout(() => {
      if (input.isConnected) input.focus();
    }, 0);
  }
}

// Reka UI's DismissableLayer/FocusScope can leave stale state that intercepts click-to-focus on Windows/Electron.
function handlePointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    requestAnimationFrame(() => {
      if (target.isConnected && document.activeElement !== target) {
        target.focus();
      }
    });
  }
}
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    />
    <DialogContent
      v-bind="forwarded"
      :class="
        cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 bg-bg-primary p-6 shadow-[var(--shadow-xl)] rounded-2xl border border-separator/30 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          props.class,
        )
      "
      @open-auto-focus="handleOpenAutoFocus"
      @pointerdown="handlePointerDown"
    >
      <slot />

      <DialogClose
        class="absolute right-4 top-4 rounded-md opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:pointer-events-none"
      >
        <X class="w-4 h-4" />
        <span class="sr-only">Close</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
