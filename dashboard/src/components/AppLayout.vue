<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Activity,
  Bell,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  Compass,
  Home,
  Receipt,
  Repeat2,
  Settings,
  Tag,
  TrendingUp,
  Wallet,
} from 'lucide-vue-next';
import { getSettings, toggleDemoMode } from '../api/client';
import { useReviewCount } from '../composables/useReviewCount';
import { t, type LanguageLabel } from '@/lib/language';

const isElectron = !!(window as unknown as Record<string, unknown>).electronAPI;
const route = useRoute();
const router = useRouter();
const mainEl = ref<HTMLElement | null>(null);
const { reviewCount, refresh: refreshReviewCount } = useReviewCount();
const demoMode = ref(false);
const primary = [
  { path: '/', label: 'home', icon: Home, shortcut: '1' },
  { path: '/transactions', label: 'activity', icon: Receipt, shortcut: '2' },
  { path: '/explore', label: 'explore', icon: Compass, shortcut: '3' },
  { path: '/chat', label: 'advisor', icon: Bot, shortcut: '4' },
] as const;
const money = [
  { path: '/insights', label: 'review', icon: CheckCircle2 },
  { path: '/budgets', label: 'budgets', icon: Wallet },
  { path: '/recurring-payments', label: 'subscriptions', icon: Repeat2 },
  { path: '/net-worth', label: 'netWorth', icon: TrendingUp },
] as const;
const manage = [
  { path: '/accounts', label: 'accounts', icon: Building2 },
  { path: '/categories', label: 'categories', icon: Tag },
  { path: '/alerts', label: 'alerts', icon: Bell },
  { path: '/scraping', label: 'scraping', icon: Activity },
] as const;
const planningOpen = ref(money.some((item) => route.path.startsWith(item.path)));
const manageOpen = ref(manage.some((item) => route.path.startsWith(item.path)));
watch(
  () => route.path,
  (path) => {
    if (money.some((item) => path.startsWith(item.path))) planningOpen.value = true;
    if (manage.some((item) => path.startsWith(item.path))) manageOpen.value = true;
  },
);
const pageTitles: Record<string, LanguageLabel> = {
  '/': 'home',
  '/transactions': 'activity',
  '/transactions/advanced': 'activity',
  '/explore': 'explore',
  '/explore/monthly-comparison': 'monthlySpending',
  '/cash-flow': 'cashFlow',
  '/chat': 'advisor',
  '/insights': 'review',
  '/insights/advanced': 'review',
  '/budgets': 'budgets',
  '/recurring-payments': 'subscriptions',
  '/net-worth': 'netWorth',
  '/categories': 'categories',
  '/categories/advanced': 'categories',
  '/accounts': 'accounts',
  '/accounts/advanced': 'accounts',
  '/alerts': 'alerts',
  '/scraping': 'scraping',
  '/settings': 'settings',
};
const pageTitle = computed(() => {
  const title = pageTitles[route.path];
  return (
    (title ? t(title) : undefined) ??
    (route.path.startsWith('/explore/category/')
      ? t('categorySpending')
      : route.path.startsWith('/explore/merchant/')
        ? t('merchant')
        : route.path.startsWith('/net-worth/')
          ? t('assetDetails')
          : 'Money Monitor')
  );
});
const activityWorkspace = computed(() => route.path === '/transactions');
function isActive(path: string) {
  return path === '/'
    ? route.path === '/'
    : route.path === path || route.path.startsWith(`${path}/`);
}
function onShortcut(event: KeyboardEvent) {
  if (!isElectron) return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
  if (
    event.target instanceof HTMLElement &&
    event.target.closest('input, textarea, [contenteditable]')
  )
    return;
  const target = primary.find((item) => item.shortcut === event.key);
  if (!target) return;
  event.preventDefault();
  router.push(target.path);
}
const removeAfterEach = router.afterEach(() => mainEl.value?.scrollTo(0, 0));
onUnmounted(() => {
  removeAfterEach();
  window.removeEventListener('keydown', onShortcut);
});
onMounted(async () => {
  window.addEventListener('keydown', onShortcut);
  try {
    const [, settings] = await Promise.all([refreshReviewCount(), getSettings()]);
    demoMode.value = settings.demoMode;
  } catch {
    /* Home and navigation remain available if settings fail. */
  }
});
async function exitDemo() {
  try {
    await toggleDemoMode(false);
    window.location.reload();
  } catch {
    /* The settings page can show the underlying error. */
  }
}
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'in-electron': isElectron, 'activity-workspace': activityWorkspace }"
  >
    <aside class="app-sidebar" :aria-label="t('mainNavigation')">
      <div v-if="isElectron" class="window-drag" />
      <RouterLink to="/" class="app-brand" aria-label="Money Monitor home">
        <img src="/icon-192.png" alt="" /><span>Money Monitor</span>
      </RouterLink>
      <nav class="sidebar-scroll">
        <div class="nav-group primary-nav">
          <RouterLink
            v-for="item in primary"
            :key="item.path"
            :to="item.path"
            class="nav-link"
            :class="{ active: isActive(item.path) }"
            :aria-current="isActive(item.path) ? 'page' : undefined"
            :title="t(item.label)"
            :aria-label="t(item.label)"
          >
            <component :is="item.icon" :size="18" :stroke-width="2" />
            <span>{{ t(item.label) }}</span
            ><kbd>{{ item.shortcut }}</kbd>
          </RouterLink>
        </div>
        <div class="nav-group secondary-nav">
          <button
            type="button"
            class="nav-disclosure"
            :aria-expanded="planningOpen"
            :aria-label="t('planning')"
            :title="t('planning')"
            @click="planningOpen = !planningOpen"
          >
            <Wallet :size="17" /><span>{{ t('planning') }}</span
            ><ChevronDown :size="15" :class="{ open: planningOpen }" />
          </button>
          <div class="nav-reveal" :class="{ open: planningOpen }" :inert="!planningOpen">
            <div class="nav-subgroup">
              <RouterLink
                v-for="item in money"
                :key="item.path"
                :to="item.path"
                class="nav-link"
                :class="{ active: isActive(item.path) }"
                :aria-current="isActive(item.path) ? 'page' : undefined"
                :title="t(item.label)"
                :aria-label="t(item.label)"
              >
                <component :is="item.icon" :size="17" :stroke-width="1.9" />
                <span>{{ t(item.label) }}</span>
                <span v-if="item.path === '/insights' && reviewCount" class="nav-count">{{
                  reviewCount
                }}</span>
              </RouterLink>
            </div>
          </div>
        </div>
        <div class="nav-group secondary-nav">
          <button
            type="button"
            class="nav-disclosure"
            :aria-expanded="manageOpen"
            :aria-label="t('manage')"
            :title="t('manage')"
            @click="manageOpen = !manageOpen"
          >
            <Settings :size="17" /><span>{{ t('manage') }}</span
            ><ChevronDown :size="15" :class="{ open: manageOpen }" />
          </button>
          <div class="nav-reveal" :class="{ open: manageOpen }" :inert="!manageOpen">
            <div class="nav-subgroup">
              <RouterLink
                v-for="item in manage"
                :key="item.path"
                :to="item.path"
                class="nav-link"
                :class="{ active: isActive(item.path) }"
                :aria-current="isActive(item.path) ? 'page' : undefined"
                :title="t(item.label)"
                :aria-label="t(item.label)"
              >
                <component :is="item.icon" :size="17" :stroke-width="1.9" /><span>{{
                  t(item.label)
                }}</span>
              </RouterLink>
            </div>
          </div>
        </div>
      </nav>
      <div class="sidebar-bottom">
        <RouterLink to="/scraping" class="sidebar-sync" :title="t('scraping')"
          ><span class="sidebar-sync-dot" />{{ t('scraping') }}</RouterLink
        >
        <RouterLink
          to="/settings"
          class="nav-link"
          :class="{ active: isActive('/settings') }"
          :aria-current="isActive('/settings') ? 'page' : undefined"
          :title="t('settings')"
          :aria-label="t('settings')"
        >
          <Settings :size="17" /><span>{{ t('settings') }}</span>
        </RouterLink>
      </div>
    </aside>

    <div class="app-content">
      <div v-if="demoMode" class="demo-banner">
        <span class="demo-dot" /> {{ t('viewingSampleData') }}
        <button @click="exitDemo">{{ t('exitDemo') }}</button>
      </div>
      <div
        v-if="!activityWorkspace"
        class="content-toolbar"
        :style="isElectron ? '-webkit-app-region: drag' : undefined"
      >
        <h2>{{ pageTitle }}</h2>
        <div id="toolbar-actions" class="toolbar-actions" style="-webkit-app-region: no-drag" />
      </div>
      <main ref="mainEl" class="content-scroll">
        <div class="content-inner"><slot /></div>
      </main>
    </div>
  </div>
</template>
