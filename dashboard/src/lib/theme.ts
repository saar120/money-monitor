import { ref, watchEffect } from 'vue';

export type ThemeChoice = 'system' | 'light' | 'dark';

const stored = localStorage.getItem('money-monitor-theme');
export const themeChoice = ref<ThemeChoice>(
  stored === 'light' || stored === 'dark' ? stored : 'system',
);
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  document.documentElement.dataset.theme =
    themeChoice.value === 'system' ? (systemDark.matches ? 'dark' : 'light') : themeChoice.value;
};

watchEffect(applyTheme);
systemDark.addEventListener('change', applyTheme);

export function setThemeChoice(choice: ThemeChoice) {
  themeChoice.value = choice;
  localStorage.setItem('money-monitor-theme', choice);
}
