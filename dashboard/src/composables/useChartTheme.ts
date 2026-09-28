import { ref, onMounted, onUnmounted } from 'vue';

/** Keep canvas chart colors in sync with CSS appearance tokens. */
export function useChartTheme() {
  const textPrimary = ref('');
  const textSecondary = ref('');
  const bgPrimary = ref('');
  const separator = ref('');
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  let observer: MutationObserver | null = null;

  function refresh() {
    const style = getComputedStyle(document.documentElement);
    textPrimary.value = style.getPropertyValue('--text-primary').trim();
    textSecondary.value = style.getPropertyValue('--text-secondary').trim();
    bgPrimary.value = style.getPropertyValue('--bg-primary').trim();
    separator.value = style.getPropertyValue('--separator').trim();
  }

  onMounted(() => {
    refresh();
    mql.addEventListener('change', refresh);
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
  });

  onUnmounted(() => {
    mql.removeEventListener('change', refresh);
    observer?.disconnect();
  });

  return { textPrimary, textSecondary, bgPrimary, separator };
}
