import type { Ref } from 'vue';
import { language } from '@/lib/language';
// Leave charts, controls, and vertical scrolling to their own gestures.
export function useMonthSwipe(month: Ref<string>) {
  let start: { x: number; y: number } | null = null;
  return {
    onPointerdown(event: PointerEvent) {
      start = null;
      if (event.pointerType === 'mouse') return;
      if ((event.target as Element).closest('button,a,input,select,canvas,[data-scrub]')) return;
      start = { x: event.clientX, y: event.clientY };
    },
    onPointercancel() {
      start = null;
    },
    onPointerup(event: PointerEvent) {
      const origin = start;
      start = null;
      if (!origin) return;
      const dx = event.clientX - origin.x;
      if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(event.clientY - origin.y) * 2) return;
      const [year, number] = month.value.split('-').map(Number) as [number, number];
      const delta = (dx < 0 ? 1 : -1) * (language.value === 'he' ? -1 : 1);
      month.value = new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
    },
  };
}
