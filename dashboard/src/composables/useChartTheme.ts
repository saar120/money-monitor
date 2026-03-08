import { ref, computed, onMounted, onUnmounted } from 'vue';

/**
 * Resolves CSS custom properties into actual color strings for Chart.js.
 * Chart.js renders to <canvas> which cannot resolve CSS `var(--...)` tokens.
 * Returns reactive values that update on theme/accent changes.
 */
export function useChartTheme() {
  const tick = ref(0);

  function bump() { tick.value++; }

  // Re-resolve when system color scheme changes
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  let observer: MutationObserver | null = null;

  onMounted(() => {
    mql.addEventListener('change', bump);
    // Watch for class/style changes on <html> (e.g. .window-blurred, --system-accent)
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

  /** Shared tooltip config for macOS-style chart tooltips */
  const tooltip = computed(() => ({
    backgroundColor: bgPrimary.value,
    borderColor: separator.value,
    borderWidth: 1,
    titleColor: textPrimary.value,
    bodyColor: textPrimary.value,
    cornerRadius: 12,
    padding: 10,
  }));

  /** Shared legend labels config */
  const legendLabels = computed(() => ({
    color: textSecondary.value,
    font: { family: 'system-ui, -apple-system, sans-serif', size: 11 },
    usePointStyle: true,
    pointStyle: 'circle' as const,
  }));

  /** Shared axis tick config */
  const axisTicks = computed(() => ({
    color: textSecondary.value,
    font: { size: 11 },
  }));

  /** Shared grid config (dashed separator lines) */
  const grid = computed(() => ({
    color: separator.value,
    borderDash: [4, 4],
  }));

  return {
    textPrimary,
    textSecondary,
    bgPrimary,
    separator,
    tooltip,
    legendLabels,
    axisTicks,
    grid,
  };
}
