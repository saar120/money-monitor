import { ref, computed, onMounted, onUnmounted } from 'vue';

/**
 * Resolves CSS custom properties into actual color strings for ECharts.
 * ECharts renders to <canvas> which cannot resolve CSS `var(--...)` tokens.
 * Returns reactive values that update on theme/accent changes.
 */
export function useChartTheme() {
  const tick = ref(0);

  function bump() { tick.value++; }

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  let observer: MutationObserver | null = null;

  onMounted(() => {
    mql.addEventListener('change', bump);
    observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  });

  onUnmounted(() => {
    mql.removeEventListener('change', bump);
    observer?.disconnect();
  });

  function resolve(prop: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
  }

  const textPrimary = computed(() => { tick.value; return resolve('--text-primary'); });
  const textSecondary = computed(() => { tick.value; return resolve('--text-secondary'); });
  const bgPrimary = computed(() => { tick.value; return resolve('--bg-primary'); });
  const separator = computed(() => { tick.value; return resolve('--separator'); });

  return { textPrimary, textSecondary, bgPrimary, separator };
}
